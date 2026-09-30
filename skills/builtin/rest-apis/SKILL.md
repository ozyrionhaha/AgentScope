---
name: rest-apis
description: "Design REST routes, pagination, idempotency and versioned contracts."
license: MIT
---

# rest apis

Choose stable resource names and correct status semantics. Validate both syntax and resource ownership. Make pagination deterministic. Include idempotency for retriable writes and concurrency controls for updates. Document error shapes and test unauthorized access across resource IDs.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
