/**
 * Gamma — ordinals & Bitcoin NFT marketplace.
 *
 * Gamma does not publish an API reference. The routes below are its public
 * marketplace endpoints, and every one of them is overridable by env so this
 * adapter can be re-pointed without a code change when Gamma moves things:
 *
 *   GAMMA_BASE=https://gamma.io/api/v1
 *   GAMMA_LISTINGS_PATH=/ordinals/listings
 *
 * The response walker is deliberately shape-agnostic: it finds the array
 * wherever it is nested and maps by field aliases, so a rename upstream
 * degrades one field rather than the whole source.
 */

import { config } from '../config';
import { request } from '../http';
import type { ListingQuery, MarketSource, UnifiedListing } from '../types';
import { asArray, depthOf, makeListing, n, pick, s, ts, wants } from './base';

const cfg = config.sources.gamma;
const LISTINGS_PATH = (process.env.GAMMA_LISTINGS_PATH ?? '/ordinals/listings').trim();

export const gamma: MarketSource = {
  id: 'gamma',
  name: 'Gamma',
  url: 'https://gamma.io',
  assetTypes: ['ordinal'],
  configNote:
    'Returning 404 — the guessed route is wrong and Gamma blocks server-side discovery. Find the real one in browser DevTools → Network on gamma.io/ordinals, then set GAMMA_BASE / GAMMA_LISTINGS_PATH.',

  isConfigured: () => cfg.enabled,

  async fetchListings(q) {
    if (!wants(['ordinal'], q)) return [];

    const limit = depthOf(q);
    const params = new URLSearchParams({
      limit: String(Math.min(100, limit)),
      offset: '0',
      sortBy: q.sort === 'price_desc' ? 'price_desc' : q.sort === 'recent' ? 'recent' : 'price_asc',
    });
    if (q.collectionSlug) params.set('collection', q.collectionSlug);
    if (q.q) params.set('search', q.q);

    const res = await request<unknown>(`${cfg.base}${LISTINGS_PATH}?${params}`, {
      headers: cfg.apiKey ? { 'x-api-key': cfg.apiKey } : undefined,
      retries: 1,
    });

    return asArray(res)
      .map((r) => {
        const o = r as Record<string, unknown>;
        const inscriptionId = s(pick(o, 'inscriptionId', 'inscription_id', 'id'));
        const priceSats =
          n(pick(o, 'priceSats', 'price_sats', 'satoshiPrice')) ||
          Math.round(n(pick(o, 'priceBtc', 'price_btc')) * 1e8) ||
          n(pick(o, 'price'));

        if (!inscriptionId || !priceSats) return null;

        const collectionSlug = s(pick(o, 'collectionSlug', 'collection_slug', 'collection'));

        return makeListing({
          source: 'gamma',
          sourceName: 'Gamma',
          sourceListingId: s(pick(o, 'listingId', 'listing_id')) ?? inscriptionId,
          assetType: 'ordinal',
          title:
            s(pick(o, 'name', 'title')) ??
            (pick(o, 'inscriptionNumber') ? `#${n(pick(o, 'inscriptionNumber'))}` : 'Inscription'),
          subtitle: s(pick(o, 'collectionName', 'collection_name')),
          inscriptionId,
          inscriptionNumber:
            pick(o, 'inscriptionNumber', 'inscription_number') !== undefined
              ? n(pick(o, 'inscriptionNumber', 'inscription_number'))
              : undefined,
          contentType: s(pick(o, 'contentType', 'content_type', 'mimeType')),
          priceSats,
          outpoint: s(pick(o, 'outpoint', 'utxo')),
          sellerAddress: s(pick(o, 'sellerAddress', 'seller', 'owner')),
          collectionSlug,
          collectionName: s(pick(o, 'collectionName', 'collection_name')),
          imageUrl: s(pick(o, 'imageUrl', 'image', 'thumbnailUrl', 'preview')),
          listedAt: ts(pick(o, 'listedAt', 'createdAt', 'created_at')),
          marketUrl: `https://gamma.io/ordinals/inscription/${inscriptionId}`,
          // Gamma's buy path is not publicly documented; hand off to the venue.
          buyable: false,
          raw: o,
        });
      })
      .filter((x): x is UnifiedListing => x !== null);
  },
};
