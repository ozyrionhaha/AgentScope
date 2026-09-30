---
name: code-review
description: "Review changes for correctness, security, compatibility and maintainability."
license: MIT
---

# code review

Read the diff and relevant callers. Prioritize concrete regressions over style. For every finding provide the trigger, impact and source location. Check migrations and failure paths. Distinguish confirmed defects from questions. Do not modify the code unless requested.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
