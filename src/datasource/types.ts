/** A single resolved fetch request (placeholders already substituted). */
export interface FetchRequest {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  responseType?: 'json' | 'text';
}

/** The raw outcome of one fetch attempt. */
export interface FetchOutcome {
  ok: boolean;
  value?: unknown;
  error?: string;
  /** HTTP status code when the server responded (absent on network errors). */
  status?: number;
}

/** Pluggable HTTP layer so the cache can be tested with a fake fetcher. */
export interface Fetcher {
  fetch(req: FetchRequest): Promise<FetchOutcome>;
}
