/**
 * The aggregation engine.
 *
 * Nine venues, one order book. The hard parts are not the HTTP calls — they are
 * (1) never letting one slow or broken venue degrade the page, and
 * (2) recognising that two venues are selling the *same thing*, so the user
 *     sees one row with the best price rather than three rows of noise.
 */

import { config } from './config';
import { cacheSet, cached } from './cache';
import { kvSet } from './kv';
import { errMessage, settleAll } from './http';
import { SOURCES } from './sources';
import { RARITY_ORDER } from './sats';
import type {
  AggregateResult,
  ListingQuery,
  SourceHealth,
  UnifiedListing,
} from './types';

/**
 * Identity of the underlying asset, independent of who is selling it.
 *
 * Ordinals are identified by inscription id. Rare sats by the UTXO they live
 * in. Fungibles have no per-unit identity, so they key on ticker — which means
 * two venues quoting the same rune collapse into one row with the cheaper ask
 * shown and the other recorded in `alsoOn`.
 */
function identityKey(l: UnifiedListing): string {
  if (l.inscriptionId) return `insc:${l.inscriptionId}`;
  if (l.outpoint) return `utxo:${l.outpoint}`;
  if (l.runeId) return `rune:${l.runeId}`;
  if (l.runeName) return `rune:${l.runeName.toUpperCase()}`;
  if (l.ticker) return `tick:${l.assetType}:${l.ticker.toUpperCase()}`;
  return `id:${l.id}`;
}

/**
 * Collapse duplicates across venues.
 *
 * The cheapest ask wins the row. Everything else becomes `alsoOn`, which is
 * what drives the spread column — the reason to use an aggregator at all.
 */
export function dedupe(listings: UnifiedListing[]): UnifiedListing[] {
  const groups = new Map<string, UnifiedListing[]>();

  for (const l of listings) {
    const k = identityKey(l);
    const g = groups.get(k);
    if (g) g.push(l);
    else groups.set(k, [l]);
  }

  const out: UnifiedListing[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }

    // For fungibles, compare unit price; for uniques, total price.
    const byPrice = [...group].sort((a, b) => {
      const au = a.unitPriceSats ?? a.priceSats;
      const bu = b.unitPriceSats ?? b.priceSats;
      return au - bu;
    });

    const best = byPrice[0];
    const others = byPrice.slice(1);

    out.push({
      ...best,
      crossListed: true,
      alsoOn: others.map((o) => ({
        source: o.source,
        priceSats: o.priceSats,
        marketUrl: o.marketUrl,
      })),
    });
  }

  return out;
}

