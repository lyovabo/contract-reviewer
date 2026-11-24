---
name: plan-brief
description: Plan format and workflow for this repo - a "Plan at a glance" table first, findings with evidence, questions for real decisions, and phases whose steps run in parallel sub-sessions with a review gate after each phase. Use it when you write or revise a plan (in plan mode before ExitPlanMode, or when the user says "make a plan", "plan this", "break this down" or "what are the phases"), when you implement an approved plan, start or review its sub-sessions or report its progress, and when the user runs /plan-brief. Not for a quick question about how the code works or which approach is better.
argument-hint: "[plan file path]"
---

# Plan brief: readable plans, run phase by phase

## Why this exists

A detailed plan helps the agent implement. It does not help the person who approves the plan and follows the work. The user reads a plan to decide and to track, not to implement. They also want the work to go fast, so steps that do not depend on each other run at the same time in separate sessions. A plan therefore has two layers and one rhythm:

1. **Plan at a glance**, for the user. Short. Answers four questions for every step: what, where, what comes out, and why.
2. **Details**, for the agent. As long as the work needs. Files, commands, tests, interfaces, risks.
3. **Phases**, the rhythm. A phase is a set of steps that can run in parallel. The main session plans and reviews. Sub-sessions do the steps. One phase at a time.

Plan as an architect who reviews the current state before proposing work. A list of tasks is not a plan. A plan shows what is missing, what is wrong now and what can fail later, and which step handles each of those. The user approves the plan and makes the decisions. The architect finds the facts.

Two terms used below:

- **Sub-session:** a separate Claude session that does one step, in its own worktree (a second checkout of the repo, on its own branch).
- **Plan branch:** the branch where the steps' work comes together, phase by phase. It is cut from `main`.

## When this applies

- **Plan mode.** Before you present the plan (before `ExitPlanMode`), write the plan in this format. The plan is what the user reads and approves, so the glance table goes at its top.
- **A plan in chat.** The user asks for a plan, phases, steps or a breakdown. Answer with the glance section. Add the details section only when the plan will be implemented.
- **Implementing a plan.** Follow "The workflow" below. Keep the status columns current and report progress in the same words as the tables.
- **`/plan-brief`** with no argument: rewrite the plan from this conversation into this format, keeping its content. With a path: rewrite that plan file in place.
- **Not for** a question about how something works, or a quick opinion on an approach. Answer those directly.

## Short form

A small change does not need phases or sessions. Use the short form when all of these hold:

- The work is one step, in one package (`api/` or `web/`) plus the README.md lines that describe it, or in docs only.
- No decision is open for the user.
- It changes none of the "Rules that must hold" in `CLAUDE.md`, and nothing in it spends money.

The short form has the title, the Goal, Why, Where and Done when lines, a one-row step table (`Runs in: main`) and that step's Details. Add the Findings table only when there are findings, and "Not in scope" only when something is left out on purpose. The main session does the step, with the same review before it is called done. When the work grows past these limits, switch to the full format and say so.

## The format

Use this template. Keep the headings as they are, so the user finds the same sections in every plan.

