import { NextRequest, NextResponse } from 'next/server';
import { getSource } from '@/lib/sources';
import { config } from '@/lib/config';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/ratelimit';
import type { BuyQuote, BuyerContext } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  quote: BuyQuote;
  buyer: BuyerContext;
  signedPsbtBase64: string;
}

/** Hand the wallet-signed PSBT back to the venue, which verifies and broadcasts. */
export async function POST(req: NextRequest) {
  const limit = await rateLimit(clientIp(req), 'buy', config.rateLimit.buy, config.rateLimit.windowMs);
  if (!limit.ok) return tooManyRequests(limit);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { quote, buyer, signedPsbtBase64 } = body ?? {};

  if (!quote?.source || !signedPsbtBase64) {
    return NextResponse.json({ error: 'quote and signedPsbtBase64 are required' }, { status: 400 });
  }
  if (quote.expiresAt && Date.now() > quote.expiresAt) {
    return NextResponse.json({ error: 'quote expired — re-quote and sign again' }, { status: 409 });
  }

  const source = getSource(quote.source);
  if (!source?.submitBuy) {
    return NextResponse.json({ error: `${quote.source} cannot submit purchases` }, { status: 501 });
  }

  try {
    const result = await source.submitBuy(signedPsbtBase64, quote, buyer);
    if (!result.txid) {
      return NextResponse.json(
        { error: 'venue accepted the PSBT but returned no txid', raw: result },
        { status: 502 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'submit failed', source: quote.source },
      { status: 502 },
    );
  }
}
