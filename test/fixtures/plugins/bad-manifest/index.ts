// Manifest missing required `name` and a non-positive duration: must be rejected.
export const manifest = {
  id: 'bad-manifest',
  defaultDisplayDurationMs: -1,
} as any;

export const render = () => '<html></html>';
