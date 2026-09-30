---
name: plugin-development
description: "Create AgentScope plugins combining skills, workflows and MCP servers."
license: MIT
---

# plugin development

Use agentscope.plugin.json with a stable ID, version, author and license. Include skill directories with valid SKILL.md frontmatter. MCP servers install disabled and must be explicitly enabled. Do not add install hooks or hidden network activity. Validate imported paths and preserve upstream notices.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