```markdown
# <Title: the change in a few words>

## Plan at a glance

**Goal:** <one sentence: what exists when this is done>
**Why:** <one or two sentences: the problem, request or risk behind the work>
**Where:** <repos, and folders inside them, in order; "none" for a pure reading task>
**Done when:** <the check, test or review that proves it is finished>
**Branch:** plan branch `plan/<slug>`, cut from `main`
**Models:** main session <model, effort>; hard steps <model, effort>; mechanical steps <model, effort>

| Phase | Name | Steps (run in parallel) | Where | Output | Why this order | Status |
|-------|------|-------------------------|-------|--------|----------------|--------|
| 1 | <name> | 1.1 <step>, 1.2 <step> | <repos> | <what the phase delivers> | <why it comes before the next> | todo |
| 2 | ... | ... | ... | ... | ... | todo |

**Key findings:** <the critical gaps, issues and risks only, by ID, each with the step or gate that handles it: "I1 retries are unlimited -> step 2.1", or "none critical">
**Open questions:** <decisions only the user can make, in the question format, or "none">
**Constraints:** <fixed limits the plan must respect: rules, cost, timing, access; or "none">
**Not in scope:** <what this plan leaves out on purpose, or "nothing">

## Phase 1: <name>

**Gate:** <what the main session checks before phase 2 starts>
**Combine:** <how the outputs come together; usually "each step branch is merged into the plan branch, with the user's OK">

| # | Step | What | Where | Output | Why | Runs in | Status |
|-----|------|------|-------|--------|-----|---------|--------|
| 1.1 | <short name> | <one sentence, verb first> | <repo, folder> | <something you can open or check> | <one sentence> | sub-session, Opus 5.5 | todo |
| 1.2 | ... | ... | ... | ... | ... | sub-session, Sonnet 5.5 | todo |

## Phase 2: ...

## Changes to the plan

| Date | Step | Change | Why |
|------|------|--------|-----|
| (none yet) | | | |

## Findings

| ID | Type | Finding | Evidence | Impact if ignored | Severity | Handled in |
|----|------|---------|----------|-------------------|----------|------------|
| G1 | gap | <a required capability that is missing> | <file:line, command and result, or document> | <what fails or stays wrong> | critical / major / minor | step X.Y, gate N, or "not in scope, user agreed" |
| I1 | issue | <a problem that exists now> | ... | ... | ... | ... |
| R1 | risk | <a failure that can happen later> | ... | ... | ... | ... |

## Details (for the agent)

### Step 1.1: <short name>

- Files: <exact paths to create or change>
- Commands: <what to run, with the expected result>
- Tests: <which test proves this step>
- Review: <code steps only: the reviewer and its prompt, run on this step's uncommitted diff before it commits; findings fixed or listed for a decision>
- Risks: <what could break, and the fallback>
- Done criteria: <what the main session checks at the gate; for a code step this includes "review ran, findings fixed">

### Step 1.2: ...
```

A plan with one phase is fine. It still uses the phase table, so every plan reads the same way.

## Rules for the tables

These rules exist so the user can read the tables in a minute and still know everything that matters.

