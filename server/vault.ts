import { randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import type { Store } from './storage.ts';
import { normalizeCredential, type Credential } from './provider-auth.ts';
const derive = promisify(scrypt);
interface Envelope {
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  credentials?: Record<string, { hasKey: boolean; hasHeaders: boolean }>;
}
export class Vault {
  private key: Buffer | undefined;
  private values: Record<string, Credential> = {};
  private salt = Buffer.alloc(0);
  constructor(private store: Store) {}
  status() {
    return { initialized: !!this.store.get('vault', 'secrets'), unlocked: !!this.key };
  }
  async unlock(passphrase: string) {
    if (passphrase.length < 12)
      throw new Error('Use a vault passphrase of at least 12 characters.');
    const stored = this.store.get<Envelope>('vault', 'secrets');
    const salt = stored ? Buffer.from(stored.salt, 'hex') : randomBytes(32);
    const key = (await derive(passphrase, salt, 32)) as Buffer;
    let values: Record<string, Credential> = {};
    if (stored) {
      try {
        const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'hex'));
        dec.setAuthTag(Buffer.from(stored.tag, 'hex'));
        values = JSON.parse(
          Buffer.concat([
            dec.update(Buffer.from(stored.ciphertext, 'hex')),
            dec.final(),
          ]).toString(),
        ) as Record<string, Credential>;
      } catch {
        key.fill(0);
        throw new Error('Incorrect vault passphrase or damaged vault.');
      }
    }
    this.lock();
    this.key = key;
    this.salt = salt;
    this.values = values;
    if (!stored?.credentials) this.save();
  }
  private save() {
    if (!this.key) throw new Error('Unlock your vault first.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(this.values)), cipher.final()]);
    const credentials = Object.fromEntries(
      Object.entries(this.values).map(([id, c]) => [
        id,
        { hasKey: !!c.apiKey.trim(), hasHeaders: Object.keys(c.headers).length > 0 },
      ]),
    );
    this.store.put('vault', 'secrets', {
      salt: this.salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      ciphertext: ciphertext.toString('hex'),
      credentials,
    });
  }
  set(id: string, value: Credential) {
    if (!this.key) throw new Error('Unlock your vault first.');
    this.values[id] = normalizeCredential(value);
    this.save();
  }
  get(id: string): Credential {
    if (!this.key) throw new Error('Unlock your vault first.');
    return this.values[id] ?? { apiKey: '', headers: {} };
  }
  has(id: string): { hasKey: boolean | null; hasHeaders: boolean | null } {
    if (this.key) {
      const c = this.values[id];
      return { hasKey: !!c?.apiKey.trim(), hasHeaders: !!c && Object.keys(c.headers).length > 0 };
    }
    const stored = this.store.get<Envelope>('vault', 'secrets');
    if (stored && !stored.credentials) return { hasKey: null, hasHeaders: null };
    return stored?.credentials?.[id] ?? { hasKey: false, hasHeaders: false };
  }
  delete(id: string) {
    if (!this.key) throw new Error('Unlock your vault first.');
    delete this.values[id];
    this.save();
  }
  redact(text: string) {
    let clean = text;
    for (const c of Object.values(this.values))
      for (const secret of [
        c.apiKey,
        c.apiKey.trim().replace(/^Bearer\s+/i, ''),
        ...Object.values(c.headers),
        ...Object.values(c.headers).map((v) => v.trim()),
      ])
        if (secret.length >= 4) clean = clean.split(secret).join('[REDACTED]');
    return clean.replace(/(Bearer\s+)[\w.\-]+/gi, '$1[REDACTED]');
  }
  lock() {
    this.key?.fill(0);
    this.key = undefined;
    this.values = {};
  }
}
