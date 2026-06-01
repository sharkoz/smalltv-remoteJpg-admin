import { z } from 'zod';
import type { PluginManifest, RenderFn } from '../../../../src/plugins/types.js';

const configSchema = z.object({ n: z.number() });

export const manifest: PluginManifest = {
  id: 'good',
  name: 'Good Fixture',
  defaultDisplayDurationMs: 5000,
  configSchema,
};

export const render: RenderFn = (ctx) => ctx.brick.screen(ctx.brick.text({ content: String(ctx.config.n) }));
