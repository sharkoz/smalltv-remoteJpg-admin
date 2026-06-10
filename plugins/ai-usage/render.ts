import { esc } from '../../src/plugins/brick.js';
import { formatCountdown, severityFor } from './parsers.js';
import type { AiUsageConfig, Provider, ProviderUsage, UsageWindow } from './types.js';

const providerLabels: Record<Provider, string> = { claude: 'Claude', codex: 'Codex' };

const providerLogos: Record<Provider, string> = {
  claude: `<svg width="16" height="16" viewBox="0 0 16 16" style="flex-shrink:0;image-rendering:pixelated"><g fill="#d97757"><rect x="2" y="3" width="12" height="2"/><rect x="2" y="5" width="2" height="2"/><rect x="5" y="5" width="6" height="2"/><rect x="12" y="5" width="2" height="2"/><rect x="0" y="7" width="16" height="2"/><rect x="2" y="9" width="12" height="2"/><rect x="3" y="11" width="1" height="2"/><rect x="5" y="11" width="1" height="2"/><rect x="10" y="11" width="1" height="2"/><rect x="12" y="11" width="1" height="2"/></g></svg>`,
  codex: `<svg width="16" height="16" viewBox="0 0 16 16" style="flex-shrink:0"><circle cx="8" cy="8" r="8" fill="#0f0f0f"/><circle cx="8" cy="8" r="8" fill="url(#cdx)" opacity=".3"/><defs><radialGradient id="cdx" cx="30%" cy="25%"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="transparent"/></radialGradient></defs><g stroke="white" stroke-width="1.65" stroke-linecap="round"><line x1="8" y1="2.4" x2="8" y2="13.6"/><line x1="2.6" y1="5.2" x2="13.4" y2="10.8"/><line x1="13.4" y1="5.2" x2="2.6" y2="10.8"/></g></svg>`,
};
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
  return `<div class="metric${compact ? ' compact' : ''}"><div class="metric-head"><span>${percent(window)}</span><span class="reset">${esc(reset(window, nowSeconds))}</span></div>${bar(window)}</div>`;
}

function statusText(usages: ProviderUsage[]): string {
  if (usages.some((usage) => usage.status === 'error')) return 'Provider error';
  if (usages.some((usage) => usage.status === 'stale')) return 'Using cached data';
  return 'Live usage';
}

function credits(usage: ProviderUsage, enabled: boolean): string {
  if (!enabled || usage.provider !== 'codex' || usage.credits?.balance === undefined || usage.credits.balance === null) return '';
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
  return `<section class="card single-card"><div class="provider-row"><div class="provider-info">${providerLogos[usage.provider]}<span class="provider">${esc(usage.label)}</span>${usage.planLabel ? `<span class="plan">${esc(usage.planLabel)}</span>` : ''}</div><div class="status ${usage.status}">${esc(usage.status)}</div></div>${windowRow('5h', usage.session, nowSeconds, false)}${windowRow('7d', usage.weekly, nowSeconds, false)}${review(usage, config.showReview, nowSeconds)}${credits(usage, config.showCredits)}</section>`;
}

function dualCard(config: AiUsageConfig, usage: ProviderUsage, nowSeconds: number): string {
  if (!usage.session && !usage.weekly) return errorCard(usage.label, usage.error ?? 'No usage available');
  return `<section class="card dual-card"><div class="provider-row"><div class="provider-info">${providerLogos[usage.provider]}<span class="provider">${esc(usage.label)}</span>${usage.planLabel ? `<span class="plan">${esc(usage.planLabel)}</span>` : ''}</div><div class="status ${usage.status}">${esc(usage.status)}</div></div>${windowRow('5h', usage.session, nowSeconds, true)}${windowRow('7d', usage.weekly, nowSeconds, true)}${review(usage, config.showReview, nowSeconds)}${credits(usage, config.showCredits)}</section>`;
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
.cards{display:grid;grid-template-columns:1fr;gap:7px;flex:1;min-height:0}
.card{background:#111722;border:1px solid #243044;border-radius:14px;padding:9px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04);min-width:0;overflow:hidden}.card.single-card{display:flex;flex-direction:column;gap:8px}.card.dual-card{display:flex;flex-direction:column;gap:6px;padding:8px}
.provider-row{display:flex;align-items:center;justify-content:space-between;gap:5px}.provider-info{display:flex;align-items:center;gap:5px;min-width:0}.provider{font-size:15px;font-weight:800;line-height:1.05;color:#f8fbff}.plan{font-size:10px;color:#9aa7ba}.status{font-size:8px;text-transform:uppercase;color:#93f0bd;background:#143823;border-radius:999px;padding:3px 5px}.status.stale{color:#ffd27a;background:#3b2e12}.status.error{color:#ff9a9a;background:#3b1616}
.metric{display:flex;flex-direction:column;gap:4px}.metric-head{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#c5cfdd}.metric-head span:first-child{font-weight:750;color:#f3f6fb}.compact{gap:3px}.bar{height:7px;border-radius:999px;background:#252c38;overflow:hidden}.compact .bar{height:5px}.fill{height:100%;border-radius:999px}.reset{font-size:10px;color:#8f9caf}.review,.credits{font-size:10px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.credits{color:#9ee7b4;font-weight:750}.error{display:flex;flex-direction:column;gap:7px;justify-content:center}.error-title{font-size:13px;font-weight:800;color:#ffaaaa}.error-msg{font-size:10px;line-height:1.2;color:#d7a3a3;word-break:break-word}
.footer{font-size:10px;color:#7f8ca3;text-align:center;line-height:1}
</style></head><body><main class="shell"><div class="cards ${dual ? 'dual' : 'single'}">${cards}</div><footer class="footer">${esc(statusText(ordered))}</footer></main></body></html>`;
}
