---
name: coding
description: "Implement a focused feature in an existing codebase."
license: MIT
---

# coding

Identify the entry point and existing abstractions. Read project conventions and nearby tests. Make the smallest coherent change with explicit input validation. Inspect the final diff for accidental unrelated edits. Run the relevant verification command and report its actual exit status.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
