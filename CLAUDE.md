# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A law firm's contract-review flow: lawyers in a shared workspace request AI reviews of documents, watch findings stream in, and read the results, under a monthly quota and a 60-second deadline. README.md is the full description and is kept in step with the code; PLAN.md is the design written before coding.

- `api/`: Express 5 + TypeScript + SQLite (`better-sqlite3`, WAL). All the rules live here.
- `web/`: Next.js 16 App Router + React + TanStack Query + Tailwind.
- `samples/`: seed data. Each package installs and runs on its own (no npm workspaces).

## Working rules

- Never add AI conversation logs, session transcripts or time-tracking records to the repo, in any form.
- Write docs and comments in plain language: short sentences, and explain a technical term the first time it appears.
- A change in behaviour updates README.md in the same change: endpoints, settings, data model, the test counts in "Tests", limitations.
- Don't commit or push unless the user asks.
- Real Claude API calls cost money. Make one only with the user's OK; the tests never need one.
- When a change is done, the `reviewer` subagent can check it. Name the change or the branch in its prompt; with no name, it reviews all uncommitted changes.
- Plans follow the `plan-brief` skill (`.claude/skills/plan-brief/`): a "Plan at a glance" table first, then phases of steps that can run in parallel, and findings with evidence. Small changes use its short form.

## Commands

```bash
npm run install:all                       # install api/ and web/
cd api && npm run dev                     # API on :4000 (PORT=4001 to move it), tsx watch
cd web && npm run dev                     # web on :3000; API_ORIGIN=http://localhost:4001 if the API moved
npm test                                  # both suites from the root
cd api && npx vitest run tests/deadline.test.ts   # one API file
cd api && npx vitest run -t "60,000 ms"           # one API test by name
cd web && npx vitest run tests/document-review.test.tsx
npm run check                             # type-check api and web, lint web (api has no linter)
cd web && npm run build                   # production build
cd api && npm run show-request -- <document id>   # print the exact request sent to Claude; calls nothing
curl -sf http://localhost:4000/api/lawyers        # smoke check against a running API
```

The database is `api/data/contract-reviewer.db`, created and seeded on first start. Delete it to reset. Every start re-seeds lawyers, documents, scripts and contract texts idempotently and never touches reviews.

The reviewer subagent (`.claude/agents/reviewer.md`) takes its test, type-check, lint and smoke-check commands from this section, so keep the heading.

## Architecture

