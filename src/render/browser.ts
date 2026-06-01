import { chromium, type Browser, type Page } from 'playwright';
import { SCREEN_SIZE } from '../plugins/brick.js';
import { logger } from '../util/logger.js';

/**
 * Owns a single lazily-launched Chromium and one reusable page, guarded by an
 * async lock so concurrent renders serialize instead of spawning many browsers.
 */
export class BrowserPool {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private async ensurePage(): Promise<Page> {
    if (!this.browser) {
      logger.info('Launching Chromium');
      this.browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.browser.newPage({
        viewport: { width: SCREEN_SIZE, height: SCREEN_SIZE },
        deviceScaleFactor: 1,
      });
    }
    return this.page;
  }

  /** Run `fn` with exclusive access to the shared page. Calls are serialized. */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const page = await this.ensurePage();
      return fn(page);
    });
    // Keep the chain alive regardless of individual failures.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    if (browser) await browser.close();
  }
}
