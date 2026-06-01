import type { Fetcher, FetchRequest, FetchOutcome } from './types.js';

/** HTTP fetcher using global fetch, with a timeout and a single retry on failure. */
export class HttpFetcher implements Fetcher {
  async fetch(req: FetchRequest): Promise<FetchOutcome> {
    const attempts = 2; // initial + 1 retry
    let lastError = 'unknown error';
    for (let i = 0; i < attempts; i++) {
      const outcome = await this.attempt(req);
      if (outcome.ok) return outcome;
      lastError = outcome.error ?? lastError;
    }
    return { ok: false, error: lastError };
  }

  private async attempt(req: FetchRequest): Promise<FetchOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 5000);
    try {
      const res = await fetch(req.url, { headers: req.headers, signal: controller.signal });
      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status} ${res.statusText}`.trim() };
      }
      try {
        const value = req.responseType === 'text' ? await res.text() : await res.json();
        return { ok: true, status: res.status, value };
      } catch (parseErr) {
        return { ok: false, status: res.status, error: `invalid ${req.responseType ?? 'json'} body: ${describeError(parseErr)}` };
      }
    } catch (err) {
      return { ok: false, error: describeError(err) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Build a useful error string, surfacing the network cause (e.g. ECONNREFUSED host:port)
 * that undici otherwise hides behind a generic "fetch failed". */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: string; address?: string; port?: number; message?: string } }).cause;
    if (cause && (cause.code || cause.message)) {
      const where = cause.address ? ` ${cause.address}${cause.port ? ':' + cause.port : ''}` : '';
      return `${err.message} (${cause.code ?? cause.message}${where})`;
    }
    return err.message;
  }
  return String(err);
}
