/**
 * ORD.NET — wallet-authenticated ordinals order book.
 *
 * Docs: https://developers.ord.net  (base https://ord.net/api/v1)
 *
 * Endpoints per the published spec:
 *   GET  /listings                                   cursor-paginated, sort: recent | price
 *   POST /collection/:slug/purchases/preflight       builds the purchase PSBT
 *   POST /collection/:slug/purchases/submit          broadcasts the signed PSBT
 *
 * Auth is a bearer token valid for one hour, obtained by BIP-322 signing.
 * `ordnet-auth.ts` keeps it fresh; this adapter just asks for the current one.
 *
 * Note the rate limits: trading reads are 60/IP and 30/profile per 60s. Since
 * the whole site shares one server IP and one profile, the aggregate cache is
 * what keeps btc.ag comfortably inside that budget.
 */

import { config } from '../config';
import { HttpError, request } from '../http';
import {
  explainOrdnetError,
  getOrdnetSession,
  invalidateOrdnetSession,
} from '../ordnet-auth';
import type {
  BuyQuote,
  BuyResult,
  BuyerContext,
  ListingQuery,
  MarketSource,
  UnifiedListing,
} from '../types';
import { asArray, depthOf, makeListing, n, pick, s, ts, wants } from './base';

const cfg = config.sources.ordnet;

async function authed(): Promise<{ headers: Record<string, string>; bindingId?: string }> {
  const session = await getOrdnetSession();
  if (!session) throw new Error('ordnet: no session (set ORDNET_SIGNING_WIF)');
  return {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
    },
    bindingId: session.walletBindingId,
  };
}

/**
 * Call ORD.NET with the managed session, re-authenticating once on 401.
 * Tokens can expire mid-flight; a single transparent retry hides that.
 */
