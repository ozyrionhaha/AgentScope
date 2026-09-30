import type { Provider, ProviderPublic } from './contracts.ts';

type Connection = Pick<Provider, 'kind' | 'baseUrl'>;

export function isLoopbackEndpoint(baseUrl: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

export function isOllamaCloud(provider: Connection): boolean {
  try {
    return provider.kind === 'ollama' && new URL(provider.baseUrl).hostname === 'ollama.com';
  } catch {
    return false;
  }
}

// A locked vault must never silently turn an authenticated connection into an
// anonymous one. Only a loopback Ollama connection known to have no saved
// credentials can bypass the vault (including a signed-in local cloud proxy).
export function providerNeedsVault(
  provider: Connection & Pick<ProviderPublic, 'hasKey' | 'hasHeaders'>,
): boolean {
  return (
    provider.kind !== 'ollama' ||
    !isLoopbackEndpoint(provider.baseUrl) ||
    provider.hasKey !== false ||
    provider.hasHeaders !== false
  );
}
