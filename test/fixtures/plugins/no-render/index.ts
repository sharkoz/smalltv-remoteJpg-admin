import type { PluginManifest } from '../../../../src/plugins/types.js';

// Exports a valid manifest but no `render` function: must be rejected.
export const manifest: PluginManifest = {
  id: 'no-render',
  name: 'No Render',
  defaultDisplayDurationMs: 5000,
};
