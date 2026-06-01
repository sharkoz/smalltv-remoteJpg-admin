import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../auth/password.js';

/**
 * Set or update an admin username/password in config/auth.json.
 * Usage: npm run set-password -- <username> <password>
 * Preserves existing fields (oauth2, sessionSecret) and mints a sessionSecret
 * if none exists, so sessions survive restarts.
 */
function main(): void {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: npm run set-password -- <username> <password>');
    process.exit(1);
  }

  const path = process.env.AUTH_CONFIG_PATH
    ? resolve(process.env.AUTH_CONFIG_PATH)
    : resolve(process.cwd(), 'config', 'auth.json');

  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      console.error(`Existing ${path} is not valid JSON; aborting.`);
      process.exit(1);
    }
  }

  const users = Array.isArray(config.users) ? (config.users as Array<{ username: string; passwordHash: string }>) : [];
  const hash = hashPassword(password);
  const i = users.findIndex((u) => u.username === username);
  if (i >= 0) users[i] = { username, passwordHash: hash };
  else users.push({ username, passwordHash: hash });
  config.users = users;

  if (typeof config.sessionSecret !== 'string' || config.sessionSecret.length === 0) {
    config.sessionSecret = randomBytes(32).toString('hex');
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
  console.log(`Saved credentials for "${username}" to ${path}`);
}

main();