function matchesText(l: UnifiedListing, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    l.title,
    l.subtitle,
    l.collectionName,
    l.collectionSlug,
    l.runeName,
    l.ticker,
    l.inscriptionId,
    l.sourceName,
    ...(l.sattributes ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function applyFilters(listings: UnifiedListing[], q: ListingQuery): UnifiedListing[] {
  let out = listings;

  if (q.assetType && q.assetType !== 'all') {
    out = out.filter((l) => l.assetType === q.assetType);
  }
  if (q.minPriceSats !== undefined) out = out.filter((l) => l.priceSats >= q.minPriceSats!);
  if (q.maxPriceSats !== undefined) out = out.filter((l) => l.priceSats <= q.maxPriceSats!);
  if (q.rarity?.length) out = out.filter((l) => l.rarity && q.rarity!.includes(l.rarity));
  if (q.sattributes?.length) {
    out = out.filter((l) => l.sattributes?.some((a) => q.sattributes!.includes(a)));
  }
  if (q.collectionSlug) out = out.filter((l) => l.collectionSlug === q.collectionSlug);
  if (q.q) out = out.filter((l) => matchesText(l, q.q!));

  return out;
}

export function sortListings(listings: UnifiedListing[], sort: ListingQuery['sort']): UnifiedListing[] {
  const out = [...listings];
  switch (sort) {
    case 'price_desc':
      return out.sort((a, b) => b.priceSats - a.priceSats);
    case 'recent':
      return out.sort((a, b) => (b.listedAt ?? 0) - (a.listedAt ?? 0));
    case 'unit_price_asc':
      return out.sort(
        (a, b) => (a.unitPriceSats ?? a.priceSats) - (b.unitPriceSats ?? b.priceSats),
      );
    case 'rarity_desc':
      return out.sort((a, b) => {
        const ar = a.rarity ? RARITY_ORDER[a.rarity] : -1;
        const br = b.rarity ? RARITY_ORDER[b.rarity] : -1;
        if (br !== ar) return br - ar;
        return a.priceSats - b.priceSats;
      });
    default:
      return out.sort((a, b) => a.priceSats - b.priceSats);
  }
}

function cacheKey(q: ListingQuery): string {
  return JSON.stringify({
    a: q.assetType ?? 'all',
    q: q.q ?? '',
    s: q.sources?.slice().sort() ?? [],
    c: q.collectionSlug ?? '',
    d: q.depth ?? config.defaultDepth,
    so: q.sort ?? 'price_asc',
    mn: q.minPriceSats ?? 0,
    mx: q.maxPriceSats ?? 0,
  });
}

/**
 * Fan out to every configured venue, in parallel, with per-source isolation.
 *
 * A source that times out, 500s, or returns garbage produces an `ok: false`
 * entry in `sources` and contributes zero listings. It never throws upward and
 * never blocks the rest of the response.
 */
export async function aggregate(query: ListingQuery): Promise<AggregateResult> {
  const key = `agg:${cacheKey(query)}`;

  if (query.forceRefresh) {
    const value = await fanOut(query);
    cacheSet(key, value, config.cacheTtlMs);
    await kvSet(key, { value, expiresAt: Date.now() + config.cacheTtlMs }, config.cacheTtlMs * 6);
    return { ...value, cached: false, tier: 'origin' };
  }

  const { value, hit, tier } = await cached(key, config.cacheTtlMs, () => fanOut(query));

  return { ...value, cached: hit, tier };
}

/** One full nine-venue fan-out. Always called through the cache except by cron. */
async function fanOut(query: ListingQuery): Promise<AggregateResult> {
  {
    const started = Date.now();

    const selected = query.sources?.length
      ? SOURCES.filter((s) => query.sources!.includes(s.id))
      : SOURCES;

    const health: SourceHealth[] = [];
    const active = selected.filter((s) => {
      const configured = s.isConfigured();
      if (!configured) {
        health.push({
          source: s.id,
          name: s.name,
          url: s.url,
          assetTypes: [...s.assetTypes],
          ok: false,
          configured: false,
          note: s.configNote,
        });
      }
      return configured;
    });

    const results = await settleAll(
      active.map((source) => async () => {
        const t0 = Date.now();
        const listings = await source.fetchListings(query);
        return { source, listings, latencyMs: Date.now() - t0 };
      }),
      config.concurrency,
    );

    const all: UnifiedListing[] = [];

    results.forEach((r, i) => {
      const src = active[i];
      if (r.status === 'fulfilled') {
        all.push(...r.value.listings);
        health.push({
          source: src.id,
          name: src.name,
          url: src.url,
          assetTypes: [...src.assetTypes],
          ok: true,
          configured: true,
          latencyMs: r.value.latencyMs,
          count: r.value.listings.length,
        });
      } else {
        health.push({
          source: src.id,
          name: src.name,
          url: src.url,
          assetTypes: [...src.assetTypes],
          ok: false,
          configured: true,
          note: errMessage(r.reason),
        });
      }
    });

    const merged = dedupe(all);
    const filtered = applyFilters(merged, query);
    const sorted = sortListings(filtered, query.sort);

    // Keep the status rail in the declared source order, not completion order.
    const order = new Map(SOURCES.map((s, i) => [s.id, i]));
    health.sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0));

    const result: AggregateResult = {
      listings: sorted.slice(0, query.limit ?? 200),
      sources: health,
      total: sorted.length,
      elapsedMs: Date.now() - started,
      cached: false,
      tier: 'origin',
      fetchedAt: Date.now(),
    };

    return result;
  }
}

/** Best (lowest) ask per venue for one asset — the arbitrage view. */
export function spread(listing: UnifiedListing): {
  bestSats: number;
  worstSats: number;
  spreadSats: number;
  spreadPct: number;
} | null {
  if (!listing.alsoOn?.length) return null;
  const prices = [listing.priceSats, ...listing.alsoOn.map((o) => o.priceSats)];
  const bestSats = Math.min(...prices);
  const worstSats = Math.max(...prices);
  const spreadSats = worstSats - bestSats;
  return {
    bestSats,
    worstSats,
    spreadSats,
    spreadPct: bestSats > 0 ? (spreadSats / bestSats) * 100 : 0,
  };
}
