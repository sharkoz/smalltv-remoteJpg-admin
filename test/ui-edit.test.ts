import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/http/server.js';
import { Engine } from '../src/app/engine.js';
import { ConfigStore } from '../src/config/store.js';
import { PluginRegistry } from '../src/plugins/registry.js';
import { loadPluginsFrom } from '../src/plugins/loader.js';
import { DataCache } from '../src/datasource/cache.js';
import { ImageCache } from '../src/render/imageCache.js';
import { SecretStore } from '../src/config/secrets.js';
import { FakeClock } from '../src/util/time.js';
import { AuthService } from '../src/auth/service.js';
import { hashPassword } from '../src/auth/password.js';
import { chromiumAvailable } from './helpers/chromium.js';
import type { RendererLike } from '../src/render/renderer.js';
import type { Fetcher, FetchOutcome } from '../src/datasource/types.js';
import type { ResolvedAuthConfig } from '../src/auth/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = join(here, '..', 'plugins');
const available = await chromiumAvailable();

class FakeRenderer implements RendererLike {
  async renderHtmlToJpg(html: string): Promise<Buffer> { return Buffer.from(html); }
}
class NullFetcher implements Fetcher {
  async fetch(): Promise<FetchOutcome> { return { ok: false, error: 'offline' }; }
}

const authConfig: ResolvedAuthConfig = {
  sessionSecret: 'ui-test-secret', sessionTtlMs: 3_600_000, cookieSecure: false,
  users: [{ username: 'admin', passwordHash: hashPassword('pw') }], oauth2: undefined,
};

