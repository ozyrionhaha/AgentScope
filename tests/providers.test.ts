import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';
import { Vault } from '../server/vault.ts';
import { Providers, usage } from '../server/providers.ts';
import { providerSchema, type Model, type Provider } from '../shared/contracts.ts';
const model: Model = {
  id: 'fixture-model',
  name: 'Fixture',
  contextSize: 128000,
  maxOutput: 2048,
  tools: true,
  vision: false,
  inputPrice: 2,
  outputPrice: 8,
  cachedPrice: 0.5,
};
async function adapter(
  kind: Provider['kind'],
  payload: unknown,
  check: (body: Record<string, unknown>, headers: Headers) => void,
) {
  const f = await fixture();
  try {
    const vault = new Vault(f.store);
    await vault.unlock('fixture-passphrase');
    vault.set('p', { apiKey: 'fixture-key', headers: { 'X-Custom': 'custom' } });
    const provider = providerSchema.parse({
      id: 'p',
      name: 'Fixture',
      kind,
      baseUrl: 'https://provider.example/v1',
      models: [model],
    });
    const fetcher: typeof fetch = async (_url, init) => {
      check(JSON.parse(String(init?.body)) as Record<string, unknown>, new Headers(init?.headers));
      return new Response(JSON.stringify(payload), { status: 200 });
    };
    return await new Providers(vault, fetcher).complete({
      provider,
      model,
      system: 'System instructions',
      messages: [{ role: 'user', content: 'Find the bug.' }],
      tools: [
        {
          name: 'repo_search',
          description: 'Search',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      signal: new AbortController().signal,
    });
  } finally {
    await f.close();
  }
}
test('OpenAI adapter serializes real tools and parses usage and calls', async () => {
  const result = await adapter(
    'openai',
    {
      output: [
        { type: 'function_call', call_id: 'c1', name: 'repo_search', arguments: '{"query":"bug"}' },
      ],
      status: 'completed',
      usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 40 } },
    },
    (body, headers) => {
      assert.equal(headers.get('authorization'), 'Bearer fixture-key');
      assert.equal(headers.get('X-Custom'), 'custom');
      assert.equal(body.max_output_tokens, 2048);
      assert.ok(Array.isArray(body.tools));
    },
  );
  assert.equal(result.toolCalls[0]?.arguments.query, 'bug');
  assert.equal(result.usage.input, 100);
  assert.equal(result.usage.cached, 40);
  assert.equal(result.usage.cost, 0.00022);
});
test('Anthropic adapter uses native message blocks and accounts cached input', async () => {
  const result = await adapter(
    'anthropic',
    {
      content: [
        { type: 'text', text: 'Inspecting.' },
        { type: 'tool_use', id: 'c', name: 'repo_search', input: { query: 'auth' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 60, output_tokens: 10, cache_read_input_tokens: 40 },
    },
    (body, headers) => {
      assert.equal(headers.get('x-api-key'), 'fixture-key');
      assert.equal(headers.get('anthropic-version'), '2023-06-01');
      assert.equal(body.system, 'System instructions');
    },
  );
  assert.equal(result.toolCalls[0]?.name, 'repo_search');
  assert.equal(result.usage.input, 100);
  assert.equal(result.usage.cost, 0.00022);
});
test('Gemini adapter preserves function thought signatures for subsequent turns', async () => {
  const result = await adapter(
    'gemini',
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: 'repo_search', args: { query: 'auth' } },
                thoughtSignature: 'signed-context',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 10,
        thoughtsTokenCount: 5,
        cachedContentTokenCount: 40,
      },
    },
    (body, headers) => {
      assert.equal(headers.get('x-goog-api-key'), 'fixture-key');
      assert.ok(body.systemInstruction);
    },
  );
  assert.equal(result.toolCalls[0]?.signature, 'signed-context');
  assert.equal(result.usage.output, 15);
});
test('Ollama and compatible adapters preserve missing usage as unknown', async () => {
  for (const kind of ['ollama', 'compatible', 'openrouter'] as const) {
    const result = await adapter(
      kind,
      { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] },
      (body) => assert.equal(body.max_tokens, 2048),
    );
    assert.equal(result.text, 'Hello');
    assert.equal(result.usage.input, null);
    assert.equal(result.usage.cost, null);
  }
});
test('pricing never invents costs when counts or prices are missing', () => {
  assert.equal(usage({ ...model, inputPrice: undefined }, 'p', 100, 10, 0).cost, null);
  assert.equal(usage(model, 'p', null, 10, null).cost, null);
  assert.equal(usage(model, 'p', 100, 10, 0, true).cost, null);
});
test('provider errors never include raw response bodies containing secrets', async () => {
  const f = await fixture();
  try {
    const vault = new Vault(f.store);
    await vault.unlock('fixture-passphrase');
    vault.set('p', { apiKey: 'fixture-key', headers: {} });
    const provider = providerSchema.parse({
      id: 'p',
      name: 'P',
      kind: 'openai',
      baseUrl: 'https://example.com/v1',
      models: [model],
    });
    const fetcher: typeof fetch = async () =>
      new Response('secret-in-provider-error', { status: 401 });
    await assert.rejects(
      new Providers(vault, fetcher).complete({
        provider,
        model,
        system: 's',
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      }),
      (error) =>
        error instanceof Error &&
        error.message.includes('401') &&
        !error.message.includes('secret-in-provider-error'),
    );
  } finally {
    await f.close();
  }
});
