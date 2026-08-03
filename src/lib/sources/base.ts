import type { AssetType, ListingQuery, SatRange, SourceId, UnifiedListing } from '../types';
import { classifyRanges, normalizeRarity } from '../sats';
import { config } from '../config';

/** Tolerant number coercion — upstreams mix strings, numbers and nulls freely. */
export function n(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const p = Number(v.replace(/[, ]/g, ''));
    if (Number.isFinite(p)) return p;
  }
  return fallback;
}

export function s(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length) return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

/** Epoch millis from seconds, millis, or ISO strings. */
export function ts(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const p = Date.parse(v);
    if (Number.isFinite(p)) return p;
    const num = Number(v);
    if (Number.isFinite(num)) return num > 1e12 ? num : num * 1000;
  }
  return undefined;
}

export function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  }
  return undefined;
}

export function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['data', 'items', 'list', 'listings', 'results', 'records', 'edges']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
      if (o[k] && typeof o[k] === 'object') {
        const inner = asArray(o[k]);
        if (inner.length) return inner;
      }
    }
  }
  return [];
}

export function depthOf(q: ListingQuery): number {
  return Math.min(config.maxDepth, Math.max(1, q.depth ?? config.defaultDepth));
}

/** Canonical ordinals content endpoint, used when a venue gives no image. */
export function ordinalsContentUrl(inscriptionId: string): string {
  return `https://ordinals.com/content/${inscriptionId}`;
}

/**
 * Build a UnifiedListing, filling in everything derivable.
 *
 * Rare-sat classification is recomputed locally from sat ranges whenever the
 * venue provides them — venue tags are treated as a hint, never as truth.
 */
export function makeListing(input: {
  source: SourceId;
  sourceName: string;
  sourceListingId: string;
  assetType: AssetType;
  title: string;
  priceSats: number;
  marketUrl: string;
  buyable?: boolean;
  subtitle?: string;
  inscriptionId?: string;
  inscriptionNumber?: number;
  contentType?: string;
  runeId?: string;
  runeName?: string;
  ticker?: string;
  amount?: number;
  unitPriceSats?: number;
  satRanges?: SatRange[];
  vendorRarity?: unknown;
  utxoSizeSats?: number;
  outpoint?: string;
  sellerAddress?: string;
  collectionSlug?: string;
  collectionName?: string;
  imageUrl?: string;
  listedAt?: number;
  updatedAt?: number;
  raw?: unknown;
}): UnifiedListing {
  const {
    source,
    sourceListingId,
    satRanges,
    vendorRarity,
    inscriptionId,
    amount,
    priceSats,
  } = input;

  let rarity = normalizeRarity(vendorRarity);
  let sattributes = undefined as UnifiedListing['sattributes'];
  let utxoSizeSats = input.utxoSizeSats;

  if (satRanges?.length) {
    const c = classifyRanges(satRanges);
    rarity = c.rarity;
    sattributes = c.sattributes;
    utxoSizeSats = utxoSizeSats ?? c.totalSats;
  }

  const unitPriceSats =
    input.unitPriceSats ?? (amount && amount > 0 ? priceSats / amount : undefined);

  return {
    id: `${source}:${sourceListingId}`,
    source,
    sourceName: input.sourceName,
    sourceListingId,
    assetType: input.assetType,
    title: input.title,
    subtitle: input.subtitle,
    inscriptionId,
    inscriptionNumber: input.inscriptionNumber,
    contentType: input.contentType,
    runeId: input.runeId,
    runeName: input.runeName,
    ticker: input.ticker,
    amount,
    unitPriceSats,
    satRanges,
    rarity,
    sattributes,
    utxoSizeSats,
    priceSats,
    outpoint: input.outpoint,
    sellerAddress: input.sellerAddress,
    collectionSlug: input.collectionSlug,
    collectionName: input.collectionName,
    imageUrl: input.imageUrl ?? (inscriptionId ? ordinalsContentUrl(inscriptionId) : undefined),
    marketUrl: input.marketUrl,
    listedAt: input.listedAt,
    updatedAt: input.updatedAt ?? input.listedAt,
    buyable: input.buyable ?? false,
    raw: input.raw,
  };
}

/** Does this source have anything worth asking for, given the query? */
export function wants(assetTypes: AssetType[], q: ListingQuery): boolean {
  if (!q.assetType || q.assetType === 'all') return true;
  return assetTypes.includes(q.assetType);
}
