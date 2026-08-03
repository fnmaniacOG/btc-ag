/**
 * Odin.fun — bonding-curve and AMM market for Bitcoin-native tokens that etch
 * to Runes once they bond.
 *
 * Docs: https://docs.odin.fun/api-reference/overview  (public, no key)
 *
 * Odin is not an order book: there are no discrete listings, there is a curve.
 * We model each token's current ask as a listing so it sorts alongside
 * everything else, priced per whole token in sats.
 */

import { config } from '../config';
import { request } from '../http';
import type { ListingQuery, MarketSource, UnifiedListing } from '../types';
import { asArray, depthOf, makeListing, n, pick, s, ts, wants } from './base';

const cfg = config.sources.odin;

/** Odin quotes prices in millisats per token unit on the curve. */
function toSatsPerToken(raw: number, divisibility: number): number {
  if (!raw) return 0;
  const perUnit = raw / 1000; // millisats → sats
  return divisibility > 0 ? perUnit * 10 ** divisibility : perUnit;
}

export const odin: MarketSource = {
  id: 'odin',
  name: 'Odin.fun',
  url: 'https://odin.fun',
  assetTypes: ['token', 'rune'],
  configNote: 'Public API — no key needed.',

  isConfigured: () => cfg.enabled,

  async fetchListings(q) {
    if (!wants(['token', 'rune'], q)) return [];

    const limit = Math.min(100, depthOf(q));
    const params = new URLSearchParams({
      sort: q.sort === 'recent' ? 'created_time:desc' : 'marketcap:desc',
      page: '1',
      limit: String(limit),
    });
    if (q.q) params.set('search', q.q);

    const res = await request<unknown>(`${cfg.base}/tokens?${params}`, { retries: 1 });

    return asArray(res)
      .map((r) => {
        const o = r as Record<string, unknown>;
        const id = s(pick(o, 'id', 'token_id'));
        if (!id) return null;

        const ticker = s(pick(o, 'ticker', 'symbol', 'name')) ?? id;
        const divisibility = n(pick(o, 'divisibility', 'decimals'), 0);
        const priceRaw = n(pick(o, 'price', 'last_price', 'buy_price'));
        const satsPerToken = toSatsPerToken(priceRaw, divisibility);

        // A token that has bonded is a real Rune; before that it lives only on
        // the curve. We label it accordingly so filters behave sensibly.
        const bonded = Boolean(pick(o, 'bonded', 'is_bonded'));
        const runeName = s(pick(o, 'rune', 'rune_name'));

        return makeListing({
          source: 'odin',
          sourceName: 'Odin.fun',
          sourceListingId: id,
          assetType: bonded && runeName ? 'rune' : 'token',
          title: s(pick(o, 'name')) ?? ticker,
          subtitle: bonded ? 'Bonded → Runes' : 'Bonding curve',
          ticker,
          runeName,
          amount: 1,
          unitPriceSats: satsPerToken,
          priceSats: Math.max(1, Math.round(satsPerToken)),
          imageUrl: `${cfg.base}/token/${id}/image`,
          listedAt: ts(pick(o, 'created_time', 'createdAt')),
          marketUrl: `https://odin.fun/token/${id}`,
          buyable: false, // Odin trades run through its ICP canister, not a PSBT.
          raw: o,
        });
      })
      .filter((x): x is UnifiedListing => x !== null && x.priceSats > 0);
  },
};
