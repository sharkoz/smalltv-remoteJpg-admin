import { z } from 'zod';
import type { PluginManifest, RenderContext, RenderFn } from '../../src/plugins/types.js';
import { esc } from '../../src/plugins/brick.js';

const configSchema = z.object({
  city: z.string().min(1).default('Paris'),
  lat: z.number().min(-90).max(90).default(48.85),
  lon: z.number().min(-180).max(180).default(2.35),
  mode: z.enum(['simple', 'advanced']).default('simple'),
  unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).default('#60a5fa'),
});

type Cfg = z.infer<typeof configSchema>;

const WMO_LABEL: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm + hail', 99: 'Thunderstorm + hail',
};

function wmoLabel(code: number): string {
  return WMO_LABEL[code] ?? `Code ${code}`;
}

// Cloud base shape (40x40 viewBox)
const CLOUD = 'M10 28 Q7 28 6 26 Q4 24 6.5 22 Q6 17 12 17 Q13 12 20 12 Q27 12 28 17 Q34 17 34 22 Q34 28 28 28 Z';
// Smaller cloud for partly-cloudy, positioned lower-right
const CLOUD_SM = 'M15 30 Q13 30 12 28.5 Q10 27 12 25 Q12 21 17 21 Q18 18 23 18 Q29 18 30 22.5 Q34 22.5 34 26 Q34 30 29 30 Z';

function iconSvg(code: number, size: number): string {
  const s = String(size);

  if (code === 0) return `<svg width="${s}" height="${s}" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="8" fill="#fbbf24"/>
    <g stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round">
      <line x1="20" y1="4" x2="20" y2="8"/><line x1="20" y1="32" x2="20" y2="36"/>
      <line x1="4" y1="20" x2="8" y2="20"/><line x1="32" y1="20" x2="36" y2="20"/>
      <line x1="7.5" y1="7.5" x2="10.3" y2="10.3"/><line x1="29.7" y1="29.7" x2="32.5" y2="32.5"/>
      <line x1="32.5" y1="7.5" x2="29.7" y2="10.3"/><line x1="10.3" y1="29.7" x2="7.5" y2="32.5"/>
    </g>
  </svg>`;

  if (code === 1 || code === 2) return `<svg width="${s}" height="${s}" viewBox="0 0 40 40">
    <circle cx="13" cy="14" r="7" fill="#fbbf24"/>
    <g stroke="#fbbf24" stroke-width="2" stroke-linecap="round">
      <line x1="13" y1="3" x2="13" y2="6.5"/><line x1="13" y1="21.5" x2="13" y2="25"/>
      <line x1="2" y1="14" x2="5.5" y2="14"/><line x1="20.5" y1="14" x2="24" y2="14"/>
      <line x1="5.1" y1="6.1" x2="7.6" y2="8.6"/><line x1="18.4" y1="19.4" x2="20.9" y2="21.9"/>
      <line x1="20.9" y1="6.1" x2="18.4" y2="8.6"/><line x1="7.6" y1="19.4" x2="5.1" y2="21.9"/>
    </g>
    <path d="${CLOUD_SM}" fill="#94a3b8"/>
  </svg>`;

  if (code === 3 || code === 45 || code === 48) return `<svg width="${s}" height="${s}" viewBox="0 0 40 40">
    <path d="${CLOUD}" fill="#94a3b8"/>
  </svg>`;

  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return `<svg width="${s}" height="${s}" viewBox="0 0 40 40">
    <path d="${CLOUD}" fill="#78879a"/>
    <g stroke="#60a5fa" stroke-width="2.5" stroke-linecap="round">
      <line x1="12" y1="31" x2="10" y2="37"/><line x1="20" y1="31" x2="18" y2="37"/><line x1="28" y1="31" x2="26" y2="37"/>
    </g>
  </svg>`;

  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return `<svg width="${s}" height="${s}" viewBox="0 0 40 40">
    <path d="${CLOUD}" fill="#94a3b8"/>
    <g stroke="#bfdbfe" stroke-width="2.5" stroke-linecap="round">
      <line x1="12" y1="32" x2="12" y2="36"/><line x1="10" y1="34" x2="14" y2="34"/>
      <line x1="20" y1="32" x2="20" y2="36"/><line x1="18" y1="34" x2="22" y2="34"/>
      <line x1="28" y1="32" x2="28" y2="36"/><line x1="26" y1="34" x2="30" y2="34"/>
    </g>
  </svg>`;

  if (code >= 95) return `<svg width="${s}" height="${s}" viewBox="0 0 40 40">
    <path d="${CLOUD}" fill="#64748b"/>
    <polyline points="22,30 18,35 21,35 17,39" fill="none" stroke="#fde047" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;

  return `<svg width="${s}" height="${s}" viewBox="0 0 40 40"><path d="${CLOUD}" fill="#94a3b8"/></svg>`;
}

function fmtTemp(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const sym = unit === 'celsius' ? '°C' : '°F';
  return `${Math.round(value)}${sym}`;
}

function fmtDeg(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}°`;
}

