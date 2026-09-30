---
name: backend
description: "Implement backend services, validation and resilient application boundaries."
license: MIT
---

# backend

Define request and response contracts before wiring handlers. Validate untrusted inputs, enforce authorization at the resource boundary and keep persistence separate from transport. Bound payloads and timeouts. Use structured errors, idempotency where needed and graceful process shutdown.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
