---
tags: [plan-brief]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

plan this: lawyers want to cancel a review that's still running. add POST /api/reviews/:id/cancel and a Cancel button in the live review panel. I've already decided the rules: only the lawyer who requested it can cancel, only while it's in progress, no confirmation dialog, and a cancelled review is failed with reason `cancelled` and frees its credit. write the plan so we can run it in parallel sessions, don't implement anything
