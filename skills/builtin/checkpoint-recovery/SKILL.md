---
name: checkpoint-recovery
description: "Recover agent file edits without overwriting newer user changes."
license: MIT
---

# checkpoint recovery

Inspect the recorded before state and current diff. Restore only when the current hash matches the checkpoint after hash. If it differs, explain the conflict and merge deliberately. Restore one file at a time, then rerun relevant verification. Do not use git reset to simulate a task checkpoint.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
