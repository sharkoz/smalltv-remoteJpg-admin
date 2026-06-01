import type { BrowserPool } from './browser.js';
import { SCREEN_SIZE } from '../plugins/brick.js';

export interface RenderOptions {
  /** JPEG quality 0-100. Default 80. */
  quality?: number;
  /** Small fixed delay after fonts are ready, to let layout settle. Default 50. */
  settleMs?: number;
}

/** Structural interface so the engine can be tested with a fake renderer. */
export interface RendererLike {
  renderHtmlToJpg(html: string, opts?: RenderOptions): Promise<Buffer>;
}

/**
 * Render an HTML document to a 240x240 JPEG buffer using the shared browser.
 * The poll endpoint never calls this directly — rendering is done ahead of time
 * and cached (see imageCache).
 */
export class Renderer implements RendererLike {
  constructor(private readonly pool: BrowserPool) {}

  async renderHtmlToJpg(html: string, opts: RenderOptions = {}): Promise<Buffer> {
    const { quality = 80, settleMs = 50 } = opts;
    return this.pool.withPage(async (page) => {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      // Give webfonts/layout a brief moment, bounded so a slow page can't hang.
      await page.evaluate(() => (globalThis as any).document?.fonts?.ready).catch(() => undefined);
      await page.waitForTimeout(settleMs);
      return (await page.screenshot({
        type: 'jpeg',
        quality,
        clip: { x: 0, y: 0, width: SCREEN_SIZE, height: SCREEN_SIZE },
      })) as Buffer;
    });
  }
}
