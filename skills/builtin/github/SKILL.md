---
name: github
description: "Work on pull requests, issues and GitHub Actions."
license: MIT
---

# github

Check repository identity and authentication without printing tokens. Read the issue and existing PR before editing. Ground PR descriptions in the final diff and actual tests. Do not post comments, create issues, merge or push without user authorization. Prefer structured API arguments or body files for multiline text.

## Execution discipline

Follow the user's current scope and AgentScope permissions. Load only supporting references relevant to this task. Use actual tool evidence, stop on an unexplained failure, and report what was verified and what remains uncertain. Never fabricate outputs or bypass denied actions.