- **Settings:** every rule and timing (the deadline, the monthly limit, the session lifetime, both reviewers' timings and limits) is in `api/config.json`, read and checked once at startup by `api/src/config.ts` (through `startup.ts`, shared by `main.ts` and `scripts/show-request.ts`). `CONFIG_FILE` picks another file. The code holds no copy of these values: the API tests read the same file (`TEST_CONFIG`, `DEADLINE`, `LIMIT`, `SESSION_TTL` in `api/tests/helpers.ts`) and never write a setting's number themselves, and the web app reads them from the API (`GET /api/settings`, and each review's `deadlineAt`).
- **Request path:** the browser only talks to Next.js, which rewrites `/api/*` to Express (`web/next.config.ts`), so there is no CORS. Every page is client-rendered and polls through TanStack Query (`web/src/lib/queries.ts`): every 1s while a review runs, every 5s otherwise.
- **API layers:** `routes/api-router.ts` only translates HTTP → the domain (`domain/review-service.ts`, `domain/sessions.ts`, `domain/quota.ts`) holds every rule → `db/repository.ts` holds all SQL. `bootstrap.ts` `createServer()` is the composition root for both `main.ts` and every test.
- **Reviewer boundary:** `reviewer/port.ts`. The domain calls `start(reviewId, job)`, where the job carries the document, its contract text, the firm's client and the fake's script. The reviewer reports back through `onFinding` / `onCompleted` / `onFailed` and never touches the database. There are two implementations. The simulated one is always offered; with `ANTHROPIC_API_KEY` set the server also offers Claude, and the lawyer picks the AI for new reviews with a switch in the header and in the request box (`web/src/components/ReviewerSwitch.tsx`; stored as `reviews.reviewer`):
  - `fake-reviewer.ts` (default): replays the scripted findings with one outcome roll per run, 70% normal (5–30s), 20% error, 10% slow (60–120s), from `fakeReviewer` in the settings. It deliberately keeps emitting after the deadline.
  - `claude-reviewer.ts` (offered when the server has an API key): see below. A request for it on a server without it is refused (409 `reviewer_unavailable`) before anything is charged.
- **Review history:** `GET /api/documents/:id/reviews`, shown at `/documents/[id]/history`. Every review newest first; each completed one is compared with the previous completed one by `findingKey` (`domain/finding-key.ts`: same clause and quote, ignoring typography; also how the Claude reviewer drops repeats). Failed or running reviews are never compared. The AI never sees earlier findings: reviews stay independent.
- **Sessions:** one live session per lawyer (`lawyer_sessions`, `sessionTtlMs` = 30s). The web app heartbeats every third of it (`web/src/lib/session-keeper.ts`). Review requests need the Bearer token, and the requester is always the session's lawyer, never the request body.

## Rules that must hold

- **Every review state change goes through `ReviewService`, as a guarded write:** `… WHERE status = 'in_progress' AND :now < deadline_at_ms`. Each review's `deadline_at_ms` is fixed when it is requested: `requested_at_ms` + `reviewDeadlineMs` (60000). A late or duplicate event changes 0 rows and is discarded. The deadline and quota never trust the reviewer.
- **Time:** integer epoch milliseconds from the injected `Clock`, bound into SQL as a parameter. Never use SQLite's `now`, or `Date.now()` in domain or repository code (`systemClock` in `domain/time.ts` is the only source).
- **Admission is one `.immediate()` transaction, in this order:** persist overdue timeouts → at most one in-progress review per document → quota → insert. The reviewer starts only after the commit. A partial unique index backs up the second step.
- **Quota:** `monthlyReviewLimit` per UTC calendar month per workspace (1000 in `api/config.json`; the brief's is 10), charged to the month the review was requested. `used` counts completed reviews, `reserved` counts in-progress ones before their deadline, and failures are free. The refusals `plan_exhausted` and `slots_reserved` are deliberately distinct.
- **A finished review never changes.** A retry is a new row.
- **One API process.** The startup sweep turns running reviews into `timeout` or `interrupted`.
- **UI:** a running or failed review's findings are labeled partial or incomplete. The last completed review stays visible, labeled "Previous", until a newer one completes. A failed review never says "No issues found".

## Tests

- API tests run on virtual time, with the settings in `api/config.json` (`setup({ config })` changes a value for one test; `docsFor(n)` gives documents for a whole month's plan). `completeReviews` fills a plan through the domain, not HTTP: every supertest request takes a local port for ~30 s, and a plan of 1,000 over HTTP ran the machine out of ports (`connect EADDRNOTAVAIL` in the next run). `tests/helpers.ts` `setup()` wires `createServer` to `VirtualTime`, a clock and timer queue shared by the deadline timers and the reviewer. `setNow` moves the clock without firing timers, which is how a test delivers an event exactly at the deadline before the timeout runs. `manualReviewer()` lets a test emit reviewer events by hand, and `scriptedRng` drives the fake. Nothing sleeps.
- `tests/cross-connection.test.ts` races two SQLite connections to one file, in worker threads (`tests/race/`).
- Claude reviewer tests replace the SDK with a scripted `ClaudeApi` stand-in. No test calls the real API.
- The key rules were mutation-checked. When changing a rule, break it on purpose and confirm a test fails.

## Claude reviewer (`api/src/reviewer/`)

- **Settings:** `claudeReviewer` in `api/config.json`: model `claude-haiku-5-5`, effort `low`, thinking off, token budget 30000, 4 turns, 8000 output tokens per call. `REVIEWER_MODEL`, `REVIEWER_EFFORT`, `REVIEWER_THINKING` and `REVIEWER_TOKEN_BUDGET` override them, and `ANTHROPIC_API_KEY` (which turns Claude on) is only read from the environment or `api/.env` (git-ignored; see `api/.env.example`). `REVIEWER` is no longer used. Tests never pass a real key to a child process. A wrong value stops the API at startup.
- **Request shape:** `buildRequest` is the single source of it, used by the reviewer and by `scripts/show-request.ts`.
- **One finding per tool call:** Claude reports each finding through one `report_finding` call (`eager_input_streaming`). Each call becomes `onFinding` as soon as it completes and passes `check-finding.ts`: valid fields, and an excerpt that appears word for word in the contract. A rejected call gets an `is_error` tool result with the reason. At most `maxTurns` (4) turns.
- **Token budget per review:** before each call, the input is counted with `countTokens` and `max_tokens` is set to what is left (at most `maxOutputTokens`). If too little is left, the review fails without the call.
- **Deadline:** at the deadline the reviewer aborts its own API call and reports nothing. The domain records the timeout.

## Sample data

- `samples/documents.json` and `samples/lawyers.json` keep the original brief's format: don't add fields.
- Contract text lives in `samples/contracts/<document id>.md`, with the firm's client in the front matter (`client: Tidewater Systems Ltd (the Supplier)`). Every scripted excerpt must appear word for word in its contract, and a test checks each scripted finding with `checkFinding`.
- Useful documents (ids in `api/tests/helpers.ts` `DOC`): the master services agreement `2a5580ec…` has 20 findings, the longest stream; the consulting agreement `1efd34ae…` has none; the lease `361e1bda…` supersedes `c6e11de5…`.
- The seed creates one workspace, "Firm workspace", that owns every document and has every lawyer as a member.

## Next.js 16

From `web/AGENTS.md`: this Next.js version has breaking changes from older ones. Read the relevant guide in `web/node_modules/next/dist/docs/` before writing Next.js code. `next dev` re-adds that block to `web/AGENTS.md`, so commit it rather than removing it.
