---
name: sql
description: "Write and optimize SQL queries, indexes and relational schemas."
license: MIT
---

# sql

Use parameterized queries. Check null behavior, duplicate rows, join cardinality and pagination stability. Inspect query plans with representative data before adding indexes. Define uniqueness and foreign-key behavior explicitly. Avoid interpolating identifiers or values supplied by users.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