- **Phase:** a group of steps that can run at the same time, ending in something the user can review on its own. Two to four steps is a good size, because the gate reviews every one of them. One step is fine when a dependency forces it.
- **Steps in one phase are independent:** no step needs another's output, none touches the files another touches, none must land in the same commit as another. If two steps share a file, put them in the same step or in different phases. Each step works in its own worktree, on its own step branch cut from the plan branch.
- **Shared docs get their own step.** A file that many steps want to edit (README.md and CLAUDE.md here) gets one step in a later phase. Each earlier code step's `Review:` line names that step, so its review does not report the missing doc update. This still meets CLAUDE.md's rule that README.md changes in the same change: the plan branch is the change, and the doc step lands on it before any PR.
- **Dependencies decide the phase order.** A step whose output another step needs goes in an earlier phase. A dependency across repos (an access grant in an infrastructure repo before the code that uses it) is always a phase boundary. Say so in "Why this order".
- **Step:** a short name, 2 to 5 words, numbered `phase.step`. The same name appears in the details section, in the sub-session brief, in progress messages and in any task list.
- **What:** one sentence, verb first, 15 words or fewer. Say what happens, not how.
- **Where:** the repo, the folder when it helps (`contract-reviewer (api/)`), and the branch when known. A step that only reads a repo still names it. A step that touches no repo names the system instead: `GitHub`, `Anthropic Console`, `chat`.
- **Output:** a thing the user can open or check. A file path, a branch, a PR, a command and its expected result, a decision, a number. Never "updated code" or "done".
- **Why:** one sentence that ties the step to the goal, a constraint or a finding. If you cannot write a reason, question the step.
- **Runs in:** `sub-session` plus the model for that step (`sub-session, Opus 5.5` for a hard step, `sub-session, Sonnet 5.5` for a mechanical step; see "The workflow"), or `main`. The main session keeps planning, review, merging (with the user's OK) and short-form steps for itself.
- **Status:** one of `todo`, `doing`, `done`, `blocked`, `skipped`. Plain words, so the table reads the same in a terminal, a diff and a web page.
- **Verification lives inside the step.** Each step's Done criteria say how the sub-session proves its work: a test, a command, a check. Take the commands from the repo's `CLAUDE.md` ("Commands"). A plan that puts "add tests" in the last phase leaves every earlier phase unproven.
- **Every code step ends with a code review, before it commits.** The sub-session runs the repo's reviewer on its own uncommitted diff, fixes the findings, lists the ones it leaves for the user, and only then commits on its step branch. In this repo the reviewer is the `reviewer` subagent (`.claude/agents/reviewer.md`), or `/code-review`, with a neutral prompt that names the change: "review the uncommitted changes for step 1.2 against README.md and CLAUDE.md. README.md and CLAUDE.md are updated in step 3.1, so a missing doc update is not a finding." A code step without a review is not done. The main session's gate review and the whole-branch review before any PR come on top of it, because a reviewer that sees one small diff finds what a reviewer of the whole branch skims past.
- **Size:** the header lines and the phase table fit on one screen, about 40 lines. The key findings, open questions, constraints and not-in-scope lines may run longer, because the user must read them in full to decide.
- **One copy:** when the plan lives in a file, the chat message does not repeat the tables. It names the file and lists the open questions. When the plan lives only in chat, the glance section is the message.

## Rules for the details section

- One `### Step N.M` per table row, with the same name.
- Put here what a detailed plan would hold: exact file paths, function names, commands, test names, interfaces, edge cases, risks. The sub-session that runs the step gets this section as its brief, so it must be complete enough to work from alone.
- Do not repeat the What, Where, Output and Why. Refer to them by the step number.
- Write down the decisions the implementer cannot make alone: which files, which names, which values, which tests. Leave out the reasonable choices the implementer can make alone.
- Every code step has a `Review:` line that names the reviewer and its prompt. A step that changes no code (a document, a decision, a read-only check) leaves the line out.

## Review before you plan

Do this review before you write any step. Its result is the Findings table.

1. **Read the rules of each repo the work touches:** its `CLAUDE.md` or `AGENTS.md`, its docs and its own skills and agents. A repo's own rules come before general practice. In this repo that means `CLAUDE.md` (its "Working rules" and "Rules that must hold"), `README.md` and `PLAN.md`.
2. **Read the current state:** the code, the configuration and the documents that the change touches.
3. **Find the tests that guard it.** For each rule the change touches, find the test that proves it today. A rule with no test is a gap, and the step that changes the rule adds the test.
4. **Compare the repo with what runs,** where something runs outside the repo (a deployed service, a database with real data). Use only read-only checks that the repo's rules allow. When you cannot check, record an unknown.
5. **Write the findings.** Use these three words, with one meaning each:
   - **Gap:** a required capability is missing.
   - **Issue:** a problem exists now.
   - **Risk:** a failure can happen later.

Rules for the Findings table:

- Each finding has an ID (`G1`, `I1`, `R1`), evidence and a severity. Evidence is something the user can open or run: a file and line, a command with its result, a document. A finding with no evidence is an unknown, not a finding.
- Each finding names what handles it: a step, a gate, or "not in scope" with the user's agreement. A finding with nothing in that column means the plan is not complete.
- Steps that handle a finding name its ID in their Why column.
- Only critical findings go in "Key findings". The full table stays lower in the plan, so the glance section stays short.
- Match the depth to the change. A small change reviews only the areas it touches. Do not redesign what the request did not ask about. Record what you saw outside the scope as a finding marked "not in scope" and let the user decide.

## Ask, never assume

A plan built on a guess is wasted when the guess is wrong. Before you plan, sort everything you do not know:

| Kind | Meaning | What you do |
|------|---------|-------------|
| Confirmed | Code, configuration, a document or a check supports it. | Use it. Keep the evidence. |
| Unknown | A fact that exists somewhere, and you have not found it yet. | Find it yourself. Never ask the user what a file or a read-only command can answer. |
| Decision | Only the user can choose: scope, a target, severity, a trade-off, a cost. | Ask. Never choose in silence. |
| Constraint | A fixed limit: a rule, a cost, a date, an access boundary. | Write it in "Constraints" and plan inside it. |

- **An unknown you cannot resolve now** becomes a probe step in phase 1, with a gate. The later phases stay provisional until that gate passes. Say so in the plan.
- **No guess words in an approved plan.** Do not write "probably" or "likely" for a fact. Either you confirmed it, or it is an unknown with a probe step, or it is a question.
- **When to ask:**
  - A decision that changes the architecture, the scope or the phases: stop after the review. Do not draft the full plan. Send what you found and the questions, then wait.
  - A decision that affects one step only: draft the plan, put the question in "Open questions" and mark that step `blocked`.
  - Ask only when the answer changes scope, design, cost, security, reliability or ownership.
- **How to ask.** Put all questions in one message, at most four, blocking ones first. Use the structured question tool when there is one. Each question has:
  1. the decision, in one sentence,
  2. why it matters now,
  3. two to four options, each with what it changes,
  4. your recommendation, first in the list, when the evidence supports one,
  5. what happens if the decision waits.

## The workflow

The main session is the planner and the reviewer. Sub-sessions are the workers. The main session runs at high effort, because planning and review are where judgement pays. Each sub-session runs on the model its step needs. Today's defaults (update them when newer models ship):

- **Main session:** Claude Opus 5.5 at high effort.
- **Hard step:** Claude Opus 5.5 at high effort.
- **Mechanical step:** Claude Sonnet 5.5 at high effort.

Choose the model per step when you write the plan, and write it in the step's "Runs in" cell:

- A step is **hard** when a mistake is costly or hard to see: security, access, a rule that guards money or data (in this repo: the quota, the 60-second deadline, the guarded writes, the token budget), a schema change or a migration, concurrency, a prompt sent to a model, a design choice, or a step that depends on an unknown.
- A step is **mechanical** when the brief fixes what to write and a check proves it: documents, fixtures, copy text, configuration, renames, and tests for behaviour that is already decided.
- When you are not sure, the step is hard.
- When a mechanical step fails its gate twice, run the fix on the hard-step model and record the change in "Changes to the plan".

A sub-session cannot use a stronger model or a higher effort than the main session. The app ignores a higher value without an error. So the main session runs on the hard-step model or a stronger one, at the highest effort any step uses. If it does not, say so in the plan-ready message. The user can change the defaults per plan. When a default is not available where you run, use the closest match and write what you used in the "Models" line.

### 1. Plan (main session)

1. Do the review ("Review before you plan"). Write the findings.
2. Sort what you do not know ("Ask, never assume"). Resolve the unknowns you can.
3. When a decision changes the architecture, the scope or the phases, ask now and wait. Do not draft the plan first.
4. Draft the plan in the format above. Give every finding a step, a gate or an agreed "not in scope". Turn each unknown that remains into a probe step.
5. Make the plan efficient and safe: merge steps that are too small, split steps that two sessions could do at once, and check that each phase can really run in parallel.
6. Check the preconditions for sub-sessions:
   - The repo has at least one commit (`git log -1`). Worktrees and branch diffs need one. If there is none, the plan-ready message says so. The user makes the first commit, or tells you to.
   - The main checkout has no uncommitted changes that the plan branch would carry along (`git status`). If it has some, the plan-ready message names them.
7. Run the self-check below. Present the plan for approval with the "plan ready" message.

### 2. Approval gate (user)

The user approves the plan. The main session starts no step before that. One answer from the user covers four things, so the plan-ready message names all four:

- the plan itself,
- creating the plan branch from `main` and switching the main checkout to it (`git switch -c plan/<slug> main`); if the main session already runs in its own worktree, its branch is the plan branch and nothing is created,
- each sub-session committing on its own step branch. `CLAUDE.md` allows a commit only when the user asks, and this answer is that request, for step branches only. A commit on `main` or the plan branch, a merge and a push each need their own OK,
- starting phase 1's sub-sessions now.

The user must say this in their own words. In the Claude desktop app, a session starts at once only when the user has asked for separate sessions; otherwise the app shows a card the user has to click. In plan mode, the approval click on `ExitPlanMode` does not say where the steps run. So right after that click, ask once with the question tool: "Start phase 1 in <k> sessions now?", with the options to start the sessions or to run the steps here.

If the user wants the steps run here, the main session runs them one at a time, in phase order, on the plan branch. Skip the sessions, not the reviews and gates.

An open question blocks its step and every step whose design depends on the answer: mark them `blocked`. Start only the steps that the answer cannot change.

### 3. Run a phase (sub-sessions)

Start sub-sessions only on a turn the user started. In the desktop app, a turn that began with another session's report cannot start a session. That is why each new phase starts right after the user answers the merge question at the gate.

For every step in the phase, start one sub-session, all in the same turn so they run together:

- **In the Claude desktop app:** `start_session` with `initiation: "user_asked"` (the user's answer at the approval gate is the request), `context: "fresh"`, `use_worktree: true` for a step that writes code, `source_branch` set to the plan branch, `branch_name` set to the step name as a slug, and the step's `model` and `effort`. Without `source_branch`, the worktree is cut from `main` and misses the earlier phases. The app adds a prefix and a suffix to the branch name, so record the real branch from the session's report.
- **In the terminal:** one subagent per step, with the step's model and `isolation: "worktree"`, started from the main checkout while the plan branch is checked out. Parallel subagents without their own worktrees edit the same files. Or the user starts `claude --worktree <step-name>` sessions from the plan branch.

Each brief is self-contained, because the sub-session knows nothing else. Give it:

- the step's row (what, where, output, why) and its Details section,
- the plan's Goal and Not in scope, so it does not wander,
- a first command that installs the dependencies (`npm run install:all` here), because a new worktree has no `node_modules`,
- the Done criteria and what to report back: the step branch and its commit, what it changed, how it proved it, what the review found and what it fixed, what it could not do,
- for a code step, the review to run on its own uncommitted diff (the `Review:` line), and the rule that it commits only after the findings are fixed or listed for a decision,
- the rules to stay inside its own files, to commit only on its own step branch, and to push and merge nothing,
- that the browser preview is not available in a worktree (`.claude/launch.json` is git-ignored), so browser checks happen at the gate,
- the repo's cost rule: no check that spends money (such as a live model API call) without the user's OK.

The main session does not do a step's work itself while sub-sessions run. It waits for their reports, answers their questions, and keeps its context for the review. Set each step to `doing` when its session starts.

### 4. Phase gate (main session)

When every sub-session of the phase has reported:

1. Review each output against the step's Output and Done criteria. A report is a claim, not proof.
   - Read the diff from the main checkout: `git diff <plan branch>...<step branch>`. Never check a step branch out in the main checkout.
   - Run the quick, free checks (tests, type-checks, lint) in the step's own worktree folder. `git worktree list` shows which folder holds which branch.
   - A check that spends money waits for the user's OK, at a gate too.
   - For a code step, read the review result in the report. A code step whose review did not run, or whose findings are neither fixed nor listed for a decision, goes back to its sub-session before anything else is checked.
2. When an output has a gap, a defect or a new risk, send the fix request to the same sub-session, with the exact finding. It has the context. Do not fix it in the main session.
3. When every output passes, set the steps to `done` with their real outputs, and the phase to `done`.
4. Update the plan: what the phase taught (a new constraint, a wrong assumption, a step that is no longer needed), rows in "Changes to the plan", and the next phase's steps revised to match. New risks get a step or a gate.
5. Report to the user with the "phase report" message: phase done, outputs, changes to the plan, new findings, what the next phase does. Its last line asks to merge the step branches into the plan branch, each named by its full ref (`refs/heads/...`). Wait for the answer.
6. On the user's yes, merge the step branches into the plan branch as the phase's "Combine" line says. Run the full checks there (`npm test` and `npm run check` from the root), plus any browser check the gate names. Then start the next phase in the same turn, from the updated plan branch. Stop and ask instead only when a check fails or the plan change is one the user should decide.

### 5. Finish

When the last phase is merged and its checks pass, run the whole-branch review: the `reviewer` subagent with the plan branch named in its prompt (it compares the branch with `main`). Then add a "Delivered" table under "Plan at a glance": step, real output, status. Say plainly what was not done or not verified. Opening a PR or merging the plan branch into `main` waits for the user to ask. Offer to archive the finished sub-sessions.

## Tracking

The plan is also the progress board. Keep it true.

- Status changes happen when they happen: `doing` when a sub-session starts, `done` or `blocked` at the gate, with the real Output in the cell.
- When the work departs from the plan, add a row to "Changes to the plan" (date, step, what changed, why). Never diverge silently. A plan that no longer matches the work is worse than no plan.
- The plan records decisions and status. It holds no conversation transcript and no time tracking.
- Progress messages in chat use the step and phase names from the tables, one line each: "Phase 1 done: 1.1 failure reasons on its branch, 1.2 web messages on its branch. Next: merge, then phase 2 (1 session)."
- When the environment has a task-list tool, create one item per step, with the same step names, in phase order. The desktop app's list holds at most 12 items, so a longer plan gets one item per phase. The pinned list and the plan then show the same thing.

## Messages to the user

The user reads to know the state, to see the risks and to decide. These rules apply to the glance layer of the plan and to every chat message about the plan: questions, the plan-ready message, phase reports, blockers and the final report.

**Order of every message:**

1. **First line:** a status word and the main point. The status words are `Ready`, `Decision needed`, `Blocked`, `At risk` and `Done`.
2. **Facts:** five bullets or fewer, or one small table. Include a fact only when the user would decide or act differently without it.
3. **Last line:** what the user must do now (answer, approve, run a command), or what happens next.

**Words:**

- Sentences of 20 words or fewer. Active voice. One idea per sentence.
- One word for one thing. Do not call the same thing a flow, a workflow and a pipeline in one plan.
- Keep exact names for repos, files, functions, endpoints and error codes. Define a new term once, in ten words or fewer.
- State the mechanism, not the quality. Do not write "ensure", "properly", "robust", "gracefully", "seamless", "leverage", "as needed" or "etc.". Write what happens: "Count failed reviews since UTC midnight inside the admission transaction, and refuse the fourth."
- In a step or an instruction, use "must", "will" and "can". Do not use "should", "might" or "could" there. In a report to the user, keep "may" and "could" for real uncertainty, so a guess does not read as a fact.
- No narration of your own work ("I read four files..."). No logs. No copy of a table that is in the plan file. No code in the glance tables except names and paths.
- A command the user must run goes in its own block, one command per block, with any warning before it.

`references/messages.md` has a template for each message type. Read it before you send the first message of a plan.

## Self-check before you present the plan

- Is the plan the right size: the short form for a small change, the full format otherwise?
- Can the user see what, where, output and why for every step without opening Details?
- Do the header lines and the phase table fit on one screen?
- Can the steps of each phase really run at the same time: different files, no shared output, no shared commit? Does each phase have four steps or fewer?
- Do README.md and CLAUDE.md changes sit in one later step, and does every earlier code step's `Review:` line name it?
- Does every coding step name a repo, and is every dependency across repos a phase boundary?
- Is every Output something the user can open or check?
- Does every step have Done criteria the gate can test, with commands from the repo's `CLAUDE.md`?
- Does every sub-session step name its model, with the hard-step model for every step where a mistake is costly? Is the main session on that model or a stronger one?
- Does every code step have a `Review:` line, so its diff is reviewed before it commits and before any PR?
- Does "Done when" name a concrete check?
- Does the plan name its plan branch, and does the repo have a commit to cut it from?
- Did you review the current state, and the tests that guard it, before you wrote steps?
- Does every finding have evidence, and a step, a gate or an agreed "not in scope"?
- Did you check every fact you could check yourself, and ask every real decision?
- Is the plan free of guess words? Is every remaining unknown a probe step with a gate?
- Does any step or gate spend money? Then the plan says where the user's OK is asked.
- Are the open questions real decisions for the user, each with options, a recommendation and the effect of delay?
- Does your message start with the status and the main point, and end with the user's next action?
- Is each Details section complete enough for a session that knows nothing else?

## More

- `references/messages.md`: templates for the five message types.
- `references/example.md`: one complete plan in this format for this repo, with the question before the plan, the findings and tracking after a phase.
- `references/sources.md`: the practices this format is built from, with links.
