/**
 * Ordinals Wallet — fully public API, no key required.
 *
 * Docs: https://blog.ordinalswallet.com/api  (base https://turbo.ordinalswallet.com)
 *
 * The order book is per-collection: `GET /collection/:slug/escrows` returns the
 * inscriptions currently in escrow (i.e. listed). We sweep a configurable set of
 * collections in parallel, which is how this venue gets aggregated at all.
 */

import { config } from '../config';
import { request, settleAll } from '../http';
import type { ListingQuery, MarketSource, UnifiedListing } from '../types';
import { asArray, depthOf, makeListing, n, pick, s, ts, wants } from './base';

const cfg = config.sources.ordinalswallet;

interface Escrow {
  id?: string;
  inscription?: string | { id?: string; num?: number; content_type?: string };
  satoshi_price?: number;
  price?: number;
  seller?: string;
  seller_address?: string;
  created_at?: string | number;
  status?: string;
}

async function collectionEscrows(slug: string, limit: number): Promise<UnifiedListing[]> {
  const res = await request<unknown>(`${cfg.base}/collection/${encodeURIComponent(slug)}/escrows`, {
    retries: 1,
    timeoutMs: 7000,
  });

  return asArray(res)
    .slice(0, limit)
    .map((r) => {
      const o = r as Escrow & Record<string, unknown>;

      const insc = o.inscription;
      const inscriptionId =
        typeof insc === 'string' ? insc : s(pick(insc, 'id')) ?? s(pick(o, 'inscription_id'));
      const inscriptionNumber =
        typeof insc === 'object' && insc ? n(pick(insc, 'num', 'number')) || undefined : undefined;

      const priceSats = n(pick(o, 'satoshi_price', 'price', 'amount'));
      if (!priceSats || !inscriptionId) return null;

      return makeListing({
        source: 'ordinalswallet',
        sourceName: 'Ordinals Wallet',
        sourceListingId: s(pick(o, 'id')) ?? inscriptionId,
        assetType: 'ordinal',
        title:
          s(pick(insc, 'name')) ??
          (inscriptionNumber ? `#${inscriptionNumber}` : slug.replace(/-/g, ' ')),
        subtitle: slug.replace(/-/g, ' '),
        inscriptionId,
        inscriptionNumber,
        contentType: s(pick(insc, 'content_type')),
        priceSats,
        sellerAddress: s(pick(o, 'seller', 'seller_address')),
        collectionSlug: slug,
        collectionName: slug.replace(/-/g, ' '),
        imageUrl: `${cfg.cdn}/inscription/preview/${inscriptionId}`,
        listedAt: ts(pick(o, 'created_at', 'createdAt')),
        marketUrl: `https://ordinalswallet.com/inscription/${inscriptionId}`,
        // Ordinals Wallet escrow buys are not exposed on the public read API,
        // so we hand the user off to the venue rather than pretend.
        buyable: false,
        raw: o,
      });
    })
    .filter((x): x is UnifiedListing => x !== null);
}

export const ordinalswallet: MarketSource = {
  id: 'ordinalswallet',
  name: 'Ordinals Wallet',
  url: 'https://ordinalswallet.com',
  assetTypes: ['ordinal'],
  configNote: 'Public API — no key needed. Tune ORDINALSWALLET_COLLECTIONS to widen the sweep.',

  isConfigured: () => cfg.enabled,

  async fetchListings(q) {
    if (!wants(['ordinal'], q)) return [];

    const slugs = q.collectionSlug ? [q.collectionSlug] : cfg.collections;
    if (!slugs.length) return [];

    const perCollection = Math.max(4, Math.ceil(depthOf(q) / slugs.length));

    const results = await settleAll(
      slugs.map((slug) => () => collectionEscrows(slug, perCollection)),
      6,
    );

    const out: UnifiedListing[] = [];
    let ok = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        ok++;
        out.push(...r.value);
      }
    }
    if (ok === 0 && results.length) throw (results[0] as PromiseRejectedResult).reason;
    return out;
  },
};
