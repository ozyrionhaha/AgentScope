import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fixture } from './helpers.ts';
import { Vault } from '../server/vault.ts';
import { Providers, type ModelRequest } from '../server/providers.ts';
import { providerSchema, type Provider } from '../shared/contracts.ts';
import { providerNeedsVault } from '../shared/provider-auth.ts';

const passphrase = 'authentication-regression-passphrase';
function request(kind: Provider['kind'] = 'ollama', baseUrl = 'https://ollama.com'): ModelRequest {
  const provider = providerSchema.parse({
    id: 'p',
    name: 'Test provider',
    kind,
    baseUrl,
    models: [{ id: 'test-model', name: 'Test model' }],
  });
  return {
    provider,
    model: provider.models[0]!,
    system: 'test',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    signal: new AbortController().signal,
  };
}
const nativeReply = {
  message: { role: 'assistant', content: 'Hello' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 10,
  eval_count: 2,
};
const chatReply = { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] };
const replyFor = (kind: Provider['kind']) =>
  kind === 'openai'
    ? {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }],
        status: 'completed',
      }
    : kind === 'anthropic'
      ? { content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn' }
      : kind === 'gemini'
        ? { candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }] }
        : kind === 'ollama'
          ? nativeReply
          : chatReply;

test('Ollama Cloud refuses a locked vault before sending any network request, then works after unlock', async () => {
  const f = await fixture();
  try {
    const vault = new Vault(f.store);
    await vault.unlock(passphrase);
    vault.set('p', { apiKey: 'cloud-test-key', headers: {} });
    vault.lock();
    let calls = 0;
    const adapter = new Providers(vault, async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://ollama.com/api/chat');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer cloud-test-key');
      assert.equal(JSON.parse(String(init?.body)).stream, false);
      return Response.json(nativeReply);
    });
    await assert.rejects(adapter.complete(request()), /Unlock your vault.*Ollama Cloud/);
    assert.equal(calls, 0);
    assert.equal(vault.has('p').hasKey, true);
    await vault.unlock(passphrase);
    assert.equal((await adapter.complete(request())).text, 'Hello');
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});

test('missing cloud key fails locally while an unconfigured local daemon remains usable without a vault', async () => {
  const f = await fixture();
  try {
    const vault = new Vault(f.store);
    let calls = 0;
    const adapter = new Providers(vault, async (_url, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      return Response.json(nativeReply);
    });
    assert.equal(
      (await adapter.complete(request('ollama', 'http://localhost:11434'))).text,
      'Hello',
    );
    await vault.unlock(passphrase);
    await assert.rejects(adapter.complete(request()), /Ollama Cloud requires an Ollama API key/);
    assert.equal(calls, 1);
    vault.set('p', { apiKey: '', headers: {} });
    vault.lock();
    assert.equal(
      (await adapter.complete(request('ollama', 'http://localhost:11434'))).text,
      'Hello',
    );
  } finally {
    await f.close();
  }
});

for (const kind of [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'compatible',
  'ollama',
] as const) {
  test(`${kind}: sends one normalized authentication header with saved custom headers`, async () => {
    const f = await fixture();
    try {
      const vault = new Vault(f.store);
      await vault.unlock(passphrase);
      const header =
        kind === 'anthropic' ? 'X-API-Key' : kind === 'gemini' ? 'X-Goog-API-Key' : 'Authorization';
      vault.set('p', {
        apiKey: '  Bearer test-key\r\n',
        headers: { [header]: 'stale-value', 'X-Organization': 'test-org' },
      });
      const adapter = new Providers(vault, async (_url, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(
          headers.get(header),
          header === 'Authorization' ? 'Bearer test-key' : 'test-key',
        );
        assert.equal(headers.get('X-Organization'), 'test-org');
        assert.ok(!JSON.stringify([...headers]).includes('stale-value'));
        return Response.json(replyFor(kind));
      });
      assert.equal(
        (
          await adapter.complete(
            request(kind, kind === 'ollama' ? 'https://ollama.com' : 'https://provider.example/v1'),
          )
        ).text,
        'Hello',
      );
    } finally {
      await f.close();
    }
  });
}

