# Message templates

Every message to the user has three parts: a first line with the status and the main point, the facts, and the user's next action. The rules are in `SKILL.md`, "Messages to the user". Use these templates as a shape, not as fixed text.

## 1. Questions before the plan

Use this when a decision changes the architecture, the scope or the phases. Send it after the review and before any plan. When the structured question tool is available, send the same content through it; this text form is for chat without it.

```markdown
**Decision needed: 2 decisions before I write the plan for <target>.**

What I found:
- <fact with evidence>
- <fact with evidence>
- Gap: <the finding that makes the decision necessary>

1. **<Decision in one sentence>** <Why it matters now, in one sentence.>
   - A (recommended): <option>. <What it changes.>
   - B: <option>. <What it changes.>
   If this waits: <effect>.
2. **<Decision>** ...

Answer 1 and 2, and I write the plan.
```

## 2. Plan ready

```markdown
**Ready: plan for <target> is in <path>. <N> phases, <M> steps, in <repos>.**

- Delivers: <the goal in one sentence>.
- Critical findings handled: <I1 -> step 1.2>, <G1 -> step 2.1>.
- Open questions: <list, or "none">.
- Blocked until answered: <steps, or "none">.
- Before I can start: <a precondition the user must meet, such as a first commit or uncommitted changes in the checkout, or "nothing">.

Approve, and I create `plan/<slug>` from `main`, switch to it, and start phase 1 in <k> sessions (<step names>). Each session commits only on its own step branch; nothing is merged or pushed without you. Or say "run it here" and I run the steps one by one in this session.
```

A short-form plan ends with "Approve, and I make the change here." instead, since it has no plan branch and no sessions.

In plan mode, the plan file holds the plan and `ExitPlanMode` asks for the approval. That click does not say where the steps run, so right after it, ask the last line above with the question tool.

## 3. Phase report

```markdown
**Done: phase <N> of <total> (<name>). All <k> steps passed the gate.**

- <step>: <real output>. <The check that passed.>
- <step>: <real output>. <The check that passed.>
- Changes to the plan: <what changed and why, or "none">.
- New findings: <ID and one line, or "none">.

Merge `refs/heads/<step branch>` and `refs/heads/<step branch>` into `<plan branch>`? Then I run the checks there and start phase <N+1> (<steps>, <k> sessions).
```

The last line is always the merge question, because the next phase starts from the merged plan branch. After the last phase, it asks to merge and then run the whole-branch review instead.

Use `At risk` in place of `Done` when a step passed but a new finding threatens a later phase.

## 4. Blocked

```markdown
**Blocked: step <N.M> stopped. <What failed, in one sentence.>**

- Evidence: <command or file:line> shows <fact>.
- Affects: <steps and phases that cannot continue>.
- Not affected: <steps that continue>.

Options:
1. (recommended) <option>. <What it changes.>
2. <option>. <What it changes.>

Choose 1 or 2.
```

## 5. Final report

```markdown
**Done: <goal in one sentence>.**

| Step | Output | Status |
|------|--------|--------|
| 1.1 | <link or path> | done |

- Not done: <list, or "nothing">.
- Not verified: <what no check has proved yet, or "nothing">.

<What the user must do now: open a PR from the plan branch, merge it into `main`, or nothing.>
```

## Before and after

Before:

> I have explored the repository and reviewed how the export pipeline works. To ensure we build a robust solution that handles edge cases gracefully, there are a few considerations we might want to align on, though I went ahead and drafted a plan assuming a 24-hour window and append mode. Let me know your thoughts.

After:

> **Decision needed: 1 decision before I write the plan.**
>
> What I found:
> - The export flow runs daily at 03:00 UTC.
> - The target table has no key and the job appends rows.
> - Issue: a rerun of a failed job writes duplicate rows.
>
> 1. **How must a rerun update the table?** The write method decides the design of every later step.
>    - A (recommended): overwrite the partition of the run date. A rerun is safe and the cost is low.
>    - B: merge on the record key. This also handles updates across days, but it scans more data.
>    If this waits: I cannot design the write step or the backfill.
>
> Answer A or B, and I write the plan.
