import { NextRequest, NextResponse } from 'next/server';
import { getSource } from '@/lib/sources';
import { getChainStatus } from '@/lib/chain';
import { config } from '@/lib/config';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/ratelimit';
import type { BuyerContext, UnifiedListing } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  listing: UnifiedListing;
  buyer: Omit<BuyerContext, 'feeRate'> & { feeRate?: number };
}

/**
 * Build the unsigned purchase PSBT at the origin venue.
 *
 * btc.ag never holds keys and never touches funds — it asks the marketplace
 * that escrows the listing for a PSBT, hands it to the user's wallet to sign,
 * and passes the signature back. The private key stays in the wallet.
 */
export async function POST(req: NextRequest) {
  // Quotes hit an upstream venue and reserve UTXOs, so this is the tightest
  // budget on the site.
  const limit = await rateLimit(clientIp(req), 'buy', config.rateLimit.buy, config.rateLimit.windowMs);
  if (!limit.ok) return tooManyRequests(limit);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { listing, buyer } = body ?? {};

  if (!listing?.source || !listing?.sourceListingId) {
    return NextResponse.json({ error: 'listing is required' }, { status: 400 });
  }
  if (!buyer?.ordinalsAddress || !buyer?.paymentAddress) {
    return NextResponse.json(
      { error: 'buyer.ordinalsAddress and buyer.paymentAddress are required' },
      { status: 400 },
    );
  }

  const source = getSource(listing.source);
  if (!source) {
    return NextResponse.json({ error: `unknown source ${listing.source}` }, { status: 400 });
  }
  if (!source.isConfigured()) {
    return NextResponse.json(
      { error: `${source.name} is not configured on this deployment`, note: source.configNote },
      { status: 503 },
    );
  }
  if (!source.quoteBuy) {
    return NextResponse.json(
      {
        error: `${source.name} does not expose a programmatic buy flow`,
        marketUrl: listing.marketUrl,
      },
      { status: 501 },
    );
  }

  // Default to the half-hour target: fast enough that the seller's escrow is
  // unlikely to be sniped, cheap enough not to overpay in a busy mempool.
  let feeRate = buyer.feeRate;
  if (!feeRate || feeRate < 1) {
    const chain = await getChainStatus().catch(() => null);
    feeRate = chain?.fees.halfHour || 5;
  }

  try {
    const quote = await source.quoteBuy(listing, { ...buyer, feeRate });
    return NextResponse.json(quote);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'quote failed', source: source.id },
      { status: 502 },
    );
  }
}