async function call<T>(path: string, init: Parameters<typeof request>[1] = {}): Promise<T> {
  const { headers } = await authed();
  try {
    return await request<T>(`${cfg.base}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      await invalidateOrdnetSession();
      const retry = await authed();
      return request<T>(`${cfg.base}${path}`, {
        ...init,
        headers: { ...retry.headers, ...(init.headers as Record<string, string>) },
      });
    }
    throw err;
  }
}

/** ORD.NET accepts only `recent` and `price`. */
function sortParam(q: ListingQuery): string {
  return q.sort === 'recent' ? 'recent' : 'price';
}

export const ordnet: MarketSource = {
  id: 'ordnet',
  name: 'ORD.NET',
  url: 'https://ord.net',
  assetTypes: ['ordinal'],
  configNote:
    'Set ORDNET_SIGNING_WIF — a dedicated wallet holding ≥ 0.01 BTC. ORD.NET has no API keys; btc.ag BIP-322 signs its hourly auth challenge automatically.',

  isConfigured: () => cfg.enabled && Boolean(cfg.signingWif || cfg.token),

  async fetchListings(q) {
    if (!wants(['ordinal'], q)) return [];

    const limit = depthOf(q);
    const out: UnifiedListing[] = [];
    let cursor: string | undefined;

    try {
      // Cursor pagination: the cursor encodes sort + filters, so those must not
      // change between pages or the server rejects it.
      for (let page = 0; page < 4 && out.length < limit; page++) {
        const params = new URLSearchParams({
          sort: sortParam(q),
          limit: String(Math.min(100, limit)),
        });
        if (q.collectionSlug) params.set('collectionSlug', q.collectionSlug);
        if (cursor) params.set('cursor', cursor);

        const res = await call<Record<string, unknown>>(`/listings?${params}`);
        const items = asArray(res);
        if (!items.length) break;

        for (const r of items) {
          const o = r as Record<string, unknown>;
          const inscriptionId = s(pick(o, 'inscriptionId', 'inscription_id', 'id'));
          const priceSats = n(pick(o, 'priceSats', 'price_sats', 'askingPrice', 'price'));
          if (!inscriptionId || !priceSats) continue;

          const collectionSlug = s(pick(o, 'collectionSlug', 'collection_slug'));

          out.push(
            makeListing({
              source: 'ordnet',
              sourceName: 'ORD.NET',
              sourceListingId: s(pick(o, 'listingId', 'listing_id')) ?? inscriptionId,
              assetType: 'ordinal',
              title:
                s(pick(o, 'name', 'title')) ??
                (pick(o, 'inscriptionNumber')
                  ? `#${n(pick(o, 'inscriptionNumber'))}`
                  : 'Inscription'),
              subtitle: s(pick(o, 'collectionName', 'collection_name')),
              inscriptionId,
              inscriptionNumber:
                pick(o, 'inscriptionNumber', 'inscription_number') !== undefined
                  ? n(pick(o, 'inscriptionNumber', 'inscription_number'))
                  : undefined,
              contentType: s(pick(o, 'contentType', 'content_type')),
              priceSats,
              // ORD.NET returns satributes on the item card — kept as a hint,
              // but makeListing recomputes from sat ranges when present.
              vendorRarity: pick(o, 'rarity'),
              outpoint: s(pick(o, 'location', 'outpoint', 'utxo')),
              sellerAddress: s(pick(o, 'owner', 'sellerAddress', 'seller')),
              collectionSlug,
              collectionName: s(pick(o, 'collectionName', 'collection_name')),
              imageUrl: s(pick(o, 'displayUrl', 'mediaUrl', 'imageUrl', 'preview')),
              listedAt: ts(pick(o, 'listedAt', 'createdAt', 'created_at')),
              marketUrl: `https://ord.net/i/${inscriptionId}`,
              // Buying needs the collection slug for the purchase route.
              buyable: Boolean(collectionSlug),
              raw: o,
            }),
          );
        }

        const next = s(pick(res, 'cursor', 'nextCursor', 'next_cursor'));
        if (!next || next === cursor) break;
        cursor = next;
      }
    } catch (err) {
      throw new Error(explainOrdnetError(err));
    }

    return out.slice(0, limit);
  },

  async quoteBuy(listing, buyer: BuyerContext): Promise<BuyQuote> {
    const slug = listing.collectionSlug;
    if (!slug) throw new Error('ordnet: listing has no collection slug');

    const { bindingId } = await authed();

    const res = await call<Record<string, unknown>>(
      `/collection/${encodeURIComponent(slug)}/purchases/preflight`,
      {
        method: 'POST',
        json: {
          inscriptionId: listing.inscriptionId,
          priceSats: listing.priceSats,
          walletBindingId: bindingId,
          buyerOrdinalsAddress: buyer.ordinalsAddress,
          buyerPaymentAddress: buyer.paymentAddress,
          buyerPaymentPublicKey: buyer.paymentPublicKey,
          feeRate: buyer.feeRate,
          // Required for API-created bindings; capped at 1000 by the API.
          spendableUtxos: buyer.spendableUtxos?.slice(0, 1000),
        },
      },
    );

    const psbt = s(pick(res, 'psbt', 'psbtBase64'));
    if (!psbt) throw new Error('ordnet: preflight returned no PSBT');

    const networkFeeSats = n(pick(res, 'minerFeeSats', 'networkFeeSats'));
    const marketplaceFeeSats = n(pick(res, 'marketplaceFeeSats', 'feeSats'));

    return {
      listingId: listing.id,
      source: 'ordnet',
      priceSats: listing.priceSats,
      marketplaceFeeSats,
      networkFeeSats,
      totalSats: listing.priceSats + marketplaceFeeSats + networkFeeSats,
      feeRate: buyer.feeRate,
      psbtBase64: psbt,
      signingIndexes: (pick(res, 'signingIndexes') as number[]) ?? [],
      sighashType: pick(res, 'sigHash') !== undefined ? n(pick(res, 'sigHash')) : undefined,
      // Submit must echo the preflight fields and handles verbatim.
      submitContext: {
        slug,
        inscriptionId: listing.inscriptionId,
        priceSats: listing.priceSats,
        walletBindingId: bindingId,
        purchaseAnchorUtxoId: pick(res, 'purchaseAnchorUtxoId'),
        selectedPaymentUtxos: pick(res, 'selectedPaymentUtxos'),
        expectedSettlementTxid: pick(res, 'expectedSettlementTxid'),
      },
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
  },

  async submitBuy(signedPsbtBase64, quote): Promise<BuyResult> {
    const { slug, ...rest } = quote.submitContext as { slug: string } & Record<string, unknown>;

    const res = await call<Record<string, unknown>>(
      `/collection/${encodeURIComponent(slug)}/purchases/submit`,
      { method: 'POST', json: { ...rest, signedPsbt: signedPsbtBase64 } },
    );

    const txid = s(pick(res, 'txid', 'settlementTxid')) ?? '';
    return { txid, source: 'ordnet', explorerUrl: `https://mempool.space/tx/${txid}` };
  },
};