for (const baseUrl of [
  'https://ollama.com',
  'https://ollama.com/api',
  'https://ollama.com/api/chat',
  'https://ollama.com/v1',
  'https://ollama.com/v1/chat/completions',
]) {
  test(`Ollama Cloud routes and authenticates ${baseUrl}`, async () => {
    const f = await fixture();
    try {
      const vault = new Vault(f.store);
      await vault.unlock(passphrase);
      vault.set('p', { apiKey: '', headers: { Authorization: 'Bearer header-test-key' } });
      const compatible = baseUrl.includes('/v1');
      const adapter = new Providers(vault, async (url, init) => {
        assert.equal(
          String(url),
          `https://ollama.com${compatible ? '/v1/chat/completions' : '/api/chat'}`,
        );
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer header-test-key');
        return Response.json(compatible ? chatReply : nativeReply);
      });
      assert.equal((await adapter.complete(request('ollama', baseUrl))).text, 'Hello');
    } finally {
      await f.close();
    }
  });
}

test('a restarted vault retains only credential presence, never secret values', async () => {
  const f = await fixture();
  try {
    const vault = new Vault(f.store);
    await vault.unlock(passphrase);
    vault.set('p', {
      apiKey: 'never-expose-this-key',
      headers: { 'X-Secret': 'never-expose-this-header' },
    });
    const restarted = new Vault(f.store);
    assert.deepEqual(restarted.has('p'), { hasKey: true, hasHeaders: true });
    assert.throws(() => restarted.get('p'), /Unlock/);
    assert.ok(!JSON.stringify(f.store.get('vault', 'secrets')).includes('never-expose'));
    assert.equal(
      providerNeedsVault({
        ...request('ollama', 'http://localhost:11434').provider,
        ...restarted.has('p'),
      }),
      true,
    );
    const adapter = new Providers(restarted, async () => {
      throw new Error('Should not send request');
    });
    await assert.rejects(
      adapter.complete(request('ollama', 'http://localhost:11434')),
      /Unlock your vault/,
    );
  } finally {
    await f.close();
  }
});

test('legacy vaults report unknown key presence until unlocked, then migrate without losing credentials', async () => {
  const f = await fixture();
  try {
    const vault = new Vault(f.store);
    await vault.unlock(passphrase);
    vault.set('p', { apiKey: 'legacy-key', headers: {} });
    vault.lock();
    const stored = f.store.get<Record<string, unknown>>('vault', 'secrets')!;
    delete stored.credentials;
    f.store.put('vault', 'secrets', stored);
    assert.deepEqual(vault.has('p'), { hasKey: null, hasHeaders: null });
    await vault.unlock(passphrase);
    assert.equal(vault.get('p').apiKey, 'legacy-key');
    vault.lock();
    assert.deepEqual(vault.has('p'), { hasKey: true, hasHeaders: false });
  } finally {
    await f.close();
  }
});

test('401 diagnostics identify the destination and supplied auth without exposing response secrets', async () => {
  const f = await fixture();
  try {
    const vault = new Vault(f.store);
    await vault.unlock(passphrase);
    vault.set('p', { apiKey: 'test-key', headers: {} });
    const adapter = new Providers(vault, async () =>
      Response.json({ error: 'test-key secret-from-proxy' }, { status: 401 }),
    );
    await assert.rejects(adapter.complete(request()), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Ollama Cloud.*401.*https:\/\/ollama.com\/api\/chat/);
      assert.match(error.message, /authentication header was sent/);
      assert.doesNotMatch(error.message, /test-key|secret-from-proxy/);
      return true;
    });
  } finally {
    await f.close();
  }
});

test('real HTTP transport receives a single Bearer header and parses the native response', async () => {
  const f = await fixture();
  let captured: string | undefined;
  const server = createServer((req, res) => {
    captured = req.headers.authorization;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(nativeReply));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const vault = new Vault(f.store);
    await vault.unlock(passphrase);
    vault.set('p', { apiKey: 'wire-test-key', headers: { Authorization: 'Bearer stale-key' } });
    const result = await new Providers(vault).complete(
      request('ollama', `http://127.0.0.1:${address.port}`),
    );
    assert.equal(captured, 'Bearer wire-test-key');
    assert.equal(result.text, 'Hello');
  } finally {
    server.close();
    await once(server, 'close');
    await f.close();
  }
});
