/**
 * Shared key-value store, backed by Upstash Redis over its REST API.
 *
 * Why this exists: on Vercel every serverless instance has its own memory. With
 * an in-process cache only, ten cold lambdas mean ten full nine-venue fan-outs
 * for the same page — which burns the operator's marketplace API quota roughly
 * in proportion to traffic. That is the single fastest way to get an aggregator's
 * API keys rate-limited or revoked.
 *
 * With Upstash, one fan-out serves every visitor on every instance.
 *
 * No SDK: the REST API is a handful of fetch calls, and avoiding the dependency
 * keeps the bundle small and the failure modes obvious. If Upstash is not
 * configured or is unreachable, everything degrades to the in-process cache —
 * the site stays up, it just does more upstream work.
 */

import { config } from './config';

const url = () => config.redis.url.replace(/\/+$/, '');
const enabled = () => Boolean(config.redis.url && config.redis.token);

export const kvEnabled = enabled;

async function command<T>(args: (string | number)[]): Promise<T | null> {
  if (!enabled()) return null;

  try {
    const res = await fetch(url(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.redis.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
      signal: AbortSignal.timeout(config.redis.timeoutMs),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { result?: T; error?: string };
    if (data.error) return null;
    return (data.result ?? null) as T | null;
  } catch {
    // A cache miss is always survivable. Never let the store take the site down.
    return null;
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const raw = await command<string>(['GET', key]);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const ttl = Math.max(1, Math.ceil(ttlMs / 1000));
  await command(['SET', key, JSON.stringify(value), 'EX', ttl]);
}

export async function kvDel(key: string): Promise<void> {
  await command(['DEL', key]);
}

/**
 * Increment a counter and set its expiry on first write.
 * Returns the post-increment count, or null when the store is unavailable.
 */
export async function kvIncr(key: string, windowMs: number): Promise<number | null> {
  const count = await command<number>(['INCR', key]);
  if (count === null) return null;
  if (count === 1) await command(['PEXPIRE', key, windowMs]);
  return count;
}

/**
 * Best-effort distributed lock, used so that exactly one instance refreshes a
 * cold cache entry (or the ORD.NET token) rather than all of them at once.
 */
export async function kvLock(key: string, ttlMs: number): Promise<boolean> {
  const res = await command<string | null>(['SET', key, '1', 'NX', 'PX', ttlMs]);
  return res === 'OK';
}

export async function kvPing(): Promise<boolean> {
  if (!enabled()) return false;
  const res = await command<string>(['PING']);
  return res === 'PONG';
}
