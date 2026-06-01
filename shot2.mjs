import { chromium } from 'playwright';
const base = 'http://127.0.0.1:8095';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 760, height: 720 } });
await p.goto(base + '/login');
await p.fill('[name=username]', 'admin');
await p.fill('[name=password]', 'secret123');
await Promise.all([p.waitForURL('**/admin/ui'), p.click('button[type=submit]')]);
await p.waitForSelector('#dashboard-list .card');
// open the add-dashboard form and pick prometheus
await p.locator('#dashboard-form').evaluate((el) => { const d = el.closest('details'); if (d) d.open = true; });
await p.selectOption('#plugin-select', 'prometheus');
await p.locator('#dashboard-form').scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await p.locator('#dashboard-form').screenshot({ path: '/tmp/example-config.png' });
await b.close();
console.log('shot saved');
