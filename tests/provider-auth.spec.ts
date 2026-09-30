import { test, expect } from '@playwright/test';
import type { Server } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { createApp } from '../server/app.ts';
import { Providers } from '../server/providers.ts';
import { cleanup } from './helpers.ts';

let application: Awaited<ReturnType<typeof createApp>>;
let server: Server, root: string, providerAdapter: Providers;
const sent: { url: string; authorization: string | null }[] = [];
const base = 'http://127.0.0.1:4396';

test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentscope-test-'));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  application = await createApp({
    root: process.cwd(),
    dataDirectory: path.join(root, 'data'),
    port: 4396,
    adapter: {
      validate(provider) {
        providerAdapter.validate(provider);
      },
      complete(request) {
        return providerAdapter.complete(request);
      },
    },
  });
  application.store.put('projects', 'fixture-project', {
    id: 'fixture-project',
    name: 'Fixture project',
    root: project,
    createdAt: new Date().toISOString(),
  });
  providerAdapter = new Providers(application.vault, async (url, init) => {
    sent.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
    return Response.json({
      message: { role: 'assistant', content: 'Cloud authentication verified by test fixture.' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 10,
      eval_count: 5,
    });
  });
  application.app.use(express.static(path.resolve('dist')));
  application.app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  server = application.app.listen(4396, '127.0.0.1');
  await once(server, 'listening');
});

test.afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  await application.close();
  await cleanup(root);
});

test('Ollama Cloud setup → encrypted key → locked-vault send → unlock → authenticated agent reply', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByLabel(/^Vault passphrase/).fill('cloud-ui-test-passphrase');
  await page.getByLabel('Confirm passphrase').fill('cloud-ui-test-passphrase');
  await page.getByRole('button', { name: 'Create encrypted vault' }).click();
  await page.getByRole('button', { name: 'Add provider', exact: true }).click();
  await page.getByRole('button', { name: 'Ollama Cloud', exact: true }).click();
  await expect(page.getByLabel('Base URL')).toHaveValue('https://ollama.com');
  await expect(page.getByText(/Required for direct Ollama Cloud requests/)).toBeVisible();
  await page.getByLabel(/^API key/).fill('  Bearer cloud-ui-test-key  ');
  await page.getByLabel(/^Model ID/).fill('fixture-cloud-model');
  await page.getByRole('button', { name: 'Save provider', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await (await page.request.get(base + '/api/state')).json();
  expect(saved.providers[0].hasKey).toBe(true);
  expect(JSON.stringify(saved)).not.toContain('cloud-ui-test-key');

  const lock = await page.request.post(base + '/api/vault/lock', {
    headers: { 'x-agentscope': '1' },
    data: {},
  });
  expect(lock.ok()).toBe(true);
  await page.reload();
  await page.getByLabel('Task prompt').fill('Say hello.');
  await page.getByRole('button', { name: 'Send task' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your API keys' })).toBeVisible();
  expect(sent).toHaveLength(0);
  expect(application.store.all('tasks')).toHaveLength(0);
  await page.getByLabel(/^Vault passphrase/).fill('cloud-ui-test-passphrase');
  await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Task prompt')).toHaveValue('Say hello.');
  await page.getByRole('button', { name: 'Send task' }).click();
  await expect(
    page.getByText('Cloud authentication verified by test fixture.', { exact: true }),
  ).toBeVisible();
  expect(sent).toEqual([
    { url: 'https://ollama.com/api/chat', authorization: 'Bearer cloud-ui-test-key' },
  ]);
  expect(errors).toEqual([]);
});
