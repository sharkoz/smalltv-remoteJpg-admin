import { z } from 'zod';
import type { PluginManifest, RenderFn } from '../../src/plugins/types.js';

const configSchema = z.object({
  timezone: z.string().default('UTC'),
  format24h: z.boolean().default(true),
  label: z.string().optional(),
});

export const manifest: PluginManifest = {
  id: 'clock',
  name: 'Clock',
  defaultDisplayDurationMs: 10_000,
  // Re-render every second so the displayed time stays current.
  rerenderIntervalMs: 1_000,
  configSchema,
  configFields: [
    {
      key: 'timezone',
      label: 'Timezone',
      type: 'select',
      description: 'Which timezone the clock shows.',
      default: 'Europe/Paris',
      options: [
        { value: 'Europe/Paris', label: 'Paris' },
        { value: 'Europe/London', label: 'London' },
        { value: 'America/New_York', label: 'New York' },
        { value: 'America/Los_Angeles', label: 'Los Angeles' },
        { value: 'Asia/Tokyo', label: 'Tokyo' },
        { value: 'UTC', label: 'UTC' },
      ],
    },
    { key: 'format24h', label: '24-hour format', type: 'boolean', default: true, description: 'Off = 12-hour AM/PM.' },
    { key: 'label', label: 'Caption', type: 'string', default: '', placeholder: 'e.g. PARIS', description: 'Optional text shown above the time.' },
  ],
  exampleConfig: { timezone: 'Europe/Paris', format24h: true, label: 'PARIS' },
};

export const render: RenderFn = (ctx) => {
  const cfg = configSchema.parse(ctx.config);
  const theme = ctx.theme;
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: !cfg.format24h,
  });
  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.timezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

  const time = timeFmt.format(ctx.now);
  const date = dateFmt.format(ctx.now);

  return ctx.brick.screen(
    ctx.brick.stack([
      cfg.label ? ctx.brick.text({ content: cfg.label, size: 16, color: theme.accent }) : '',
      ctx.brick.text({ content: time, size: 64, weight: 700 }),
      ctx.brick.text({ content: date, size: 20, color: theme.muted }),
    ]),
    { bg: theme.bg, color: theme.text, font: theme.font },
  );
};
