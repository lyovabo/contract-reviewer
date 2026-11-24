# Sources behind the plan-brief format

Each entry says what the format takes from it. The links were checked on 2026-11-24, and each entry claims only what its page says.

## Anthropic: Claude Code documentation

- Plan mode: https://code.claude.com/docs/en/permission-modes (section "Plan mode"). Claude analyzes before it edits, writes a plan and presents it for approval. The user can open the proposed plan in an editor (`Ctrl+G`) and change it before Claude proceeds. The glance table goes at the top of the plan because that is what the user reads, edits and approves.
- Skills: https://code.claude.com/docs/en/skills. A project skill lives in `.claude/skills/<name>/SKILL.md` and loads for everyone who works in the repo. The `description` helps Claude decide when to load the skill on its own, so it names the situations and phrases that should trigger it.
- Best practices: https://code.claude.com/docs/en/best-practices (section "Review against your spec"). A review can check the work against the plan instead of hunting for bugs in general. That only works when the plan states checkable outputs, which is why the Output column exists. The same page uses a fresh reviewer, such as a reviewer subagent or `/code-review`, that did not write the code.

## Anthropic: Claude Academy, AI-native SDLC playbook

- https://academy.claude.com/courses/ai-native-sdlc-playbook/plan-mode
- Taken: a plan names the files that change, the order of the work and the tests that prove it. The readability bar: an engineer who never saw the conversation could implement the change from the plan alone. Commit the approved plan, and update it in the same commit when the implementation departs from it. The "Changes to the plan" table and the rule "never diverge silently" come from here. The playbook asks about risks while planning; the Findings table is this format's own way to record them.

## obra/superpowers, `writing-plans` skill

- https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md
- Taken: a plan carries the decisions the implementer cannot make alone (which files, names, values, tests), and leaves the rest to them. Status tracking per step. A plan much longer than the code it describes has written the code instead. A self-review pass against the spec before presenting. The "Details" rules and the self-check list come from here. Its task shape (failing test, run, implement, run, commit) is a good shape for the Details section of a coding step.

## Anthropic: parallel sessions and subagents

- https://code.claude.com/docs/en/common-workflows (sections "Run parallel sessions with worktrees" and "Delegate research to subagents").
- Taken: parallel work needs separate checkouts (worktrees) so edits do not collide. The rule that two sessions never write the same files is what makes a phase safe to run in parallel. The phase gate, where the main session reviews each sub-session's output, applies the fresh-reviewer idea from the best-practices page.

## Plain-language writing (ASD-STE100 Simplified Technical English)

- Short sentences, active voice, one instruction per sentence, one meaning per word. Applied to the glance layer and to every message to the user, because the reader is a person deciding quickly, not an agent implementing.

## Message order: bottom line first

- Digital.gov plain language guide, "Organize the information": https://digital.gov/guides/plain-language/principles/organize
- Taken: put the most important information first, starting with the purpose and the bottom line. The three-part message order (status and main point, facts, next action) comes from here.

## Architect perspective and asking

- Anthropic, "Prompt engineering best practices": https://claude.com/resources/articles/best-practices-for-prompt-engineering
- Taken: be explicit about the perspective you want instead of writing a heavy persona, and give the model explicit permission to say it is unsure instead of guessing. The architect stance, the four kinds of unknown, the finding IDs and the proportional depth of the review build on this.

## Why a table with these columns

The person who approves a plan needs to know, for each step, what is done, where, what the output is, and why. Plans that only list detailed tasks are hard to track. The two-layer form keeps the detail for the agent and gives the user a view they can scan in a minute.
