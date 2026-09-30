---
name: authentication
description: "Implement login, sessions, OAuth and authorization."
license: MIT
---

# authentication

Prefer established authentication libraries. Trace session creation, rotation, expiry and revocation. Enforce ownership server-side. Protect cookie sessions against CSRF, use secure cookie settings and keep tokens off logs. Test expired, missing and cross-user credentials. Never invent cryptographic protocols.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