function dayAbbr(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  return (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const)[d.getUTCDay()] ?? '?';
}

interface CurrentData {
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  weather_code?: number;
  wind_speed_10m?: number;
}

interface DailyData {
  time?: string[];
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  weather_code?: number[];
  precipitation_probability_max?: (number | null)[];
}

interface WeatherResponse {
  current?: CurrentData;
  daily?: DailyData;
}

function baseStyles(theme: ReturnType<typeof Object.create>, bg = theme.bg): string {
  return `*{margin:0;padding:0;box-sizing:border-box}html,body{width:240px;height:240px;overflow:hidden}body{background:${esc(bg)};color:${esc(theme.text)};font-family:${esc(theme.font)}}`;
}

function simpleHtml(cfg: Cfg, theme: ReturnType<typeof Object.create>, c: CurrentData | null, accent: string): string {
  const code = c?.weather_code ?? -1;
  const humidity = c?.relative_humidity_2m;
  const wind = c?.wind_speed_10m;

  const humidityIcon = `<svg width="13" height="13" viewBox="0 0 13 13"><path d="M6.5 1 Q10 5 10 8 A3.5 3.5 0 0 1 3 8 Q3 5 6.5 1Z" fill="${esc(accent)}" opacity=".8"/></svg>`;
  const windIcon = `<svg width="13" height="13" viewBox="0 0 13 13"><path d="M1 5 Q4 5 5 4 Q6 3 8 3.5 Q10 4 9 6 Q8 7.5 6 7" fill="none" stroke="${esc(accent)}" stroke-width="1.4" stroke-linecap="round"/><path d="M1 8 Q5 8 6 7.5" fill="none" stroke="${esc(accent)}" stroke-width="1.4" stroke-linecap="round"/></svg>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${baseStyles(theme)}
.shell{width:240px;height:240px;padding:16px 14px 14px;display:flex;flex-direction:column;background:radial-gradient(ellipse at top left,#0d1e3c 0%,${esc(theme.bg)} 65%)}
.header{display:flex;justify-content:space-between;align-items:flex-start}
.city{font-size:17px;font-weight:800;color:#f8fbff;letter-spacing:.2px}
.status{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:${esc(theme.muted)};margin-top:2px}
.body{flex:1;display:flex;flex-direction:column;justify-content:center;gap:3px;padding:6px 0}
.temp{font-size:56px;font-weight:900;line-height:1;letter-spacing:-3px;color:#f8fbff}
.feels{font-size:11px;color:${esc(theme.muted)};margin-top:1px}
.cond{font-size:13px;font-weight:700;color:${esc(accent)};margin-top:4px}
.footer{display:flex;gap:18px;padding-top:10px;border-top:1px solid ${esc(theme.border)}}
.stat{display:flex;align-items:center;gap:5px;font-size:12px}
.stat-val{color:${esc(theme.text)};font-weight:700}
.stat-lbl{color:${esc(theme.muted)}}
</style></head><body><div class="shell">
  <div class="header">
    <div>
      <div class="city">${esc(cfg.city)}</div>
    </div>
    ${iconSvg(code >= 0 ? code : 3, 44)}
  </div>
  <div class="body">
    <div class="temp">${fmtTemp(c?.temperature_2m, cfg.unit)}</div>
    ${c?.apparent_temperature !== undefined ? `<div class="feels">Feels like ${fmtTemp(c.apparent_temperature, cfg.unit)}</div>` : ''}
    <div class="cond">${esc(code >= 0 ? wmoLabel(code) : '—')}</div>
  </div>
  <div class="footer">
    <div class="stat">${humidityIcon}<span class="stat-val">${humidity !== undefined ? `${Math.round(humidity)}%` : '—'}</span><span class="stat-lbl">humidity</span></div>
    <div class="stat">${windIcon}<span class="stat-val">${wind !== undefined ? `${Math.round(wind)} km/h` : '—'}</span></div>
  </div>
</div></body></html>`;
}

