# Provider authentication

AgentScope sends model requests from the local backend to the configured provider. API keys and custom header values are encrypted in the local vault; the browser receives only credential-presence flags. The vault must be unlocked after restarting the backend. A locked vault is not an empty key.

## Ollama Local and Ollama Cloud

| Connection | Base URL | Authentication |
| --- | --- | --- |
| Local Ollama | `http://localhost:11434` | Usually no key required |
| Cloud models through a local daemon | `http://localhost:11434` | Sign the local daemon into Ollama with `ollama signin` |
| Direct Ollama Cloud | `https://ollama.com` | Ollama API key, sent as `Authorization: Bearer …` |

Choose **Ollama Cloud** in Models → Add provider for direct cloud access. Create a key at <https://ollama.com/settings/keys>, enter it in the API-key field, and use the model identifier from Ollama's cloud model catalog. Signing into a local daemon does not authenticate a direct request to ollama.com.

The Ollama adapter accepts the server root, `/api`, `/api/chat`, `/v1`, and `/v1/chat/completions`. The first three use the native protocol; the last two use the OpenAI-compatible protocol. Both support cloud authentication.

Reference: [Ollama authentication documentation](https://docs.ollama.com/api/authentication).

## Keys and custom headers

OpenAI, OpenRouter, Ollama Cloud, and compatible APIs use Bearer authentication. Anthropic uses `x-api-key`; Gemini uses `x-goog-api-key`. Enter the key itself; surrounding whitespace and an accidentally pasted `Bearer` prefix are removed.

Custom headers are case-insensitive. When both a key and its corresponding authentication header are configured, the API-key field takes precedence. Other custom headers are preserved. Leaving the API-key field blank while editing a provider keeps its existing key.

Local Ollama can run with a locked vault only when it has no saved credentials. Older vault files report unknown credential presence until the first unlock, then migrate automatically without changing their keys.

## Troubleshooting

- **Unlock your vault:** enter the vault passphrase in AgentScope, then send the task again. No provider request was sent while locked.
- **API key is missing:** add the key to the selected provider under Models.
- **HTTP 401 or 403 after an authentication header was sent:** check that the key belongs to the selected provider and that the account has access. The error includes the destination, never the key or raw authentication-error body.
- After editing backend source while running `pnpm dev`, restart that process. Frontend hot reload does not reload backend code.

Regression coverage: `tests/provider-auth.test.ts`, `tests/providers.test.ts`, and `tests/provider-auth.spec.ts`. Tests use fixture keys, provider responses, and a local HTTP server; they do not spend API credits or verify a user's live provider account.
