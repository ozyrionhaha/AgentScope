---
name: cicd
description: "Create CI/CD workflows and release automation."
license: MIT
---

# cicd

Use minimal token permissions and pin external actions where practical. Separate untrusted pull-request execution from deployment secrets. Cache using correct lockfile keys. Make required checks reproducible locally. Never evaluate attacker-controlled text as shell code.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
