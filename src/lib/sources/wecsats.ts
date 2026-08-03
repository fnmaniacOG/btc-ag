/**
 * wecsats — rare sats venue.
 *
 * No published API reference. This adapter targets the site's own JSON
 * endpoint and is fully env-overridable:
 *
 *   WECSATS_BASE=https://wecsats.com/api
 *   WECSATS_LISTINGS_PATH=/listings
 *   WECSATS_API_KEY=...            # optional, sent as x-api-key
 *
 * Whatever sat ranges come back are reclassified locally through ordinals
 * theory, so a wecsats listing is directly comparable to a Magisat one even
 * though the two label sattributes differently.
 */

import { config } from '../config';
import { request } from '../http';
import type { ListingQuery, MarketSource, SatRange, UnifiedListing } from '../types';
import { asArray, depthOf, makeListing, n, pick, s, ts, wants } from './base';

const cfg = config.sources.wecsats;
const LISTINGS_PATH = (process.env.WECSATS_LISTINGS_PATH ?? '/listings').trim();

function ranges(o: Record<string, unknown>): SatRange[] | undefined {
  const raw = pick(o, 'satRanges', 'ranges', 'sat_ranges', 'sats');
  if (!Array.isArray(raw) || !raw.length) {
    // Some payloads carry a single sat number rather than a range list.
    const single = n(pick(o, 'sat', 'satNumber', 'sat_number'), -1);
    return single >= 0 ? [{ start: single, size: 1 }] : undefined;
  }

  const out: SatRange[] = [];
  for (const item of raw) {
    if (typeof item === 'number') {
      out.push({ start: item, size: 1 });
      continue;
    }
    if (Array.isArray(item) && item.length >= 2) {
      const start = n(item[0], -1);
      const end = n(item[1], -1);
      if (start >= 0 && end > start) out.push({ start, size: end - start });
      continue;
    }
    if (item && typeof item === 'object') {
      const r = item as Record<string, unknown>;
      const start = n(pick(r, 'start', 'from', 'sat'), -1);
      if (start < 0) continue;
      const end = n(pick(r, 'end', 'to'), -1);
      out.push({ start, size: end > start ? end - start : n(pick(r, 'size', 'count'), 1) });
    }
  }
  return out.length ? out : undefined;
}

export const wecsats: MarketSource = {
  id: 'wecsats',
  name: 'wecsats',
  url: 'https://wecsats.com',
  assetTypes: ['rare-sat'],
  configNote:
    'No published API. Override WECSATS_BASE / WECSATS_LISTINGS_PATH to point at the live JSON route; WECSATS_API_KEY optional.',

  isConfigured: () => cfg.enabled,

  async fetchListings(q) {
    if (!wants(['rare-sat'], q)) return [];

    const limit = depthOf(q);
    const params = new URLSearchParams({
      limit: String(Math.min(100, limit)),
      offset: '0',
      status: 'active',
      sort: q.sort === 'price_desc' ? 'price_desc' : 'price_asc',
    });
    if (q.minPriceSats) params.set('minPrice', String(q.minPriceSats));
    if (q.maxPriceSats) params.set('maxPrice', String(q.maxPriceSats));

    const res = await request<unknown>(`${cfg.base}${LISTINGS_PATH}?${params}`, {
      headers: cfg.apiKey ? { 'x-api-key': cfg.apiKey } : undefined,
      retries: 1,
    });

    return asArray(res)
      .map((r) => {
        const o = r as Record<string, unknown>;
        const priceSats = n(pick(o, 'price', 'priceSats', 'price_sats', 'askSats'));
        if (!priceSats) return null;

        const id =
          s(pick(o, 'id', 'listingId', 'listing_id', 'uuid')) ??
          s(pick(o, 'utxo', 'outpoint')) ??
          String(priceSats);

        const satRanges = ranges(o);
        const utxoSize = n(pick(o, 'utxoSize', 'value', 'utxo_value')) || undefined;

        return makeListing({
          source: 'wecsats',
          sourceName: 'wecsats',
          sourceListingId: id,
          assetType: 'rare-sat',
          title: s(pick(o, 'name', 'tag', 'sattribute', 'title')) ?? 'Rare sat UTXO',
          subtitle: utxoSize ? `${utxoSize.toLocaleString('en-US')} sats` : undefined,
          priceSats,
          satRanges,
          vendorRarity: pick(o, 'rarity'),
          utxoSizeSats: utxoSize,
          outpoint: s(pick(o, 'utxo', 'outpoint')),
          sellerAddress: s(pick(o, 'seller', 'sellerAddress', 'owner')),
          listedAt: ts(pick(o, 'createdAt', 'listedAt', 'created_at')),
          updatedAt: ts(pick(o, 'updatedAt', 'updated_at')),
          marketUrl: `https://wecsats.com/listing/${id}`,
          buyable: false,
          raw: o,
        });
      })
      .filter((x): x is UnifiedListing => x !== null);
  },
};
