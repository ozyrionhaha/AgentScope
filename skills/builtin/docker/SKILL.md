---
name: docker
description: "Build or debug Docker images and Compose services."
license: MIT
---

# docker

Inspect Dockerfile stages, context and ignore files. Pin appropriate base images, keep secrets out of layers and run as a non-root user where practical. Validate health checks, port binding, volumes and graceful shutdown. Distinguish build-time configuration from runtime environment.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
