import { chromium } from 'playwright';
const base = 'http://127.0.0.1:8090';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 720, height: 880 } });
await p.goto(base + '/login');
await p.fill('[name=username]', 'admin');
await p.fill('[name=password]', 'secret123');
await Promise.all([p.waitForURL('**/admin/ui'), p.click('button[type=submit]')]);
await p.waitForSelector('#plugin-select option[value="prometheus"]'); // wait for options to load
await p.locator('#dashboard-form').evaluate((el) => { const d = el.closest('details'); if (d) d.open = true; });
await p.selectOption('#plugin-select', 'prometheus');
await p.fill('#dashboard-form [name="name"]', 'Server CPU');
await p.waitForSelector('#config-fields [data-key="baseUrl"]');
await p.locator('#dashboard-form').screenshot({ path: '/tmp/friendly-form.png' });
await p.selectOption('#plugin-select', 'clock');
await p.waitForSelector('#config-fields [data-key="timezone"]');
await p.locator('#dashboard-form').screenshot({ path: '/tmp/friendly-clock.png' });
await b.close();
console.log('shots saved');
