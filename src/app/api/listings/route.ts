import { NextRequest, NextResponse } from 'next/server';
import { aggregate } from '@/lib/aggregate';
import { config } from '@/lib/config';
import { clientIp, rateLimit, rateLimitHeaders, tooManyRequests } from '@/lib/ratelimit';
import type { AssetType, ListingQuery, SatRarity, Sattribute, SourceId } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ASSET_TYPES: AssetType[] = ['ordinal', 'rune', 'rare-sat', 'brc20', 'token', 'pool'];
const SORTS = ['price_asc', 'price_desc', 'recent', 'unit_price_asc', 'rarity_desc'] as const;

function parse(req: NextRequest): ListingQuery {
  const sp = req.nextUrl.searchParams;

  const assetParam = sp.get('asset') ?? sp.get('assetType') ?? 'all';
  const assetType =
    assetParam === 'all' || ASSET_TYPES.includes(assetParam as AssetType)
      ? (assetParam as ListingQuery['assetType'])
      : 'all';

  const sortParam = sp.get('sort') ?? 'price_asc';
  const sort = (SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as ListingQuery['sort'])
    : 'price_asc';

  const list = (k: string) =>
    (sp.get(k) ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

  const num = (k: string) => {
    const v = Number(sp.get(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };

  return {
    assetType,
    // Cap the search string: it becomes part of the cache key, and unbounded
    // keys are how a public endpoint gets its cache poisoned into uselessness.
    q: sp.get('q')?.slice(0, 80) || undefined,
    sources: list('sources') as SourceId[],
    minPriceSats: num('minPrice'),
    maxPriceSats: num('maxPrice'),
    rarity: list('rarity') as SatRarity[],
    sattributes: list('sattributes') as Sattribute[],
    collectionSlug: sp.get('collection')?.slice(0, 80) || undefined,
    sort,
    limit: Math.min(num('limit') ?? 120, 300),
    depth: num('depth'),
  };
}

export async function GET(req: NextRequest) {
  const limit = await rateLimit(
    clientIp(req),
    'listings',
    config.rateLimit.listings,
    config.rateLimit.windowMs,
  );
  if (!limit.ok) return tooManyRequests(limit);

  try {
    const result = await aggregate(parse(req));

    return NextResponse.json(result, {
      headers: {
        // Vercel's edge holds this for 15s and serves stale for a minute while
        // revalidating, so bursts of visitors never reach the origin at all.
        'cache-control': 'public, s-maxage=15, stale-while-revalidate=60',
        'x-btcag-cached': String(result.cached),
        'x-btcag-tier': result.tier,
        'x-btcag-elapsed-ms': String(result.elapsedMs),
        ...rateLimitHeaders(limit),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'aggregation failed' },
      { status: 500 },
    );
  }
}
