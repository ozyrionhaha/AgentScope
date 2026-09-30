---
name: refactoring
description: "Refactor or simplify a module without changing behavior."
license: MIT
---

# refactoring

Document current public behavior and callers. Establish regression coverage for edge cases before changing structure. Move responsibilities incrementally; avoid simultaneous feature changes. Preserve error semantics, ordering, side effects and performance-sensitive behavior. Review the final API and run focused tests.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
