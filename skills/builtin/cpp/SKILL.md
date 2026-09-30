---
name: cpp
description: "Develop C and C++ with attention to memory, ownership and build systems."
license: MIT
---

# cpp

Inspect compiler standard and build configuration. Make ownership and lifetime explicit, prefer RAII for C++ and disciplined cleanup for C. Check integer overflow, bounds, aliasing and threading. Use sanitizers and focused tests when supported. Do not silence diagnostics without establishing their cause.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
