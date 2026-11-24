# Tests for the plan-brief skill

There are two kinds of test. Both make real, billed model calls, so run them only when the skill changes.

## Trigger tests

`trigger-queries.json` holds 20 requests a user could type in this repo. Ten must load the skill: plans, phase breakdowns, reviewing a plan's sessions. Ten must not, and they are near misses: a question about how the code works, a one-line fix, "plan" in the sense of the workspace's credit plan.

`run-trigger-tests.py` sends each request to `claude -p` in the repo, 3 times. It stops each run at Claude's first tool call, before the tool runs, so nothing in the repo changes. A first call that loads `plan-brief`, or reads its `SKILL.md`, counts as a trigger. A request passes when it triggers in at least 2 of 3 runs (should load) or in at most 1 (should not).

Run it from the repo root:

```bash
python3 .claude/skills/plan-brief/evals/run-trigger-tests.py .claude/skills/plan-brief/evals/trigger-queries.json . claude-opus-5-5 3 8 150
```

The arguments are: the queries, the repo, the model, runs per query, parallel runs, and the timeout in seconds. Opus 5.5 needs Claude Code 2.1.280 or newer. If the `claude` on your PATH is older, set `CLAUDE_BIN` to a newer binary, such as the one the desktop app keeps under `~/Library/Application Support/Claude/claude-code/<version>/`.

## Behaviour tests

Each folder is one case: `prompt.md` (what the user types), `case.yaml` (what a good result looks like) and `graders/` (one check per file). The format is the one `claude plugin eval` reads.

- `short-form-small-change`: a small API change gets the short form, with one step run by the main session and the README update in the same step.
- `multi-phase-plan-branch`: a larger change gets phases, a plan branch, a model per step, the docs step last, and one approval for the plan, the branch, step-branch commits and the first sessions.
- `asks-before-planning`: a request with open design decisions gets questions first, not a plan.

These cases plan against this repo, so run them in the repo, with the repo read-only: the run writes its plan and its message to the user somewhere else.

## Last run: 2026-11-24, Claude Opus 5.5

| Test | With the skill | Without it |
|------|----------------|------------|
| Trigger tests | 20 of 20 passed (every request 3/3 or 0/3) | not run |
| `short-form-small-change` | 6 of 6 checks | 3 of 6 |
| `multi-phase-plan-branch` | 8 of 8 checks | 4 of 8 |
| `asks-before-planning` | 6 of 6 checks | 2 of 6 |

With the skill, a run used about 31% more tokens and took about 72% longer, mostly on the multi-phase case.
