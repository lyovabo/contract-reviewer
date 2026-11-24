# Plan — contract-review flow

## Context

This is the the contract-review flow of a law firm's workspace shared by six lawyers. A lawyer sees the workspace's documents with the state of each one's latest review, requests an AI review and follows it until it completes or fails, and reads a completed review's findings (clause, severity, explanation).

The hard rules: 10 reviews per calendar month for the whole workspace, failures don't count; at most one in-progress review per document; the AI is fake — it streams that document's findings from `samples/documents.json` over 5–30 seconds, fails ~1 in 5, and is slow ~1 in 10 (60–120s); a review still in progress 60 seconds after it was requested has failed permanently, and late findings or completion must not resurrect it or consume the plan. A retry is a new review. No authentication — the current lawyer is picked in the UI from `samples/lawyers.json`.

Product and the customer disagree on three points; this plan takes a position on each.

## 1. Decisions on the three points

1. **Previous review while a new one runs — keep it visible, clearly labeled.** The partner's constraint is "never *mistake*" old or partial for final — not "never *show*". The previous completed result stays on screen, badged e.g. "Previous review — completed 24 Sep", visually separated from the new review's live progress panel above it. Satisfies the PM (no one waits in front of nothing) and the partner (impossible to misread).
2. **Findings before completion — stream them, marked partial.** Each finding appears as it arrives under a prominent "Review in progress — partial results" banner with elapsed time. If the review fails, the partial findings stay visible but stamped "from a failed review — incomplete". Honest labeling satisfies both asks.
3. **Requests beyond the plan — reject clearly, never queue.** The request is refused (button disabled) with the reset date shown. Supporting UX:
   - the remaining quota is always visible **before** requesting (plan circle in the header; cost copy on the button),
   - a **low-quota warning** when ≤ 3 credits remain (yellow),
   - a **"Get more reviews"** affordance leading to a mock upgrade/payment page — pure UI, nothing real (billing is out of scope per the brief).

   Reasons: a queued review that starts in three weeks reviews a possibly stale document; the partner explicitly rejects "believing a review is on its way"; and a queue adds a scheduler plus extra states.

## 2. Tech stack & reasoning

