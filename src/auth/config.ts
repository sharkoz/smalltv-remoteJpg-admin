import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { authConfigSchema, type ResolvedAuthConfig } from './schema.js';
import { hashPassword } from './password.js';
import { logger } from '../util/logger.js';

export interface LoadedAuth {
  config: ResolvedAuthConfig;
  /** A freshly generated admin password to show the operator once (first run). */
  generatedPassword?: string;
  /** True when the session secret was generated (sessions reset on restart). */
  generatedSecret: boolean;
}

export interface LoadAuthOptions {
  path: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Load auth config from a JSON file, overlay env, and guarantee the admin is
 * never left open: if no user and no OAuth2 are configured, a random admin
 * password is generated and returned for the operator to see once.
 */
export function loadAuthConfig({ path, env = process.env }: LoadAuthOptions): LoadedAuth {
  let raw: unknown = {};
  if (existsSync(path)) {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  }
  const parsed = authConfigSchema.parse(raw);

  const users = [...parsed.users];

  // Env quick-start: ADMIN_USER / ADMIN_PASSWORD create/replace that user.
  const envUser = env.ADMIN_USER;
  const envPass = env.ADMIN_PASSWORD;
  if (envUser && envPass) {
    const hash = hashPassword(envPass);
    const existing = users.findIndex((u) => u.username === envUser);
    if (existing >= 0) users[existing] = { username: envUser, passwordHash: hash };
    else users.push({ username: envUser, passwordHash: hash });
  }

  // Allow the OAuth2 client secret to come from the environment.
  let oauth2 = parsed.oauth2;
  if (oauth2 && env.OAUTH2_CLIENT_SECRET) {
    oauth2 = { ...oauth2, clientSecret: env.OAUTH2_CLIENT_SECRET };
  }

  const oauthUsable = Boolean(oauth2?.enabled);
  if (oauthUsable && oauth2 && oauth2.allowedEmails.length === 0) {
    logger.warn('OAuth2 is enabled but allowedEmails is empty — nobody will be able to sign in via OAuth2.');
  }

  // Guarantee a way in: if no password user and OAuth2 isn't usable, mint one.
  let generatedPassword: string | undefined;
  if (users.length === 0 && !oauthUsable) {
    generatedPassword = randomBytes(9).toString('base64url');
    users.push({ username: 'admin', passwordHash: hashPassword(generatedPassword) });
  }

  // Session secret: env > file > generated.
  let sessionSecret = env.AUTH_SESSION_SECRET ?? parsed.sessionSecret;
  let generatedSecret = false;
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString('hex');
    generatedSecret = true;
  }

  const config: ResolvedAuthConfig = { ...parsed, users, oauth2, sessionSecret };
  return { config, generatedPassword, generatedSecret };
}
