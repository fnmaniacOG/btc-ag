import { config } from './config';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface FetchOpts extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  /** Retries on 429/5xx/network error. Exponential backoff with jitter. */
  retries?: number;
  json?: unknown;
}

/**
 * The only outbound HTTP path in the app.
 *
 * Timeouts are mandatory: one hung marketplace must never hold the whole
 * aggregate response open. Retries are bounded and only cover transient
 * classes (429, 5xx, network), never 4xx application errors.
 */
export async function request<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { timeoutMs = config.sourceTimeoutMs, retries = 2, json, headers, ...rest } = opts;

  const finalHeaders: Record<string, string> = {
    accept: 'application/json',
    'user-agent': config.userAgent,
    ...((headers as Record<string, string>) ?? {}),
  };

  let body = rest.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    finalHeaders['content-type'] = 'application/json';
  }

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...rest,
        body,
        headers: finalHeaders,
        signal: ctrl.signal,
        cache: 'no-store',
      });

      if (res.status === 429 || res.status >= 500) {
        throw new HttpError(`upstream ${res.status}`, res.status, url, await safeText(res));
      }
      if (!res.ok) {
        // 4xx: an application error. Do not retry — the request is simply wrong
        // or unauthorised, and hammering it will get the key banned.
        throw new HttpError(`upstream ${res.status}`, res.status, url, await safeText(res));
      }

      const text = await res.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (err) {
      lastErr = err;
      const retryable =
        !(err instanceof HttpError) || err.status === 429 || err.status >= 500;
      if (!retryable || attempt === retries) break;
      const backoff = 220 * 2 ** attempt + Math.random() * 180;
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run tasks with bounded concurrency, never rejecting. */
export async function settleAll<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

export function errMessage(e: unknown): string {
  if (e instanceof HttpError) return `HTTP ${e.status}`;
  if (e instanceof Error) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timeout';
    return e.message.slice(0, 140);
  }
  return String(e).slice(0, 140);
}