- **API:** Node.js 20+, Express 5, TypeScript. REST.
- **DB:** SQLite via `better-sqlite3`. Its synchronous API is deliberate and the right model for SQLite specifically: the database is embedded in-process — there is no network I/O to overlap, so an async wrapper only adds thread-pool overhead (this is why Node's own built-in `node:sqlite` is synchronous too). The entire database is **one file** holding all tables — never split or sharded across files; if the app ever ran as several processes, they would all open that same file and SQLite's own locking (WAL mode) serializes writers. All queries sit behind a thin repository module, so swapping the driver — or SQLite for PostgreSQL — touches no domain logic. No ORM: a handful of typed query functions is proportionate to the problem.
- **Frontend:** Next.js (App Router) + React + TypeScript, TanStack Query for data fetching/polling, Tailwind for speed. Next.js `rewrites` proxy `/api/*` to Express (no CORS).
- **Tests:** Vitest + supertest, in-memory SQLite (plus one file-backed restart test), fake timers, injectable RNG/clock.
- **Live updates: polling, chosen for simplicity.** Updates flow one way (server → client), so WebSockets' bidirectional channel buys nothing; the natural push tech would be SSE. Polling (~1s while a review runs) is less code and fewer failure modes (reconnects, proxy buffering). SSE is the first upgrade.

## 3. Architecture

### Repo layout
```
├── README.md / PLAN.md
├── samples/          # documents.json, lawyers.json (paths match the brief)
├── api/              # Express + TS: src/{db,domain,reviewer,routes}, tests/
└── web/              # Next.js + TS
```

### Data model — all state lives in SQLite
The samples JSON is only an idempotent seed on startup; nothing authoritative is held in memory.

- `workspaces` — id, name. The brief has one workspace and the samples have none, so the seed creates one ("Firm workspace").
- `workspace_members` — workspace_id, lawyer_id: a lawyer can belong to several workspaces. The seed makes all the lawyers members of the one workspace.
- `lawyers` — seeded from `samples/lawyers.json`: id, name, title
- `documents` — seeded from `samples/documents.json`: id, **workspace_id** (the owner), title, type, pages, uploaded_at, uploaded_by, supersedes
- `document_findings` — the fake AI's script, seeded from the JSON: document_id, position, clause (nullable), title, severity, excerpt (nullable), explanation
- `reviews` — id, document_id, requested_by, requested_at, status (`in_progress` | `completed` | `failed`), finished_at, failure_reason
- `review_findings` — what a review actually returned before finishing/failing: id, review_id, position, clause, title, severity, excerpt, explanation, received_at

The only in-memory state is the reviewer's pending timers: the startup sweep (restart policy in the failure matrix below: overdue → `failed('timeout')`, remaining `in_progress` → `failed('interrupted')`) means a restart can never strand a review or let it complete late.

### Quota rule (10 credits/calendar month, UTC — documented assumption)
- The plan is **per workspace**: a review counts against the workspace that owns its document. With the sample data there is one workspace, so this is the brief's "10 reviews per month for the whole workspace". Only members of the owning workspace can request a review (403 `not_a_member`).
- The charged month is the **request month**: both numbers are filtered by the UTC month of `requested_at`. Two distinct numbers, never conflated: **used** (reviews requested this month that completed) and **reserved** (in-progress, non-expired reviews holding a credit they haven't spent yet). A review requested 30 Nov that completes 1 Dec spends a **November** credit. `available = 10 − used − reserved`. A request is admitted only if `available > 0`; failure/timeout releases the reservation, completion converts it to spent.
- A refused request distinguishes its reason: `plan_exhausted` (all credits **used** — nothing frees up before `resetsAt`) vs `slots_reserved` (remaining credits are **reserved** by running reviews and may free up within seconds). With 9 completed and 1 running, the UI must NOT say "Plan used up — resets 1 Dec".
- This guarantees never exceeding 10 completed (two in-flight reviews can't both sneak past a "9 completed" check) and "nobody spends a review without knowing": the button reads **"Uses one credit if the review completes"**.

### One in-progress review per document
- Enforced inside the start-review transaction **plus** a partial unique index `UNIQUE(document_id) WHERE status='in_progress'` as a hard backstop. A second request → HTTP 409 carrying the **active review's id**, so the UI can immediately start following it.

### The start-review transaction (order matters; one `better-sqlite3` `.immediate()` transaction)
1. **Persist timeouts first:** mark every overdue `in_progress` review as `failed('timeout')`. This must precede the checks — at t=61s a GET may already report a review failed by the deadline rule while its row still says `in_progress`; without this step the unique index would wrongly reject a legitimate retry whenever the timeout timer hasn't fired yet. (Tested with the timer deliberately disabled.)
2. Check no active review remains for the document.
3. Check `available > 0` on the quota.
4. Insert the new `in_progress` review.

The reviewer is launched only **after** this transaction commits; if launching throws, that attempt is immediately marked `failed('launch_error')`, releasing the reservation. The POST still answers 201 with that failed review: the row exists, and its state is the truth.

### 60-second deadline (the core correctness rule)
- `requested_at + 60s` is authoritative. Every fake-AI event (finding / completion / failure) is applied through a guarded write: allowed only while `status='in_progress' AND now < deadline`. A late completion/finding is discarded and the review marked `failed('timeout')` — it never becomes completed and never consumes the plan.
- A `setTimeout` at +60s persists the timeout promptly so polling flips the status on time; reads additionally treat overdue `in_progress` rows as failed.
- Consequence (intended by the brief): the "slow" 1-in-10 reviews (60–120s) always fail at 60s; tests pin this down. A retry is a brand-new review row.

### Race conditions — the hard part, handled explicitly

Correctness rests on SQL semantics — transactions, conditional writes, constraints — never on the driver or on timing. One honest caveat on portability: the conditional writes and the unique index carry to PostgreSQL as-is, but the **quota check would need its own locking there** (`SELECT … FOR UPDATE` on a plan row, or an advisory lock): under PostgreSQL's default isolation, two transactions for *different* documents can both read "9 used" and insert, and the per-document unique index does not protect the shared quota. SQLite's single-writer model plus `.immediate()` transactions is what makes the plain count-then-insert safe here. Three disciplines:

1. *Check-and-write in one transaction.* `requestReview` runs the four-step `.immediate()` transaction above (persist timeouts → active-review check → quota check → insert). Two lawyers racing for the last credit, or for the same document, cannot both pass. `.immediate()` takes the write lock up front: a default *deferred* transaction can hit a lock-upgrade `SQLITE_BUSY` under contention across connections, a case a single in-memory test connection would never exercise.
2. *Every state transition is a conditional write* (compare-and-swap style). Completion: `UPDATE reviews SET status='completed' ... WHERE id=? AND status='in_progress' AND :now_ms < requested_at_ms + 60000` — the deadline compares against the **application's injected clock, bound into the SQL as a parameter**, never SQLite's own `datetime('now')`, so tests that advance fake timers exercise the exact same guard the production path uses. Finding inserts are guarded the same way. Whoever writes first wins; the loser's write affects 0 rows and its event is discarded. So a completion arriving at t=65s is rejected even if the timeout timer is late, and a timeout firing just after a legitimate completion changes nothing.
3. *DB constraints as backstop.* Partial unique index `UNIQUE(document_id) WHERE status='in_progress'` makes a double in-progress review impossible even if application logic ever regresses.

Specific races and their outcome:
- Two simultaneous requests on the same document → one gets 201, the other 409 with the active review's id (transaction + unique index).
- Retry at t=61s before the timeout timer fired → step 1 of the start-review transaction persists the `timeout` first, so the unique index cannot wrongly block the retry.
- Two requests racing for the last quota slot → one reserved, one rejected (single transaction).
- Fake-AI completion vs 60s timeout around t=60 → the conditional writes serialize it; a review can end exactly once, and never completed after the deadline.
- Late findings after failure/timeout → guarded insert rejects them (parent no longer `in_progress`).
- Retry vs the old review's late events → events are keyed by **review id**, and a retry is a new row, so stale events can never touch the new review.
- Month rollover mid-review → `used` and `reserved` are both keyed to the month of `requested_at`, so a review spanning the boundary charges the month it started in; a review lives ≤60s, so the window is tiny, but it is tested, not assumed away.

### The reviewer — a separate entity behind a port

The fake AI is built as its own component (`api/src/reviewer/`) that never touches the database and knows nothing about quotas or HTTP. The boundary is an explicit interface:

- `ReviewerPort.start(reviewId, findingsScript)` — fire and forget;
- the reviewer emits events back: `finding(reviewId, finding)`, `completed(reviewId)`, `failed(reviewId, reason)`;
- the domain layer is the **only** place those events are applied, always through the guarded conditional writes above.

Today the adapter is in-process (`setTimeout`-driven). One single outcome roll — **70% normal completion (5–30s), 20% engine error, 10% slow completion (60–120s)** — makes each branch explicit, instead of two independent rolls that would silently make 2% of runs both slow *and* failing. The error branch fails at a random point, possibly before any finding. Completion is scheduled **separately from the findings**, so a document with zero findings (the Brightline Advisory consulting agreement) still takes its intended duration. RNG and clock are injected so tests are deterministic.

The port keeps the domain clean and is where a real reviewer service would plug in later (HTTP call out, webhook endpoints backed by the same guarded event-application functions) — but that move is *not* claimed to be free: remote delivery introduces duplicate and out-of-order events, which would additionally require idempotent, sequence-aware event application. Out of scope here; the boundary just keeps the option open. The API never trusts the reviewer's liveness or honesty: the 60s deadline is enforced on the API side regardless of what the reviewer does.

### Failure matrix — what breaks, and what the system does

| Failure | Behavior |
|---|---|
| Review fails (the scripted 1/5 error) | Reviewer emits `failed` → review marked failed with the reason, quota slot released, partial findings kept but stamped "from a failed review — incomplete". Retry = new review. |
| Reviewer hangs, crashes, or never calls back | The API doesn't wait on it: the 60s deadline (API-side timer + overdue-read rule) fails the review with reason `timeout`, frees the slot. Any event the reviewer sends later hits a guarded write and is discarded. |
| API server crashes/restarts | All authoritative state is in SQLite, so nothing is lost. **Restart policy (one rule):** at startup, overdue `in_progress` reviews are marked `failed('timeout')` and all remaining `in_progress` reviews `failed('interrupted')` — the in-process reviewer died with the server, so they can never finish. Explicit assumption: **exactly one API process**. A second process running this sweep would kill the first one's live reviews, so going multi-process requires moving the reviewer out of process first. |
| Both at once / partial writes | Each event is applied in its own transaction: a crash between two findings loses nothing already committed, and the review's fate is still decided solely by its row's status + deadline. |

### REST endpoints
- `GET /api/lawyers` — each with the workspaces they belong to
- `GET /api/workspaces/:id` — name + members
- `GET /api/workspaces/:id/documents` — the documents the workspace owns, each with its latest review and its last completed review
- `GET /api/workspaces/:id/plan` — `{workspaceId, month, limit, used, reserved, available, resetsAt}`
- `GET /api/documents/:id` — document + latest review (with findings) + most recent *completed* review (for the "previous result" panel)
- `POST /api/sessions` `{lawyerId}` → 201 `{token, lawyerId, ttlMs}`, or 409 `lawyer_in_use`. There is one live session per lawyer (primary key on `lawyer_sessions.lawyer_id`). Claims run in an immediate transaction and expire on the injected clock: live while `now < last_seen_ms + 30s`.
- `PUT /api/sessions/current` (heartbeat, `Authorization: Bearer <token>`) → 200, or 401 `session_expired`.
- `DELETE /api/sessions/current` → 204 (switch lawyer).
- `POST /api/documents/:id/reviews` (`Authorization: Bearer <token>`; the requester is the session's lawyer, never the body) → 401 `session_required`/`session_expired`, or 201; 409 `review_in_progress` (payload carries the active review's id so the UI follows it); 409 `plan_exhausted` or `slots_reserved` (payload carries `resetsAt`)
- `GET /api/reviews/:id` — status + findings so far (the per-review polling endpoint; the UI polls `GET /api/documents/:id` instead, since that one response carries both the latest review and the previous completed one)
- `previousCompletedReview` is returned only while the latest review is **not** completed (running or failed). Once a newer review completes, it is the final result and older ones are not shown.

## 4. Frontend plan

- **Lawyer choice first:** the first screen asks who is using the app (the lawyers from the API). Nothing in the workspace, documents included, is shown until one is picked. The choice persists in localStorage. "Switch lawyer" in the header returns to that screen and to the documents list, so the next lawyer never lands on the page (for example a running review) the previous one had open. A direct link opened before choosing still leads to that page once a lawyer is picked.
- **One browser per lawyer:** picking claims the lawyer's session. A lawyer in use elsewhere is shown "In use" and can't be picked.
  - The app heartbeats every 10s while its tab is visible and used in the last 15 minutes. Sessions end 30s after the last heartbeat, so a forgotten tab never locks anyone out for long.
  - If a session ended and the lawyer is still free, it is quietly renewed. If someone else took the lawyer, you go back to the picker with the reason.
  - With no credentials (per the brief), this prevents simultaneous use of one account but is not authentication.
- **Header** (once a lawyer is picked): identity only, always one line. It shows the workspace, "Working as <name> (<title>)" and a ⇄ Switch button; long text truncates, and narrow screens drop the labels.
- **Plan indicator**, shown at the right of the "Documents" heading and in each document's request box (usage belongs where reviews are requested, not in the header): a **colored circle with the available count inside** — green (>3), yellow (≤3), red (0). Red distinguishes its two causes: all credits **used** → reset date + "Get more reviews" link → mock upgrade page; remaining credits merely **reserved** by running reviews → "may free up shortly", no upgrade pitch.
- **Documents list:** a search box and status filters under the heading.
  - The search matches every word, ignoring case and accents, across title, type and uploader.
  - Each filter shows its count: All / Reviewed (has a current result) / In progress / Last review failed / Not reviewed. Filters can overlap: a failed re-review is both Reviewed and Last review failed.
  - Each row shows title, type, pages, uploaded date; **"Superseded"** badge on the old Bristol lease (the data contains a `supersedes` chain — still reviewable, but visibly outdated); review status as short chips on one line, always in the same place, leading with the **current result** (last completed review, from `lastCompletedReview` in the workspace's documents list). Details sit behind an ⓘ tooltip (hover, focus or tap): requester, cause, credit, next step. Each failure reason has its own next step. States:
  - Not reviewed;
  - Review in progress (elapsed); the tooltip names the current result it may replace;
  - Reviewed <date> · N findings / no issues found;
  - a failed re-review: the earlier result chip plus "Newer review failed" ⓘ;
  - a failure with no earlier result: "Review failed · no result yet" ⓘ.

  A failure that a later review completed is history and is not shown. So for completed → failed → completed, only the third review is the result.
- **Document detail:**
  - Request button with honest cost copy — **"Uses one credit if the review completes"** — alongside the available count; disabled with the specific reason (review already running / all credits used / remaining credits reserved).
  - In-progress panel: elapsed time + findings streaming in under the "partial results" banner.
  - Failed: clear error, partial findings kept but stamped incomplete, Retry button (= new review).
  - Previous completed review kept below, badged with its completion date, while a new one runs.
  - Completed review with **zero findings** (the Brightline Advisory consulting agreement in the data) renders an explicit "No issues found" — never an empty/ambiguous state.
  - `clause: null` / `excerpt: null` findings render gracefully ("General" / no quote block).
- **Polling with explicit handoffs:** TanStack Query, ~1s refetch while a review is in progress, ~5s otherwise (picks up other lawyers' actions in the shared workspace). Query invalidation at every transition — after a successful start, after a `review_in_progress` 409 (the only 409 that carries a review id: switch to following it; `plan_exhausted` and `slots_reserved` instead refresh the plan and show their respective message), and when a followed review reaches a terminal state — refetching the document and the plan together, so the review panel and the quota circle can never tell different stories.

## 5. Testing plan (where the rules live)

API integration tests (Vitest + supertest, in-memory SQLite, fake timers, seeded RNG):
- Quota: credit reserved at request, released on failure, spent on completion; `used`/`reserved`/`available` reported distinctly (9 completed + 1 running → `slots_reserved`, never `plan_exhausted`); an 11th completed review is impossible; month rollover resets; a review requested 30 Nov that completes 1 Dec spends a November credit (request-month policy); failed reviews never count.
- Concurrency: second request on the same document → 409 carrying the active review id; other documents unaffected.
- Last-credit race across documents: seed nine completed reviews, submit two concurrent start requests for *different* documents → exactly one 201, the other 409 `slots_reserved` (the same-document test covers a different rule and does not substitute for this one).
- 60s rule, on the **same injected clock the SQL guards use** (bound as a parameter, never SQLite's own `now`): completion at 59,999 ms succeeds, completion at 60,000 ms fails — asserted *before* any timeout callback runs; late findings are discarded and never consume the plan.
- Retry admission: with the timeout timer deliberately disabled, a retry at t=61s succeeds because the start-review transaction persists the `timeout` first.
- Races: completion vs timeout at the boundary resolves to exactly one terminal state; stale events from a previous review never touch its retry.
- Crash/failure cases: a reviewer that goes silent → review fails at 60s with the slot freed; the startup sweep applies the restart policy (overdue → `timeout`, remaining → `interrupted`); a reviewer launch error marks that attempt failed; events for a non-in-progress review are discarded.
- Restart with a **file-backed** database (the in-memory tests only exercise the sweep logic): close and reopen the SQLite file, run startup → overdue reviews become `timeout`, unexpired in-progress ones become `interrupted`, and completed reviews with their findings survive untouched.
- Streaming: findings become visible incrementally through `GET /api/reviews/:id`.
- Added after the independent review: a two-connection race for the last credit (two worker threads, one paused inside its admission transaction), the unique-index fallback mapped to 409, an engine failure at exactly +60s recorded as `timeout`, an overdue unpersisted review not holding the last credit, an early-firing timer re-arming, the startup sweep at the exact 60s boundary, and a November review still running in December.
- Added after a second review pass: a retry admitted at exactly +60s (not only 61s), the last credit freed at exactly +60s (refused `slots_reserved` one millisecond earlier), and a slow run at its minimum duration (exactly 60s) whose completion lands on the deadline tick and still times out.

One frontend test is **mandatory**, pinning the product decision the whole exercise argues about: render a previous completed result beside a new review's streaming partial findings, fail the new review, and assert that the partial findings are clearly labeled incomplete while the previous result remains visible. Further frontend tests are optional; no coverage target or report — the backend rules plus this one UI invariant are the coverage that matters, and the README says so.

## 6. Deliverables

Deliverables checklist: README (run instructions for app + tests, the three decisions with reasons, assumptions, limitations, AI tools used and how).

## 7. Assumptions & limitations

- Calendar month in UTC; workspaces are modeled (documents owned by one, lawyers in several, plan per workspace) but the sample data seeds a single one, and there is no UI to create workspaces or manage members; **exactly one API process** (the startup sweep and the in-process reviewer both assume it — see the restart policy); the reviewer runs in-process behind the `ReviewerPort` boundary (no job queue, no second server; the port keeps a future extraction possible, though remote delivery would additionally need duplicate and out-of-order event handling).
- Superseded documents remain reviewable but are visibly badged.
- The mock "Get more reviews" page changes nothing real (billing out of scope per the brief).
- Polling instead of SSE, chosen for simplicity (see the tech stack section).
