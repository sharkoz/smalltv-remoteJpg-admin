import { chromium } from 'playwright';
const base = 'http://127.0.0.1:8091';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 820, height: 760 } });
await p.goto(base + '/login');
await p.fill('[name=username]', 'admin');
await p.fill('[name=password]', 'secret123');
await Promise.all([p.waitForURL('**/admin/ui'), p.click('button[type=submit]')]);
await p.evaluate(async () => {
  await fetch('/admin/dashboards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'clock-paris', pluginId: 'clock', name: 'Paris Clock', config: { timezone: 'Europe/Paris', label: 'PARIS' }, displayDurationMs: 10000 }) });
  await fetch('/admin/devices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'kitchen-tv', name: 'Kitchen SmallTV', pollIntervalMs: 5000, assignments: [{ dashboardId: 'clock-paris', displayDurationMs: 10000 }] }) });
});
await p.reload();
await p.waitForSelector('#device-list .card');
await p.waitForFunction(() => document.querySelector('#log-status')?.className.includes('live'));
await p.locator('#device-list .card').first().screenshot({ path: '/tmp/feat-device.png' });
await p.locator('section', { has: p.locator('#log-list') }).screenshot({ path: '/tmp/feat-logs.png' });
await b.close();
console.log('shots saved');
