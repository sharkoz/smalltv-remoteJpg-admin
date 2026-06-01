import { chromium } from 'playwright';

/**
 * Returns true if Chromium can actually launch in this environment. On a bare
 * Linux host missing system libs (libglib, libnss, …) it returns false so
 * browser-dependent tests skip instead of failing. In Docker (Playwright base
 * image) or after `playwright install-deps`, it returns true and the tests run.
 */
let cached: boolean | undefined;

export async function chromiumAvailable(): Promise<boolean> {
  if (cached !== undefined) return cached;
  try {
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    await browser.close();
    cached = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '\n[skip] Chromium cannot launch (missing system libs?). Browser-dependent tests skipped.\n' +
        '       Install with: sudo npx playwright install-deps chromium  (or run in Docker)\n' +
        `       Reason: ${String(err).split('\n')[0]}\n`,
    );
    cached = false;
  }
  return cached;
}
