import type { BrickHelpers, DataResult, RenderContext } from './types.js';

/** The screen size every dashboard renders to. */
export const SCREEN_SIZE = 240;

/** Escape text for safe HTML interpolation. */
export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Walk a dotted path into a value (e.g. "a.b.0.c"). */
function dig(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Build the brick helpers for one render. Bricks return HTML strings; a future
 * visual builder can interpret a JSON brick tree by calling these same helpers,
 * so code plugins and the builder share one rendering substrate.
 */
export function makeBricks(data: Record<string, DataResult>): BrickHelpers {
  const text: BrickHelpers['text'] = ({ content, size = 18, color, weight = 400, align = 'center' }) => {
    const style = [
      `font-size:${size}px`,
      `font-weight:${weight}`,
      `text-align:${align}`,
      color ? `color:${esc(color)}` : '',
      'line-height:1.1',
    ]
      .filter(Boolean)
      .join(';');
    return `<div style="${style}">${esc(content)}</div>`;
  };

  const value: BrickHelpers['value'] = ({ source, path = '', fallback = '—', size = 28, color }) => {
    const result = data[source];
    let display = fallback;
    if (result?.ok) {
      const v = dig(result.value, path);
      if (v != null && v !== '') display = String(v);
    }
    const stale = result ? result.stale : false;
    const html = text({ content: display, size, color, weight: 600 });
    // A subtle stale/error marker so degraded data is visible but not disruptive.
    if (!result?.ok || stale) {
      return `<div style="position:relative">${html}<div style="position:absolute;top:-2px;right:-2px;width:6px;height:6px;border-radius:50%;background:#e0a000"></div></div>`;
    }
    return html;
  };

  const flex = (children: string[], dir: 'column' | 'row', props?: { gap?: number; align?: string; justify?: string }) => {
    const { gap = 6, align = 'center', justify = 'center' } = props ?? {};
    const style = `display:flex;flex-direction:${dir};gap:${gap}px;align-items:${align};justify-content:${justify}`;
    return `<div style="${style}">${children.join('')}</div>`;
  };

  const stack: BrickHelpers['stack'] = (children, props) => flex(children, 'column', props);
  const row: BrickHelpers['row'] = (children, props) => flex(children, 'row', props);

  const screen: BrickHelpers['screen'] = (children, props) => {
    const { bg = '#000000', color = '#ffffff', padding = 8, font = 'system-ui, sans-serif' } = props ?? {};
    const body = Array.isArray(children) ? children.join('') : children;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${SCREEN_SIZE}px;height:${SCREEN_SIZE}px;overflow:hidden}
body{background:${esc(bg)};color:${esc(color)};font-family:${font};
display:flex;align-items:center;justify-content:center;padding:${padding}px}
.root{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
</style></head><body><div class="root">${body}</div></body></html>`;
  };

  return { text, value, stack, row, screen };
}

/** Convenience used by the renderer when a plugin returns a bare fragment. */
export function wrapFragmentIfNeeded(html: string, ctx: RenderContext): string {
  const looksLikeDocument = /<html[\s>]/i.test(html) || /<!DOCTYPE/i.test(html);
  if (looksLikeDocument) return html;
  return ctx.brick.screen(html);
}