function advancedHtml(cfg: Cfg, theme: ReturnType<typeof Object.create>, c: CurrentData | null, daily: DailyData | null, accent: string): string {
  const code = c?.weather_code ?? -1;
  const rows: string[] = [];

  if (daily?.time) {
    for (let i = 1; i <= 5; i++) {
      const date = daily.time[i];
      if (!date) continue;
      const wcode = daily.weather_code?.[i] ?? 3;
      const maxVal = daily.temperature_2m_max?.[i] ?? undefined;
      const minVal = daily.temperature_2m_min?.[i] ?? undefined;
      const precip = daily.precipitation_probability_max?.[i];
      const max = typeof maxVal === 'number' ? maxVal : undefined;
      const min = typeof minVal === 'number' ? minVal : undefined;
      const precipStr = typeof precip === 'number' ? `${precip}%` : '';
      rows.push(`<div class="row">
        ${iconSvg(wcode, 22)}
        <span class="day">${dayAbbr(date)}</span>
        ${precipStr ? `<span class="precip">${esc(precipStr)}</span>` : '<span class="precip"></span>'}
        <div class="temps"><span class="tmax">${esc(fmtDeg(max))}</span><span class="tsep">/</span><span class="tmin">${esc(fmtDeg(min))}</span></div>
      </div>`);
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${baseStyles(theme)}
.shell{width:240px;height:240px;padding:12px;display:flex;flex-direction:column;gap:8px;background:radial-gradient(ellipse at top left,#0d1e3c 0%,${esc(theme.bg)} 65%)}
.header{display:flex;align-items:center;gap:9px;flex-shrink:0}
.hinfo{flex:1;min-width:0}
.crow{display:flex;align-items:baseline;justify-content:space-between;gap:4px}
.city{font-size:14px;font-weight:800;color:#f8fbff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctemp{font-size:24px;font-weight:900;letter-spacing:-1px;color:${esc(accent)}}
.csub{font-size:10px;color:${esc(theme.muted)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.divider{height:1px;background:${esc(theme.border)};flex-shrink:0}
.forecast{display:flex;flex-direction:column;flex:1;justify-content:space-between}
.row{display:flex;align-items:center;gap:7px;padding:3px 0}
.day{font-size:12px;font-weight:700;color:${esc(theme.text)};width:26px;flex-shrink:0}
.precip{font-size:10px;color:#60a5fa;width:26px;flex-shrink:0}
.temps{margin-left:auto;display:flex;align-items:baseline;gap:2px;font-size:12px}
.tmax{font-weight:800;color:${esc(theme.text)}}
.tsep{color:${esc(theme.muted)};font-size:10px}
.tmin{color:${esc(theme.muted)}}
</style></head><body><div class="shell">
  <div class="header">
    ${iconSvg(code >= 0 ? code : 3, 38)}
    <div class="hinfo">
      <div class="crow">
        <span class="city">${esc(cfg.city)}</span>
        <span class="ctemp">${fmtTemp(c?.temperature_2m, cfg.unit)}</span>
      </div>
      <div class="csub">${esc(code >= 0 ? wmoLabel(code) : '—')} · feels ${fmtTemp(c?.apparent_temperature, cfg.unit)}</div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="forecast">${rows.length ? rows.join('') : `<div style="color:${esc(theme.muted)};font-size:11px;text-align:center;padding:10px">No forecast</div>`}</div>
</div></body></html>`;
}

export const manifest: PluginManifest = {
  id: 'weather',
  name: 'Weather',
  defaultDisplayDurationMs: 15_000,
  dataSources: [
    {
      id: 'weather',
      url: 'https://api.open-meteo.com/v1/forecast?latitude={{config.lat}}&longitude={{config.lon}}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&temperature_unit={{config.unit}}&wind_speed_unit=kmh&forecast_days=6&timezone=auto',
      method: 'GET',
      refreshIntervalMs: 30 * 60_000,
      responseType: 'json',
    },
  ],
  rerenderIntervalMs: 30 * 60_000,
  configSchema,
  configFields: [
    { key: 'city', label: 'City', type: 'string', default: 'Paris', required: true, description: 'Display name of the location.' },
    { key: 'lat', label: 'Latitude', type: 'number', default: 48.85, min: -90, max: 90, step: 0.0001, required: true, description: 'Geographic latitude (e.g. 48.85 for Paris).' },
    { key: 'lon', label: 'Longitude', type: 'number', default: 2.35, min: -180, max: 180, step: 0.0001, required: true, description: 'Geographic longitude (e.g. 2.35 for Paris).' },
    { key: 'mode', label: 'Mode', type: 'select', default: 'simple', options: [{ value: 'simple', label: 'Simple – current conditions' }, { value: 'advanced', label: 'Advanced – 5-day forecast' }] },
    { key: 'unit', label: 'Temperature unit', type: 'select', default: 'celsius', options: [{ value: 'celsius', label: '°C – Celsius' }, { value: 'fahrenheit', label: '°F – Fahrenheit' }] },
    { key: 'accentColor', label: 'Accent color', type: 'color', default: '#60a5fa' },
  ],
  exampleConfig: {
    city: 'Paris',
    lat: 48.85,
    lon: 2.35,
    mode: 'simple',
    unit: 'celsius',
    accentColor: '#60a5fa',
  },
};

export const render: RenderFn = (ctx: RenderContext) => {
  const cfg = configSchema.parse(ctx.config);
  const { theme } = ctx;
  const source = ctx.data.weather;

  if (!source?.ok) {
    ctx.log.warn('Weather fetch failed', { city: cfg.city, error: source?.error });
    return ctx.brick.screen(
      `<div style="text-align:center;color:${esc(theme.muted)};font-size:13px">${esc(cfg.city)}<br>no data</div>`,
      { bg: theme.bg, color: theme.text, font: theme.font },
    );
  }

  const raw = source.value as WeatherResponse;
  const current = raw?.current ?? null;
  const daily = raw?.daily ?? null;

  if (cfg.mode === 'advanced') {
    return advancedHtml(cfg, theme, current, daily, cfg.accentColor);
  }
  return simpleHtml(cfg, theme, current, cfg.accentColor);
};
