# Example: a plan in the plan-brief format

This example is a plan for this repo, first as presented for approval, then as it looks after its first phase. It tackles two known problems of the Claude reviewer. It is an illustration of the format: it has not been implemented, and the file paths are as of when it was written.

## Before the plan: the question

The review found one decision that changes the design, so the architect asked before writing the plan.

> **Decision needed: 1 decision before I write the plan for limiting paid retries.**
>
> What I found:
> - A failed review uses no credit (`api/src/domain/quota.ts` counts only completed reviews as used).
> - Every Claude failure is stored as `engine_error` (`onFailed` in the `ReviewService` constructor).
> - Issue: a document that always fails, such as one over the token budget, can be retried without limit, and each retry is billed.
>
> 1. **How must repeated failures be limited?** The rule decides the refusal code, the query and the copy in the web app.
>    - A (recommended): at most 3 failed reviews per document per UTC day. The fourth request gets 409 `too_many_failures`. Easy to explain and to test.
>    - B: failures beyond 3 a month use a credit. Retries stay open, but the quota rules that every test relies on change.
>    If this waits: I can plan the failure reasons, but not the limit.
>
> Answer A or B, and I write the plan.

The user answered A. The plan records that answer in "Constraints".

## As presented for approval

```markdown
# Name Claude failures and limit paid retries

## Plan at a glance

**Goal:** A Claude failure says why it failed, and a document cannot fail more than 3 times in one UTC day.
**Why:** Failures are free, so retries have no spending limit (I1). Every Claude failure shows the same "error" message, even when a retry can never work (I2).
**Where:** contract-reviewer (api/, then web/ and docs).
**Done when:** `npm test` and `npm run check` pass on the plan branch, and a fourth request for a document that failed 3 times today gets 409 `too_many_failures`.
**Branch:** plan branch `plan/claude-failures`, cut from `main`
**Models:** main session Claude Opus 5.5 at high effort; hard steps Claude Opus 5.5 at high effort; mechanical steps Claude Sonnet 5.5 at high effort

| Phase | Name | Steps (run in parallel) | Where | Output | Why this order | Status |
|-------|------|-------------------------|-------|--------|----------------|--------|
| 1 | Failure reasons | 1.1 Reasons in the API, 1.2 Messages in the web app | contract-reviewer (api/, web/) | two step branches | The reason names are fixed in this plan, so API and web run in parallel on different files. | todo |
| 2 | Retry limit | 2.1 Limit failed attempts | contract-reviewer (api/, web/) | one step branch | It changes `review-service.ts`, which 1.1 also changes. | todo |
| 3 | Docs | 3.1 Update README and CLAUDE.md | contract-reviewer | one step branch | Every step changes behaviour the README describes, and 2.1 changes a rule in CLAUDE.md. One step edits both, after the others, so no two sessions write them. | todo |

**Key findings:** I1 paid retries are unlimited -> step 2.1. R1 a new failure reason breaks existing databases -> step 1.1, gate 1.
**Open questions:** none (the limit was decided: answer A).
**Constraints:** At most 3 failed reviews per document per UTC day (user's decision). Failures stay free. No live Claude call in any test or gate without the user's OK.
**Not in scope:** A monthly spending limit for the whole workspace. Recorded as I3.

## Phase 1: Failure reasons

**Gate:** Both step branches pass `npm test` and `npm run check` in their worktrees. After the merge, the plan branch passes them too, and a database file created before this change opens and keeps its reviews.
**Combine:** Each step branch is merged into `plan/claude-failures`, with the user's OK.

| # | Step | What | Where | Output | Why | Runs in | Status |
|-----|------|------|-------|--------|-----|---------|--------|
| 1.1 | Reasons in the API | Pass a failure reason from the reviewer to the stored review. | contract-reviewer (api/) | `budget_exceeded` and `refused` stored, with tests | Fixes I2 at the source. Handles R1 and G1. | sub-session, Opus 5.5 | todo |
| 1.2 | Messages in the web app | Add a cause and a next step for the two new reasons. | contract-reviewer (web/) | new cases in `failureCopy` and `failureDetails`, test | The list must not tell a lawyer to retry a contract that can never fit (I2). | sub-session, Sonnet 5.5 | todo |

## Phase 2: Retry limit

**Gate:** Tests pass. The fourth request on one UTC day is refused, and the first request after UTC midnight is admitted.
**Combine:** The step branch is merged into `plan/claude-failures`, with the user's OK.

| # | Step | What | Where | Output | Why | Runs in | Status |
|-----|------|------|-------|--------|-----|---------|--------|
| 2.1 | Limit failed attempts | Refuse a review request for a document that failed 3 times today. | contract-reviewer (api/, web/) | 409 `too_many_failures`, its copy in the request box, tests | Fixes I1. | sub-session, Opus 5.5 | todo |

## Phase 3: Docs

**Gate:** README.md states the new rule, the new reasons and the new refusal. CLAUDE.md's admission order matches `review-service.ts`. The whole-branch review passes.
**Combine:** The step branch is merged into `plan/claude-failures`, with the user's OK.

| # | Step | What | Where | Output | Why | Runs in | Status |
|-----|------|------|-------|--------|-----|---------|--------|
| 3.1 | Update README and CLAUDE.md | Describe the reasons, the limit and the refusal, and update the test counts. | contract-reviewer | README.md and CLAUDE.md diff | CLAUDE.md: a behaviour change updates the README in the same change, and its rules must match the code. | sub-session, Sonnet 5.5 | todo |

## Changes to the plan

| Date | Step | Change | Why |
|------|------|--------|-----|
| (none yet) | | | |

## Findings

| ID | Type | Finding | Evidence | Impact if ignored | Severity | Handled in |
|----|------|---------|----------|-------------------|----------|------------|
| I1 | issue | A failed review uses no credit, so retries are unlimited and each one is billed. | `api/src/domain/quota.ts`; README, "The problem" | API spend grows with every retry of a document that cannot pass. | critical | step 2.1 |
| I2 | issue | Every Claude failure is stored as `engine_error`, and its next step is "retry". | `api/src/domain/review-service.ts` (`onFailed`); `web/src/lib/format.ts` (`failureDetails`) | A contract over the token budget is retried for nothing. | major | steps 1.1, 1.2 |
| R1 | risk | `reviews.failure_reason` has a CHECK constraint that lists the allowed values. SQLite cannot change it in place. | `api/src/db/schema.ts` | Storing a new reason fails on every existing database. | critical | step 1.1 rebuilds the table in `migrate()`; gate 1 opens an old database |
| G1 | gap | No test covers a reviewer failure with a reason other than `engine_error`. | `api/tests/` | A wrong mapping goes unnoticed. | minor | step 1.1 |
| I3 | issue | Nothing limits total API spend per month. | README, "The real AI reviewer" | One busy month can cost more than expected. | major | not in scope, user agreed |

## Details (for the agent)

### Step 1.1: Reasons in the API

- Files: `api/src/reviewer/port.ts` (`onFailed(reviewId, reason, message)`), `api/src/reviewer/claude-reviewer.ts` (the token budget -> `budget_exceeded`, a refusal -> `refused`, anything else -> `engine_error`), `api/src/reviewer/fake-reviewer.ts` (`engine_error`), `api/src/domain/types.ts` (`FailureReason`), `api/src/domain/review-service.ts` (`onFailed` and `applyFailure` pass the reason on), `api/src/db/schema.ts`. `api/src/db/repository.ts` already takes any `FailureReason` and does not change.
- Migration: `migrate()` checks the `reviews` table's SQL for `budget_exceeded`. When it is missing, it rebuilds the table in one transaction, copying every row and recreating the partial unique index and the other indexes.
- Tests: `api/tests/claude-reviewer.test.ts` (each reason); a file-backed test that creates the old schema, inserts a review, starts the server and reads it back.
- Review: the `reviewer` subagent, prompt "review the uncommitted changes for step 1.1 against README.md and CLAUDE.md. README.md and CLAUDE.md are updated in step 3.1, so a missing doc update is not a finding."
- Risks: losing the partial unique index would allow two running reviews of one document. The test asserts the index exists after the rebuild.
- Done criteria: review ran, findings fixed; `npm test` and `npm run check` pass from the root of the step's worktree.

### Step 1.2: Messages in the web app

- Files: `web/src/lib/types.ts` (`FailureReason`), `web/src/lib/format.ts` (a case for each new reason in `failureCopy` and `failureDetails`).
- Copy: `budget_exceeded`: cause "The contract is too long for the AI's token limit.", next step "Split the contract, or ask an admin to raise the limit." `refused`: cause "The AI declined to review this document.", next step "Review it by hand."
- Tests: `web/tests/review-state.test.tsx`: a failed review with each new reason shows its cause and next step.
- Review: the `reviewer` subagent, prompt "review the uncommitted changes for step 1.2 against README.md and CLAUDE.md. README.md and CLAUDE.md are updated in step 3.1, so a missing doc update is not a finding."
- Done criteria: review ran, findings fixed; `npm test` and `npm run check` pass from the root of the step's worktree.

### Step 2.1: Limit failed attempts

- Files: `api/src/domain/review-service.ts` (a new admission check after "one in progress per document" and before the quota), `api/src/db/repository.ts` (count failed reviews of the document since UTC midnight, with the injected clock bound as a parameter), `api/src/routes/api-router.ts` (409 `too_many_failures`), `web/src/components/RequestReview.tsx` (the refusal's copy).
- The count runs inside the admission transaction, after overdue timeouts are persisted, so a timeout whose timer has not fired yet still counts. Timeouts count like any other failure.
- Tests: three failures, then a refused fourth request; a failure at 23:59:59 UTC and an admitted request at 00:00:00 UTC; another document is not affected.
- Review: the `reviewer` subagent, prompt "review the uncommitted changes for step 2.1 against README.md and CLAUDE.md. README.md and CLAUDE.md are updated in step 3.1, so a missing doc update is not a finding."
- Risks: the admission order is a rule in CLAUDE.md. Break the new check on purpose once and confirm a test fails. Step 3.1 updates that rule's text.
- Done criteria: review ran, findings fixed; `npm test` and `npm run check` pass from the root of the step's worktree.

### Step 3.1: Update README and CLAUDE.md

- README.md sections: "The problem" (the limit), "Endpoints" (the new 409 code), "The real AI reviewer" (the reasons), "Tests: what is covered" and the test counts in "Tests".
- CLAUDE.md: "Rules that must hold" (the admission order gains the failure-limit check, between "one in-progress review per document" and the quota), "Reviewer boundary" (`onFailed` carries a reason).
- Done criteria: every new code, reason and rule in the plan branch appears in README.md; CLAUDE.md's admission order matches `review-service.ts`.
```

