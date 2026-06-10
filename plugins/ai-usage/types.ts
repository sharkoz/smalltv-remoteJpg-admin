export type Provider = 'claude' | 'codex';
export type LayoutMode = 'auto' | 'single' | 'both';
export type Theme = 'dark';
export type UsageStatus = 'ok' | 'stale' | 'error';
export type Severity = 'low' | 'mid' | 'critical';

export interface AiUsageConfig {
  providers: Provider[];
  title: string;
  mode: LayoutMode;
  showCredits: boolean;
  showReview: boolean;
  theme: Theme;
}

export interface UsageWindow {
  usedPercent: number;
  resetAt: number | null;
  windowSeconds: number | null;
}

export interface ProviderUsage {
  provider: Provider;
  label: string;
  planLabel?: string;
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  review?: UsageWindow | null;
  credits?: {
    balance?: number | string;
    localMessages?: [number, number];
    cloudMessages?: [number, number];
  } | null;
  status: UsageStatus;
  fetchedAt: number | null;
  error?: string;
}

export interface FetchDeps {
  nowMs(): number;
  readText(path: string): Promise<string>;
  writeText(path: string, value: string): Promise<void>;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  homeDir(): string;
}
