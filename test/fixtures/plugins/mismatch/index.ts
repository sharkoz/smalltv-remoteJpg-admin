import type { PluginManifest, RenderFn } from '../../../../src/plugins/types.js';

// Manifest id does not match the directory name "mismatch": must be rejected.
export const manifest: PluginManifest = {
  id: 'something-else',
  name: 'Mismatch',
  defaultDisplayDurationMs: 5000,
};

export const render: RenderFn = (ctx) => ctx.brick.screen('x');