## After phase 1

Only the parts that changed are shown. The app added a prefix and a suffix to each step's branch name, so the Output cell holds the real refs from the sessions' reports.

```markdown
| Phase | Name | ... | Output | ... | Status |
|-------|------|-----|--------|-----|--------|
| 1 | Failure reasons | ... | `refs/heads/claude/step-1-1-reasons-x7k2`, `refs/heads/claude/step-1-2-messages-p4m9`, merged into `plan/claude-failures` | ... | done |
| 2 | Retry limit | ... | ... | ... | doing |

## Changes to the plan

| Date | Step | Change | Why |
|------|------|--------|-----|
| 2026-11-24 | 1.1 | The rebuild test also checks that each old review's findings still load. | The 1.1 review asked whether rebuilding `reviews` breaks the link from `review_findings`. |
```

What the main session said at the phase 1 gate, before the merge:

> **Done: phase 1 of 3 (Failure reasons). Both steps passed the gate.**
>
> - 1.1: reasons stored; an old database opened with its 6 reviews. API tests pass in its worktree.
> - 1.2: the list shows the new causes and next steps. Web tests, type-check and lint pass in its worktree.
> - Changes to the plan: one, recorded for 1.1. R1 is closed.
>
> Merge `refs/heads/claude/step-1-1-reasons-x7k2` and `refs/heads/claude/step-1-2-messages-p4m9` into `plan/claude-failures`? Then I run the checks there and start phase 2 (1 session).
