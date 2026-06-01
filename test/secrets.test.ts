import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore, resolveTemplate } from '../src/config/secrets.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stv-sec-'));
  delete process.env.SECRET_OPENWEATHER;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SECRET_OPENWEATHER;
});

describe('SecretStore', () => {
  it('reads secrets from a JSON file', () => {
    const p = join(dir, 'secrets.json');
    writeFileSync(p, JSON.stringify({ openweather: 'file-key' }), 'utf8');
    const store = new SecretStore(p);
    expect(store.get('openweather')).toBe('file-key');
  });

  it('prefers env SECRET_<UPPER> over the file', () => {
    const p = join(dir, 'secrets.json');
    writeFileSync(p, JSON.stringify({ openweather: 'file-key' }), 'utf8');
    process.env.SECRET_OPENWEATHER = 'env-key';
    const store = new SecretStore(p);
    expect(store.get('openweather')).toBe('env-key');
  });

  it('returns undefined for unknown secrets and tolerates a missing file', () => {
    const store = new SecretStore(join(dir, 'nope.json'));
    expect(store.get('whatever')).toBeUndefined();
  });
});

describe('resolveTemplate', () => {
  const secrets = new SecretStore(undefined);

  it('substitutes config placeholders (dotted paths)', () => {
    const out = resolveTemplate('https://api/{{config.city}}/{{config.nested.id}}', {
      config: { city: 'paris', nested: { id: 42 } },
      secrets,
    });
    expect(out).toBe('https://api/paris/42');
  });

  it('substitutes secret placeholders', () => {
    process.env.SECRET_OPENWEATHER = 'abc123';
    const s = new SecretStore(undefined);
    const out = resolveTemplate('Bearer {{secret.openweather}}', { config: {}, secrets: s });
    expect(out).toBe('Bearer abc123');
  });

  it('resolves unknown placeholders to empty string rather than leaking braces', () => {
    const out = resolveTemplate('x={{config.missing}}y={{secret.missing}}', { config: {}, secrets });
    expect(out).toBe('x=y=');
  });

  it('resolves the time namespace (now / nowMs / rangeStart)', () => {
    const ctx = { config: { rangeSeconds: 600 }, secrets, nowMs: 1_000_000 };
    expect(resolveTemplate('{{time.now}}', ctx)).toBe('1000');
    expect(resolveTemplate('{{time.nowMs}}', ctx)).toBe('1000000');
    expect(resolveTemplate('{{time.rangeStart}}', ctx)).toBe('400'); // 1000 - 600
  });

  it('defaults rangeStart to a 1h window when rangeSeconds is absent', () => {
    expect(resolveTemplate('{{time.rangeStart}}', { config: {}, secrets, nowMs: 7_200_000 })).toBe('3600'); // 7200 - 3600
  });

  it('applies the |url filter to percent-encode a value', () => {
    const out = resolveTemplate('q={{config.q|url}}', { config: { q: 'a b&c=d' }, secrets });
    expect(out).toBe('q=a%20b%26c%3Dd');
  });
});
