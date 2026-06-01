import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAuthConfig } from '../src/auth/config.js';
import { verifyPassword } from '../src/auth/password.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stv-auth-'));
  path = join(dir, 'auth.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('loadAuthConfig', () => {
  it('generates an admin password when nothing is configured', () => {
    const { config, generatedPassword, generatedSecret } = loadAuthConfig({ path, env: {} });
    expect(generatedPassword).toBeTruthy();
    expect(generatedSecret).toBe(true);
    expect(config.users).toHaveLength(1);
    expect(config.users[0]!.username).toBe('admin');
    expect(verifyPassword(generatedPassword!, config.users[0]!.passwordHash)).toBe(true);
  });

  it('creates a user from ADMIN_USER/ADMIN_PASSWORD env', () => {
    const { config, generatedPassword } = loadAuthConfig({
      path,
      env: { ADMIN_USER: 'bob', ADMIN_PASSWORD: 'hunter2', AUTH_SESSION_SECRET: 'fixed' },
    });
    expect(generatedPassword).toBeUndefined();
    const bob = config.users.find((u) => u.username === 'bob')!;
    expect(verifyPassword('hunter2', bob.passwordHash)).toBe(true);
    expect(config.sessionSecret).toBe('fixed');
  });

  it('does not generate a password when OAuth2 is enabled with an allowlist', () => {
    writeFileSync(
      path,
      JSON.stringify({
        oauth2: {
          enabled: true,
          authorizationUrl: 'https://i/a', tokenUrl: 'https://i/t', userInfoUrl: 'https://i/u',
          clientId: 'c', clientSecret: 's', allowedEmails: ['a@b.c'],
        },
      }),
    );
    const { config, generatedPassword } = loadAuthConfig({ path, env: {} });
    expect(generatedPassword).toBeUndefined();
    expect(config.users).toHaveLength(0);
    expect(config.oauth2?.enabled).toBe(true);
  });

  it('reads an existing hashed user from the file and overlays env client secret', () => {
    writeFileSync(
      path,
      JSON.stringify({
        sessionSecret: 'filesecret',
        users: [{ username: 'admin', passwordHash: 'aa:bb' }],
        oauth2: { enabled: true, authorizationUrl: 'https://i/a', tokenUrl: 'https://i/t', userInfoUrl: 'https://i/u', clientId: 'c', clientSecret: 'file', allowedEmails: ['a@b.c'] },
      }),
    );
    const { config } = loadAuthConfig({ path, env: { OAUTH2_CLIENT_SECRET: 'fromenv' } });
    expect(config.sessionSecret).toBe('filesecret');
    expect(config.oauth2?.clientSecret).toBe('fromenv');
  });
});
