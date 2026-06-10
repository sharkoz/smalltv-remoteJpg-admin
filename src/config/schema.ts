import { z } from 'zod';
import { normalizeThemeName, THEME_NAMES } from '../theme/palette.js';

/** Structural validation of config.json. Plugin-specific `config` validation
 * happens later against each plugin's configSchema (see registry). */

export const dashboardAssignmentSchema = z.object({
  dashboardId: z.string().min(1),
  displayDurationMs: z.number().int().positive(),
});

const themeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? normalizeThemeName(value) : value),
  z.enum(THEME_NAMES),
);

export const deviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  theme: themeSchema.optional(),
  pollIntervalMs: z.number().int().positive(),
  assignments: z.array(dashboardAssignmentSchema).default([]),
});

export const dashboardSchema = z.object({
  id: z.string().min(1),
  pluginId: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.unknown()).default({}),
  theme: themeSchema.optional(),
  displayDurationMs: z.number().int().positive(),
});

export const appConfigSchema = z.object({
  version: z.literal(1),
  devices: z.array(deviceSchema).default([]),
  dashboards: z.array(dashboardSchema).default([]),
});

export type AppConfigInput = z.input<typeof appConfigSchema>;

export const EMPTY_CONFIG = { version: 1 as const, devices: [], dashboards: [] };
