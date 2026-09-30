# AgentScope by ozy — implementation plan

## Decisions

Build a local Node 24 service and React workspace with strict TypeScript. SQLite owns durable state; credentials use a passphrase-unlocked authenticated vault. Provider adapters, tool execution, permissions, indexing, skills, memory and orchestration have separate modules. The browser never calls providers or receives saved credentials. No hosted service or telemetry.

The supplied repositories are instruction libraries rather than agent runtimes. Reuse permitted skill assets with pinned revisions, attribution and original licenses. Do not merge their agent-specific configuration into our runtime. Anthropic's document skills are excluded because their license is not open source. Review OpenAI licenses individually. skills.sh is a discovery directory, not a single universally licensed package; bundling the entire changing directory is not a reproducible distribution policy.

## Delivery order

1. Inspect reference repositories and licenses; record decisions and provenance.
2. Establish typed contracts, SQLite migrations, credential vault and local API security.
3. Implement provider adapters and a cancellable execution loop with real tool feedback.
4. Implement workspace boundaries, optimistic file edits, checkpoints, terminal and permission approvals.
5. Add indexed retrieval, symbols, hash caches, bounded tool output and honest token accounting.
6. Bundle original and compatible community skills; add skill management, plugin manifests and MCP.
7. Add persistent memory, workflows, opt-in delegation and explicit model comparison.
8. Build the live workspace, onboarding, settings, changes, usage and command palette.
9. Test boundaries, provider protocol fixtures, agent-tool round trips and browser flows.
10. Document supported capabilities and unverified integrations without claiming production certification.

## Verification gates

Type checking and production builds must pass. Tests must cover denied/out-of-root writes, stale edits, symlinks, secret persistence/redaction, permission cancellation, real file edit and restoration, provider serialization, compression, skill selection, memory scoping, budget enforcement and workflow execution. Fixture-based model tests must be identified as fixtures. Live paid-provider acceptance requires a user-supplied key; do not fabricate it.
