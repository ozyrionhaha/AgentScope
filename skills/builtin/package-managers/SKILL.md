---
name: package-managers
description: "Install dependencies and debug package resolution or lockfiles."
license: MIT
---

# package managers

Detect the package manager from the lockfile and scripts. Use the existing manager. Inspect package versions, peer constraints and package exports before changing versions. Preserve a single authoritative lockfile. Review lifecycle scripts before executing newly introduced dependencies.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
