/**
 * Two-tier cache: in-process memory in front of shared Upstash Redis.
 *
 * Read path:  memory → Redis → upstream fan-out
 * Write path: upstream result lands in both tiers
 *
 * Memory absorbs repeat hits on a warm lambda for free. Redis makes one
 * fan-out serve every visitor across every instance, which is what keeps the
 * operator's marketplace API quota from scaling with traffic.
 *
 * Single-flight de-duplication runs at both levels: in-process via a promise
 * map, cross-instance via a short Redis lock. Without the lock, a cold cache
 * plus a traffic spike means every instance stampedes the same nine venues at
 * the same instant.
 */

import { kvEnabled, kvGet, kvLock, kvSet } from './kv';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const memory = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    memory.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (memory.size > 500) {
    const now = Date.now();
    for (const [k, v] of memory) if (v.expiresAt < now) memory.delete(k);
  }
}

export interface CacheResult<T> {
  value: T;
  /** Served without a fresh upstream fan-out. */
  hit: boolean;
  tier: 'memory' | 'redis' | 'origin';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch through both cache tiers.
 *
 * `staleTtlMs` keeps a copy in Redis well past its fresh window. If every venue
 * is failing, serving a two-minute-old book beats serving an empty page — an
 * aggregator that goes blank the moment an upstream hiccups is not much of an
 * aggregator.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { staleTtlMs?: number } = {},
): Promise<CacheResult<T>> {
  const local = cacheGet<T>(key);
  if (local !== undefined) return { value: local, hit: true, tier: 'memory' };

  const existing = inflight.get(key);
  if (existing) {
    return { value: (await existing) as T, hit: true, tier: 'memory' };
  }

  const shared = await kvGet<Entry<T>>(key);
  if (shared && Date.now() < shared.expiresAt) {
    cacheSet(key, shared.value, Math.min(ttlMs, shared.expiresAt - Date.now()));
    return { value: shared.value, hit: true, tier: 'redis' };
  }

  const staleTtl = opts.staleTtlMs ?? ttlMs * 6;

  const work = (async (): Promise<T> => {
    // Cross-instance single flight. The winner refreshes; the losers wait
    // briefly and take whatever the winner published.
    if (kvEnabled()) {
      const gotLock = await kvLock(`lock:${key}`, 15_000);
      if (!gotLock) {
        for (let i = 0; i < 12; i++) {
          await sleep(250);
          const fresh = await kvGet<Entry<T>>(key);
          if (fresh && Date.now() < fresh.expiresAt) return fresh.value;
        }
        // Lock holder is slow or died — fall through and fetch it ourselves.
      }
    }

    try {
      const value = await fn();
      const entry: Entry<T> = { value, expiresAt: Date.now() + ttlMs };
      cacheSet(key, value, ttlMs);
      await kvSet(key, entry, staleTtl);
      return value;
    } catch (err) {
      // Origin failed. Serve stale rather than nothing.
      const stale = await kvGet<Entry<T>>(key);
      if (stale) {
        cacheSet(key, stale.value, 5_000);
        return stale.value;
      }
      throw err;
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, work);
  return { value: await work, hit: false, tier: 'origin' };
}

export function cacheClear(): void {
  memory.clear();
}
