---
name: security-analysis
description: "Review security boundaries, injection, secrets and access controls."
license: MIT
---

# security analysis

Map attacker-controlled inputs to privileged operations. Verify exploitability in scope using minimal non-destructive checks. Inspect traversal, symlinks, command construction, SSRF and authorization failures. Cite source evidence and remediation. Never claim a clean security audit from passing unit tests alone.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
