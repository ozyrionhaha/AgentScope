import type { Provider } from '../shared/contracts.ts';
import { isOllamaCloud, providerNeedsVault } from '../shared/provider-auth.ts';
import type { Vault } from './vault.ts';

export interface Credential {
  apiKey: string;
  headers: Record<string, string>;
}

export function normalizeCredential(value: Credential): Credential {
  const apiKey = value.apiKey
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (/\s/.test(apiKey))
    throw new Error('API keys cannot contain whitespace. Paste only the API key.');
  const headers = new Headers();
  for (const [name, headerValue] of Object.entries(value.headers)) {
    if (/^(host|cookie|origin|content-length|connection|transfer-encoding)$/i.test(name)) {
      throw new Error(`Header ${name} is reserved.`);
    }
    try {
      headers.set(name, headerValue.trim());
    } catch {
      throw new Error('Custom headers must have valid HTTP names and single-line values.');
    }
  }
  return { apiKey, headers: Object.fromEntries(headers) };
}

export function providerHeaders(provider: Provider, vault: Vault): Headers {
  const unlocked = vault.status().unlocked;
  if (!unlocked && providerNeedsVault({ ...provider, ...vault.has(provider.id) })) {
    throw new Error(
      `Unlock your vault to use ${isOllamaCloud(provider) ? 'Ollama Cloud' : provider.name}. Saved credentials stay encrypted after a restart; no request was sent.`,
    );
  }
  const credentials = normalizeCredential(
    unlocked ? vault.get(provider.id) : { apiKey: '', headers: {} },
  );
  const headers = new Headers(credentials.headers);
  headers.set('content-type', 'application/json');

  const keyHeader =
    provider.kind === 'anthropic'
      ? 'x-api-key'
      : provider.kind === 'gemini'
        ? 'x-goog-api-key'
        : 'authorization';
  // Headers.set is case-insensitive: a saved Authorization header and an API
  // key must not become "Bearer old, Bearer new" on the wire.
  if (credentials.apiKey)
    headers.set(
      keyHeader,
      keyHeader === 'authorization' ? `Bearer ${credentials.apiKey}` : credentials.apiKey,
    );
  if (provider.kind === 'anthropic' && !headers.has('anthropic-version'))
    headers.set('anthropic-version', '2023-06-01');

  const cloud = isOllamaCloud(provider);
  if (cloud && !/^Bearer\s+\S+$/i.test(headers.get('authorization') ?? '')) {
    throw new Error(
      'Ollama Cloud requires an Ollama API key. Add it in Models → Edit provider → API key (ollama.com/settings/keys). Signing in to the local Ollama app does not authenticate direct requests to ollama.com. No request was sent.',
    );
  }
  if (
    ['openai', 'anthropic', 'gemini', 'openrouter'].includes(provider.kind) &&
    !headers.get(keyHeader)
  ) {
    throw new Error(
      `${provider.name} API key is missing. Add it in Models → Edit provider → API key. No request was sent.`,
    );
  }
  return headers;
}

export function authenticationFailure(
  provider: Provider,
  endpoint: string,
  status: number,
  headers: Headers,
): string {
  const sent =
    headers.has('authorization') || headers.has('x-api-key') || headers.has('x-goog-api-key');
  return (
    `${isOllamaCloud(provider) ? 'Ollama Cloud' : provider.name} rejected authentication (HTTP ${status}) at ${endpoint}. ` +
    (sent
      ? 'An authentication header was sent. Check that the saved key belongs to this provider and has not been revoked; replace it in Models → Edit provider.'
      : 'No authentication header was sent. Add the endpoint’s credentials in Models → Edit provider.')
  );
}
