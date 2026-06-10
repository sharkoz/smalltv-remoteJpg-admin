import { esc } from '../../src/plugins/brick.js';
import { formatCountdown, severityFor } from './parsers.js';
import type { AiUsageConfig, Provider, ProviderUsage, UsageWindow } from './types.js';

const providerLabels: Record<Provider, string> = { claude: 'Claude', codex: 'Codex' };
const severityColors = { low: '#35d07f', mid: '#f0b84a', critical: '#ff5c5c' } as const;

function percent(window: UsageWindow | null): string {
  return window ? `${window.usedPercent}%` : '—';
}

function reset(window: UsageWindow | null, nowSeconds: number): string {
  return window ? formatCountdown(window.resetAt, nowSeconds) : '—';
}

function bar(window: UsageWindow | null): string {
  const value = window?.usedPercent ?? 0;
  const color = window ? severityColors[severityFor(value)] : '#404653';
  return `<div class="bar"><div class="fill" style="width:${value}%;background:${color}"></div></div>`;
}

function windowRow(label: string, window: UsageWindow | null, nowSeconds: number, compact: boolean): string {
  if (compact) {
    return `<div class="metric compact"><span>${label} ${percent(window)}</span>${bar(window)}</div>`;
  }
  return `<div class="metric"><div class="metric-head"><span>${label}</span><strong>${percent(window)}</strong></div>${bar(window)}<div class="reset">resets ${esc(reset(window, nowSeconds))}</div></div>`;
}

function statusText(usages: ProviderUsage[]): string {
  if (usages.some((usage) => usage.status === 'error')) return 'Provider error';
  if (usages.some((usage) => usage.status === 'stale')) return 'Using cached data';
  return 'Live usage';
}

function credits(usage: ProviderUsage, enabled: boolean): string {
  if (!enabled || usage.provider !== 'codex' || !usage.credits?.balance) return '';
  return `<div class="credits">Credits ${esc(usage.credits.balance)}</div>`;
}

function review(usage: ProviderUsage, enabled: boolean, nowSeconds: number): string {
  if (!enabled || usage.provider !== 'codex' || !usage.review) return '';
  return `<div class="review">Review ${percent(usage.review)} · ${esc(reset(usage.review, nowSeconds))}</div>`;
}

function errorCard(label: string, message: string): string {
  return `<section class="card error"><div class="provider">${esc(label)}</div><div class="error-title">Usage unavailable</div><div class="error-msg">${esc(message)}</div></section>`;
}

function singleCard(config: AiUsageConfig, usage: ProviderUsage, nowSeconds: number): string {
  if (!usage.session && !usage.weekly) return errorCard(usage.label, usage.error ?? 'No usage available');
  return `<section class="card single"><div class="provider-row"><div><div class="provider">${esc(usage.label)}</div>${usage.planLabel ? `<div class="plan">${esc(usage.planLabel)}</div>` : ''}</div><div class="status ${usage.status}">${esc(usage.status)}</div></div>${windowRow('5h', usage.session, nowSeconds, false)}${windowRow('7d', usage.weekly, nowSeconds, false)}${review(usage, config.showReview, nowSeconds)}${credits(usage, config.showCredits)}</section>`;
}

function dualCard(config: AiUsageConfig, usage: ProviderUsage, nowSeconds: number): string {
  if (!usage.session && !usage.weekly) return errorCard(usage.label, usage.error ?? 'No usage available');
  return `<section class="card dual"><div class="provider-row"><div><div class="provider">${esc(usage.label)}</div>${usage.planLabel ? `<div class="plan">${esc(usage.planLabel)}</div>` : ''}</div><div class="status ${usage.status}">${esc(usage.status)}</div></div>${windowRow('5h', usage.session, nowSeconds, true)}${windowRow('7d', usage.weekly, nowSeconds, true)}${review(usage, config.showReview, nowSeconds)}${credits(usage, config.showCredits)}</section>`;
}

export function renderAiUsage(config: AiUsageConfig, usages: ProviderUsage[], nowSeconds: number): string {
  const byProvider = new Map(usages.map((usage) => [usage.provider, usage]));
  const ordered = config.providers.map(
    (provider) => byProvider.get(provider) ?? { provider, label: providerLabels[provider], session: null, weekly: null, status: 'error' as const, fetchedAt: null, error: 'No usage available' },
  );
  const dual = config.mode === 'both' || (config.mode === 'auto' && ordered.length > 1);
  const cards = ordered.map((usage) => (dual ? dualCard(config, usage, nowSeconds) : singleCard(config, usage, nowSeconds))).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:240px;height:240px;overflow:hidden}
body{background:#080a0f;color:#f4f7fb;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.shell{width:240px;height:240px;padding:10px;display:flex;flex-direction:column;gap:7px;background:radial-gradient(circle at top left,#162033,#080a0f 58%)}
.title{font-size:18px;font-weight:800;letter-spacing:.2px;line-height:1;color:#ffffff}
.cards{display:grid;grid-template-columns:1fr;gap:7px;flex:1;min-height:0}.cards.dual{grid-template-columns:1fr 1fr}
.card{background:#111722;border:1px solid #243044;border-radius:14px;padding:9px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04);min-width:0;overflow:hidden}.single{display:flex;flex-direction:column;gap:8px}.dual{display:flex;flex-direction:column;gap:6px;padding:8px}
.provider-row{display:flex;align-items:flex-start;justify-content:space-between;gap:5px}.provider{font-size:15px;font-weight:800;line-height:1.05;color:#f8fbff}.plan{font-size:10px;color:#9aa7ba;margin-top:2px}.status{font-size:8px;text-transform:uppercase;color:#93f0bd;background:#143823;border-radius:999px;padding:3px 5px}.status.stale{color:#ffd27a;background:#3b2e12}.status.error{color:#ff9a9a;background:#3b1616}
.metric{display:flex;flex-direction:column;gap:4px}.metric-head,.compact{font-size:12px;color:#c5cfdd}.metric-head{display:flex;justify-content:space-between;align-items:center}.metric-head strong{font-size:19px;color:#fff}.compact{gap:3px}.compact span{font-weight:750;color:#f3f6fb;white-space:nowrap;font-size:12px}.bar{height:7px;border-radius:999px;background:#252c38;overflow:hidden}.compact .bar{height:5px}.fill{height:100%;border-radius:999px}.reset{font-size:10px;color:#8f9caf}.review,.credits{font-size:10px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.credits{color:#9ee7b4;font-weight:750}.error{display:flex;flex-direction:column;gap:7px;justify-content:center}.error-title{font-size:13px;font-weight:800;color:#ffaaaa}.error-msg{font-size:10px;line-height:1.2;color:#d7a3a3;word-break:break-word}
.footer{font-size:10px;color:#7f8ca3;text-align:center;line-height:1}
</style></head><body><main class="shell"><h1 class="title">${esc(config.title)}</h1><div class="cards ${dual ? 'dual' : 'single'}">${cards}</div><footer class="footer">${esc(statusText(ordered))}</footer></main></body></html>`;
}