describe.skipIf(!available)('admin UI — Edit buttons (real browser)', () => {
  let dir: string;
  let app: FastifyInstance;
  let store: ConfigStore;
  let browser: Browser;
  let page: Page;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'stv-ui-'));
    store = ConfigStore.load(join(dir, 'config.json'));
    store.upsertDashboard({
      id: 'clock-paris', pluginId: 'clock', name: 'Paris Clock',
      config: { timezone: 'Europe/Paris', label: 'PARIS' }, displayDurationMs: 10_000,
    });
    store.upsertDashboard({
      id: 'fx', pluginId: 'api-value', name: 'FX Rate',
      config: { url: 'https://example.com/fx', jsonPath: 'rates.EUR', label: 'EUR' }, displayDurationMs: 15_000,
    });
    store.upsertDashboard({
      id: 'prom-test', pluginId: 'prometheus', name: 'Prom Test',
      config: { baseUrl: 'http://prometheus:9090', query: 'up', label: 'PROM' }, displayDurationMs: 15_000,
    });
    store.upsertDevice({
      id: 'kitchen', name: 'Kitchen', pollIntervalMs: 2000,
      assignments: [
        { dashboardId: 'clock-paris', displayDurationMs: 10_000 },
        { dashboardId: 'fx', displayDurationMs: 15_000 },
      ],
    });
    store.upsertDevice({
      id: 'promdev', name: 'Prom Device', pollIntervalMs: 2000,
      assignments: [{ dashboardId: 'prom-test', displayDurationMs: 15_000 }],
    });

    const registry = new PluginRegistry();
    for (const p of await loadPluginsFrom(pluginsDir)) registry.register(p);
    const clock = new FakeClock(0);
    const engine = new Engine({
      store, registry, dataCache: new DataCache(new NullFetcher(), clock),
      renderer: new FakeRenderer(), imageCache: new ImageCache(clock), secrets: new SecretStore(undefined), clock,
    });
    await engine.tick(); // generate datasource + plugin logs for prom-test
    app = buildServer({ engine, store, registry, auth: new AuthService(authConfig) });
    base = await app.listen({ port: 0, host: '127.0.0.1' });

    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    page = await browser.newPage();

    await page.goto(base + '/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'pw');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin/ui');
    await page.waitForSelector('#device-list .card');
  });

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Edit on a device opens the form and populates every field', async () => {
    const card = page.locator('#device-list .card').filter({ hasText: 'Kitchen' });
    await card.getByRole('button', { name: 'Edit' }).click();

    const formOpen = await page.locator('#device-form').evaluate((el) => {
      const d = el.closest('details');
      return !!(d && (d as { open?: boolean }).open);
    });
    expect(formOpen).toBe(true);

    // The id is hidden/managed; the form shows an "Editing: <name>" mode header instead.
    expect(await page.locator('#device-mode').textContent()).toBe('Editing: Kitchen');
    expect(await page.inputValue('#device-form [name="name"]')).toBe('Kitchen');
    expect(await page.inputValue('#device-form [name="poll"]')).toBe('2');

    expect(await page.locator('#assignments .assign-row').count()).toBe(2);
    expect(await page.locator('#assignments .assign-row').first().locator('.assign-dash').inputValue()).toBe('clock-paris');
    expect(await page.locator('#assignments .assign-row').first().locator('.assign-dur').inputValue()).toBe('10');
  });

  it('Edit on a dashboard opens the friendly config form populated from the plugin schema', async () => {
    const card = page.locator('#dashboard-list .card').filter({ hasText: 'Paris Clock' });
    await card.getByRole('button', { name: 'Edit' }).click();

    const formOpen = await page.locator('#dashboard-form').evaluate((el) => {
      const d = el.closest('details');
      return !!(d && (d as { open?: boolean }).open);
    });
    expect(formOpen).toBe(true);
    expect(await page.locator('#dashboard-mode').textContent()).toBe('Editing: Paris Clock');
    expect(await page.inputValue('#dashboard-form [name="pluginId"]')).toBe('clock');
    // Friendly fields (not a JSON blob) rendered from the clock plugin's configFields.
    expect(await page.inputValue('#config-fields [data-key="label"]')).toBe('PARIS');
    expect(await page.inputValue('#config-fields [data-key="timezone"]')).toBe('Europe/Paris');

    // Toggling Raw JSON reveals the underlying config.
    await page.click('#config-json-toggle');
    expect(await page.inputValue('#config-text')).toContain('Europe/Paris');
  });

  it('renders the plugin field schema (with defaults) when a plugin is selected', async () => {
    await page.locator('#dashboard-form').evaluate((el) => {
      const d = el.closest('details');
      if (d) (d as { open: boolean }).open = true;
    });
    // Selecting prometheus renders its typed fields (baseUrl, query…).
    await page.selectOption('#plugin-select', 'prometheus');
    expect(await page.locator('#config-fields [data-key="baseUrl"]').count()).toBe(1);
    expect(await page.locator('#config-fields [data-key="query"]').count()).toBe(1);
    // Switching to clock swaps in the clock fields with their defaults.
    await page.selectOption('#plugin-select', 'clock');
    expect(await page.locator('#config-fields [data-key="baseUrl"]').count()).toBe(0);
    expect(await page.inputValue('#config-fields [data-key="timezone"]')).toBe('Europe/Paris');
  });

  it('editing then saving a device persists the change (Save works via the form)', async () => {
    const card = page.locator('#device-list .card').filter({ hasText: 'Kitchen' });
    await card.getByRole('button', { name: 'Edit' }).click();
    await page.fill('#device-form [name="name"]', 'Kitchen Edited');
    await page.getByRole('button', { name: 'Save device' }).click();

    await page.waitForFunction(() => {
      const list = (globalThis as { document?: { querySelector(s: string): { textContent: string | null } | null } }).document;
      return !!list?.querySelector('#device-list')?.textContent?.includes('Kitchen Edited');
    });
    expect(store.getDevice('kitchen')!.name).toBe('Kitchen Edited');
  });

  it('stays on the edited dashboard after saving (does not reset to create mode)', async () => {
    const card = page.locator('#dashboard-list .card').filter({ hasText: 'Paris Clock' });
    await card.getByRole('button', { name: 'Edit' }).click();
    await page.fill('#dashboard-form [name="name"]', 'Paris Renamed');
    await page.getByRole('button', { name: 'Save dashboard' }).click();

    // List reflects the change...
    await page.waitForFunction(() => {
      const d = (globalThis as { document?: { querySelector(s: string): { textContent: string | null } | null } }).document;
      return !!d?.querySelector('#dashboard-list')?.textContent?.includes('Paris Renamed');
    });
    expect(store.getDashboard('clock-paris')!.name).toBe('Paris Renamed');

    // ...and the form is still on that dashboard (not reset to a blank/new form).
    expect(await page.locator('#dashboard-mode').textContent()).toBe('Editing: Paris Renamed');
    expect(await page.inputValue('#dashboard-form [name="name"]')).toBe('Paris Renamed');
    expect(await page.inputValue('#dashboard-form [name="pluginId"]')).toBe('clock');
    expect(await page.inputValue('#config-fields [data-key="label"]')).toBe('PARIS');
    const stillOpen = await page.locator('#dashboard-form').evaluate((el) => {
      const d = el.closest('details');
      return !!(d && (d as { open?: boolean }).open);
    });
    expect(stillOpen).toBe(true);
  });

  it('shows logs explaining a dashboard problem when clicking its Logs button', async () => {
    const card = page.locator('#dashboard-list .card').filter({ hasText: 'Prom Test' });
    await card.getByRole('button', { name: 'Logs' }).click();

    // The button sets the filter to that dashboard and loads its logs.
    expect(await page.inputValue('#log-filter')).toBe('prom-test');
    await page.waitForFunction(() => {
      const d = (globalThis as { document?: { querySelector(s: string): { textContent: string | null } | null } }).document;
      const el = d?.querySelector('#log-list');
      return !!el && /offline|fetch failed/i.test(el.textContent || '');
    });
    const text = await page.locator('#log-list').textContent();
    expect(text).toMatch(/fetch failed|offline/i);
  });

  it('shows a live connection indicator for the log stream', async () => {
    await page.waitForFunction(() => {
      const d = (globalThis as { document?: { querySelector(s: string): { className: string; textContent: string | null } | null } }).document;
      const el = d?.querySelector('#log-status');
      return !!el && el.className.includes('live') && /live/.test(el.textContent || '');
    });
    expect(true).toBe(true);
  });

  it('copies a device poll link to the clipboard', async () => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const card = page.locator('#device-list .card').filter({ hasText: 'Kitchen' });
    await card.getByRole('button', { name: 'Copy link' }).click();
    // Button flips to "Copied!" once the async clipboard write resolves.
    await page.waitForFunction(() => {
      const d = (globalThis as { document?: { querySelector(s: string): { textContent: string | null } | null } }).document;
      return /Copied!/.test(d?.querySelector('#device-list')?.textContent || '');
    });
    const copied = await page.evaluate(() =>
      (globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }).navigator.clipboard.readText(),
    );
    expect(copied).toBe(base + '/devices/kitchen/screen.jpg');
  });

  it('clears logs with the Clear button', async () => {
    await page.click('#log-clear');
    await page.waitForFunction(() => {
      const d = (globalThis as { document?: { querySelector(s: string): { textContent: string | null } | null } }).document;
      return /No logs match/.test(d?.querySelector('#log-list')?.textContent || '');
    });
    expect(await page.locator('#log-list').textContent()).toContain('No logs match');
  });
});
