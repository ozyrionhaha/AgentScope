---
name: databases
description: "Inspect database schema, transactions and connection behavior."
license: MIT
---

# databases

Identify the database engine and migration history. Use read-only inspection first. Check constraints and transaction boundaries. For writes, plan rollback and verify the target environment. Never run destructive schema changes on production as an incidental step.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
