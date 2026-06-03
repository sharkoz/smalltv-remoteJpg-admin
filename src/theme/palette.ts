export const THEME_NAMES = ['dark', 'black', 'light', 'terminal'] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

export interface ThemePalette {
  name: ThemeName;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  good: string;
  bad: string;
  warn: string;
  font: string;
}

export const THEMES: Record<ThemeName, ThemePalette> = {
  dark: {
    name: 'dark',
    bg: '#080d14',
    surface: '#101824',
    surfaceAlt: '#172235',
    border: '#253348',
    text: '#f7fbff',
    muted: '#8ca1bb',
    accent: '#7fb0ff',
    good: '#36d399',
    bad: '#ff5d73',
    warn: '#e0a000',
    font: 'system-ui, sans-serif',
  },
  black: {
    name: 'black',
    bg: '#000000',
    surface: '#050505',
    surfaceAlt: '#0b0b0b',
    border: '#1a1a1a',
    text: '#ffffff',
    muted: '#9a9a9a',
    accent: '#00b7ff',
    good: '#00e676',
    bad: '#ff3b5c',
    warn: '#ffb000',
    font: 'system-ui, sans-serif',
  },
  light: {
    name: 'light',
    bg: '#f7f7f2',
    surface: '#ffffff',
    surfaceAlt: '#ecece4',
    border: '#d4d4c8',
    text: '#111315',
    muted: '#626a72',
    accent: '#155eef',
    good: '#087443',
    bad: '#c2253a',
    warn: '#a15c00',
    font: 'system-ui, sans-serif',
  },
  terminal: {
    name: 'terminal',
    bg: '#000000',
    surface: '#030803',
    surfaceAlt: '#061006',
    border: '#00aa00',
    text: '#00ff00',
    muted: '#00aa00',
    accent: '#00ff00',
    good: '#00ff00',
    bad: '#ff5c5c',
    warn: '#baff00',
    font: '"Courier New", Courier, monospace',
  },
};

export const DEFAULT_THEME_NAME: ThemeName = 'dark';
export const DEFAULT_THEME = THEMES[DEFAULT_THEME_NAME];

export function normalizeThemeName(name: string | undefined): string | undefined {
  if (name === 'midnight' || name === 'mono' || name === 'amber') return DEFAULT_THEME_NAME;
  return name;
}

export function getTheme(name: string | undefined): ThemePalette {
  return THEMES[(normalizeThemeName(name) as ThemeName) ?? DEFAULT_THEME_NAME] ?? DEFAULT_THEME;
}
