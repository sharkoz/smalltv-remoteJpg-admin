import { chromium } from 'playwright';
const base = 'http://127.0.0.1:8093';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 820, height: 560 } });

await p.goto(base + '/login');
await p.fill('[name=username]', 'admin');
await p.fill('[name=password]', 'secret123');
await Promise.all([p.waitForURL('**/admin/ui'), p.click('button[type=submit]')]);

// Create a Prometheus dashboard pointing at an unreachable server, assigned to a device.
await p.evaluate(async () => {
  await fetch('/admin/dashboards', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'prom-demo', pluginId: 'prometheus', name: 'Prometheus Demo', config: { baseUrl: 'http://127.0.0.1:1', query: 'rate(node_cpu_seconds_total[5m])', label: 'CPU' }, displayDurationMs: 15000 }),
  });
  await fetch('/admin/devices', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'promdev', name: 'Prom Device', pollIntervalMs: 2000, assignments: [{ dashboardId: 'prom-demo', displayDurationMs: 15000 }] }),
  });
});

// Let the background engine tick a couple of times so it fetches (and fails) and logs.
await p.waitForTimeout(2500);
await p.reload();
await p.waitForSelector('#dashboard-list .card');
const card = p.locator('#dashboard-list .card').filter({ hasText: 'Prometheus Demo' });
await card.getByRole('button', { name: 'Logs' }).click();
await p.waitForFunction(() => /fetch failed|ECONNREFUSED|no data|matched/i.test(document.querySelector('#log-list')?.textContent || ''));
await p.waitForTimeout(300);
// Screenshot the Logs section.
await p.locator('section', { has: p.locator('#log-list') }).scrollIntoViewIfNeeded();
await p.locator('section', { has: p.locator('#log-list') }).screenshot({ path: '/tmp/logs-panel.png' });
await b.close();
console.log('logs screenshot saved');
