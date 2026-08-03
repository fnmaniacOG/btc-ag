/**
 * Satflow — pro-trader venue for ordinals, runes and rare sats.
 *
 * Docs: https://docs.satflow.com/reference/overview
 * Base https://api.satflow.com/v1, auth via the x-api-key header.
 *
 * `GET /activity/listings?active=true&external=true` is the widest read: with
 * `external` on, Satflow also surfaces listings it has indexed from other
 * venues, which materially deepens coverage.
 */

import { config } from '../config';
import { request } from '../http';
import type { BuyQuote, BuyResult, ListingQuery, MarketSource, UnifiedListing } from '../types';
import { asArray, depthOf, makeListing, n, pick, s, ts, wants } from './base';

const cfg = config.sources.satflow;

function headers(): Record<string, string> {
  return { 'x-api-key': cfg.apiKey, 'content-type': 'application/json' };
}

function sortParam(q: ListingQuery): { sortBy: string; sortDirection: string } {
  switch (q.sort) {
    case 'price_desc':
      return { sortBy: 'price', sortDirection: 'desc' };
    case 'recent':
      return { sortBy: 'createdAt', sortDirection: 'desc' };
    case 'unit_price_asc':
      return { sortBy: 'unitPrice', sortDirection: 'asc' };
    default:
      return { sortBy: 'price', sortDirection: 'asc' };
  }
}

export const satflow: MarketSource = {
  id: 'satflow',
  name: 'Satflow',
  url: 'https://www.satflow.com',
  assetTypes: ['ordinal', 'rune', 'rare-sat'],
  configNote: 'Set SATFLOW_API_KEY (request one in the Satflow Discord).',

  isConfigured: () => cfg.enabled && Boolean(cfg.apiKey),

  async fetchListings(q) {
    const limit = depthOf(q);
    const { sortBy, sortDirection } = sortParam(q);

    const params = new URLSearchParams({
      active: 'true',
      // Pull in listings Satflow has indexed from other marketplaces too.
      external: 'true',
      page: '1',
      pageSize: String(Math.min(100, limit)),
      sortBy,
      sortDirection,
    });
    if (q.collectionSlug) params.set('collectionSlug', q.collectionSlug);

    const res = await request<unknown>(`${cfg.base}/activity/listings?${params}`, {
      headers: headers(),
    });

    const items = asArray(res);

    return items
      .map((r) => {
        const o = r as Record<string, unknown>;
        const inscriptionId = s(pick(o, 'inscriptionId', 'inscription_id'));
        const priceSats = n(pick(o, 'price', 'priceSats', 'listedPrice'));
        if (!priceSats) return null;

        const runeName = s(pick(o, 'rune', 'runeName', 'ticker'));
        const collectionSlug = s(pick(o, 'collectionSlug', 'collection'));
        const id = s(pick(o, '_id', 'id', 'orderId')) ?? inscriptionId ?? `${priceSats}`;

        // Satflow tags rare-sat listings with a satributes array.
        const satributes = pick(o, 'satributes', 'sattributes', 'satAttributes');
        const isRareSat = Array.isArray(satributes) && satributes.length > 0 && !inscriptionId;

        const assetType = runeName && !inscriptionId ? 'rune' : isRareSat ? 'rare-sat' : 'ordinal';

        if (!wants([assetType], q)) return null;

        const amount = n(pick(o, 'amount', 'runeAmount', 'quantity')) || undefined;

        return makeListing({
          source: 'satflow',
          sourceName: 'Satflow',
          sourceListingId: id,
          assetType,
          title:
            s(pick(o, 'name', 'itemName')) ??
            runeName ??
            s(pick(o, 'collectionName')) ??
            'Satflow listing',
          subtitle: s(pick(o, 'collectionName')),
          inscriptionId,
          inscriptionNumber:
            pick(o, 'inscriptionNumber') !== undefined ? n(pick(o, 'inscriptionNumber')) : undefined,
          runeName,
          ticker: s(pick(o, 'ticker', 'symbol')),
          amount,
          unitPriceSats: n(pick(o, 'unitPrice')) || undefined,
          priceSats,
          vendorRarity: pick(o, 'rarity'),
          utxoSizeSats: n(pick(o, 'outputValue', 'utxoValue')) || undefined,
          outpoint: s(pick(o, 'outpoint', 'utxo')),
          sellerAddress: s(pick(o, 'sellerAddress', 'maker', 'owner')),
          collectionSlug,
          collectionName: s(pick(o, 'collectionName')),
          imageUrl: s(pick(o, 'imageUrl', 'image', 'previewUrl')),
          listedAt: ts(pick(o, 'createdAt', 'timestamp', 'listedAt')),
          marketUrl: inscriptionId
            ? `https://www.satflow.com/item/${inscriptionId}`
            : collectionSlug
              ? `https://www.satflow.com/collection/${collectionSlug}`
              : 'https://www.satflow.com',
          buyable: true,
          raw: o,
        });
      })
      .filter((x): x is UnifiedListing => x !== null);
  },

  async quoteBuy(listing, buyer): Promise<BuyQuote> {
    const res = await request<Record<string, unknown>>(`${cfg.base}/intent/satflow-purchase`, {
      method: 'POST',
      headers: headers(),
      json: {
        inscriptionId: listing.inscriptionId,
        orderId: listing.sourceListingId,
        buyerPaymentAddress: buyer.paymentAddress,
        buyerPaymentPublicKey: buyer.paymentPublicKey,
        buyerOrdinalAddress: buyer.ordinalsAddress,
        buyerOrdinalPublicKey: buyer.ordinalsPublicKey,
        feeRate: buyer.feeRate,
      },
    });

    const psbt = s(pick(res, 'psbt', 'psbtBase64', 'unsignedPsbt'));
    if (!psbt) throw new Error('satflow: no PSBT returned');

    const networkFeeSats = n(pick(res, 'minerFee', 'networkFee'));
    const marketplaceFeeSats = n(pick(res, 'marketplaceFee', 'platformFee'));

    return {
      listingId: listing.id,
      source: 'satflow',
      priceSats: listing.priceSats,
      marketplaceFeeSats,
      networkFeeSats,
      totalSats: listing.priceSats + marketplaceFeeSats + networkFeeSats,
      feeRate: buyer.feeRate,
      psbtBase64: psbt,
      signingIndexes: (pick(res, 'inputsToSign', 'signingIndexes') as number[]) ?? [],
      submitContext: {
        orderId: listing.sourceListingId,
        inscriptionId: listing.inscriptionId,
        secure: Boolean(pick(res, 'secure')),
      },
    };
  },

  async submitBuy(signedPsbtBase64, quote): Promise<BuyResult> {
    const res = await request<Record<string, unknown>>(`${cfg.base}/purchase/broadcast`, {
      method: 'POST',
      headers: headers(),
      json: {
        signedPsbt: signedPsbtBase64,
        orderId: quote.submitContext.orderId,
        inscriptionId: quote.submitContext.inscriptionId,
      },
    });
    const txid = s(pick(res, 'txid', 'txId', 'transactionId')) ?? '';
    return { txid, source: 'satflow', explorerUrl: `https://mempool.space/tx/${txid}` };
  },
};
