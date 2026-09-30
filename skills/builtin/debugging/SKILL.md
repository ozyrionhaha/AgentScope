---
name: debugging
description: "Find and fix bugs, crashes, exceptions, incorrect results and regressions."
license: MIT
---

# debugging

Reproduce with the smallest input that demonstrates the failure. Trace values across the failing boundary. Write down a falsifiable root-cause hypothesis; test it before editing. Add a regression test that fails for the original behavior and passes for the repair. Do not hide failures by broad catches or weakening assertions.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
