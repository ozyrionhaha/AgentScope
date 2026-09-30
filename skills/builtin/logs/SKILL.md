---
name: logs
description: "Analyze application logs, stack traces and intermittent failures."
license: MIT
---

# logs

Find the first relevant error and correlate timestamp, request identifier and surrounding events. Separate cause from cascading failures. Retain raw logs locally while passing focused evidence to the model. Redact secrets. Add structured diagnostic fields instead of broad sensitive payload logging.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
