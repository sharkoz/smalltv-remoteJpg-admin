import { z } from 'zod';

export const oauth2Schema = z.object({
  enabled: z.boolean().default(false),
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  userInfoUrl: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scopes: z.array(z.string()).default(['openid', 'email']),
  /** Dotted path into the userinfo response that holds the user's email/identity. */
  emailField: z.string().default('email'),
  /** Allowlist of identities permitted to sign in. Empty = nobody (must be set). */
  allowedEmails: z.array(z.string()).default([]),
  buttonLabel: z.string().default('Sign in with OAuth2'),
});

export const userSchema = z.object({
  username: z.string().min(1),
  passwordHash: z.string().min(1),
});

export const authConfigSchema = z.object({
  /** HMAC secret for session/state tokens. Generated if absent. */
  sessionSecret: z.string().min(1).optional(),
  sessionTtlMs: z.number().int().positive().default(7 * 24 * 3600 * 1000),
  /** Set true when serving over HTTPS so the cookie gets the Secure flag. */
  cookieSecure: z.boolean().default(false),
  users: z.array(userSchema).default([]),
  oauth2: oauth2Schema.optional(),
});

export type AuthConfigInput = z.input<typeof authConfigSchema>;
export type AuthConfig = z.output<typeof authConfigSchema>;
export type OAuth2Config = z.output<typeof oauth2Schema>;
export type AuthUser = z.output<typeof userSchema>;

/** sessionSecret is guaranteed present after loading. */
export type ResolvedAuthConfig = AuthConfig & { sessionSecret: string };
