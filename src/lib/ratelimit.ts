/**
 * Per-IP rate limiting.
 *
 * On a public aggregator this is not politeness, it is survival: every visitor
 * request can fan out to nine marketplaces on the operator's API keys. One
 * scraper looping `/api/listings` without limits will burn a monthly quota in
 * an afternoon and get the keys suspended.
 *
 * Fixed windows via Redis INCR when Upstash is configured, in-process otherwise.
 * The in-process fallback is per-instance and therefore leaky on serverless —
 * it is a safety net for local dev, not the real defence.
 */

import { kvEnabled, kvIncr } from './kv';
import { config } from './config';

interface Window {
  count: number;
  resetAt: number;
}

const local = new Map<string, Window>();

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

function localLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cur = local.get(key);

  if (!cur || now > cur.resetAt) {
    const w = { count: 1, resetAt: now + windowMs };
    local.set(key, w);
    if (local.size > 5_000) {
      for (const [k, v] of local) if (v.resetAt < now) local.delete(k);
    }
    return { ok: true, limit, remaining: limit - 1, resetAt: w.resetAt };
  }

  cur.count++;
  return {
    ok: cur.count <= limit,
    limit,
    remaining: Math.max(0, limit - cur.count),
    resetAt: cur.resetAt,
  };
}

export async function rateLimit(
  identifier: string,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (!config.rateLimit.enabled) {
    return { ok: true, limit, remaining: limit, resetAt: Date.now() + windowMs };
  }

  const window = Math.floor(Date.now() / windowMs);
  const key = `rl:${bucket}:${identifier}:${window}`;

  if (kvEnabled()) {
    const count = await kvIncr(key, windowMs);
    if (count !== null) {
      return {
        ok: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt: (window + 1) * windowMs,
      };
    }
    // Redis unreachable — fall through to the local limiter rather than
    // failing open completely.
  }

  return localLimit(key, limit, windowMs);
}

/**
 * Caller IP. On Vercel `x-forwarded-for` is set by the platform edge and its
 * first entry is the real client, so it cannot be spoofed by the client itself.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h.get('x-real-ip') ?? h.get('cf-connecting-ip') ?? 'unknown';
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    'x-ratelimit-limit': String(r.limit),
    'x-ratelimit-remaining': String(r.remaining),
    'x-ratelimit-reset': String(Math.ceil(r.resetAt / 1000)),
  };
}

export function tooManyRequests(r: RateLimitResult): Response {
  const retryAfter = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded. btc.ag aggregates nine marketplaces on shared API keys — please slow down.',
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(retryAfter),
        ...rateLimitHeaders(r),
      },
    },
  );
}
