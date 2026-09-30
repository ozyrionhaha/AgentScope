---
name: deployment
description: "Prepare deployments, preview environments and rollback procedures."
license: MIT
---

# deployment

Identify the configured platform and existing release pipeline. Build and verify locally first. Use preview environments when authorized; production promotion is a distinct action. Check environment variable names without exposing values, health endpoints, migrations and rollback steps.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
