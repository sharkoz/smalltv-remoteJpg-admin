import { describe, it, expect, afterAll } from 'vitest';
import { BrowserPool } from '../src/render/browser.js';
import { Renderer } from '../src/render/renderer.js';
import { makeBricks } from '../src/plugins/brick.js';
import { chromiumAvailable } from './helpers/chromium.js';
import { jpegSize } from './helpers/jpeg.js';

const available = await chromiumAvailable();

const pool = new BrowserPool();
const renderer = new Renderer(pool);

afterAll(async () => {
  await pool.close();
});

describe.skipIf(!available)('Renderer (integration, real Chromium)', () => {
  it('renders HTML to a valid 240x240 JPEG', async () => {
    const bricks = makeBricks({});
    const html = bricks.screen([bricks.text({ content: 'Hello', size: 40 })], { bg: '#102030' });
    const jpg = await renderer.renderHtmlToJpg(html);

    expect(jpg.length).toBeGreaterThan(100);
    const { width, height } = jpegSize(jpg);
    expect(width).toBe(240);
    expect(height).toBe(240);
  });

  it('produces different bytes for different content', async () => {
    const bricks = makeBricks({});
    const a = await renderer.renderHtmlToJpg(bricks.screen(bricks.text({ content: 'AAAA' })));
    const b = await renderer.renderHtmlToJpg(bricks.screen(bricks.text({ content: 'ZZZZ' })));
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});
