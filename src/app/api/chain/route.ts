import { NextRequest, NextResponse } from 'next/server';
import { getChainStatus } from '@/lib/chain';
import { config } from '@/lib/config';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const limit = await rateLimit(
    clientIp(req),
    'light',
    config.rateLimit.light,
    config.rateLimit.windowMs,
  );
  if (!limit.ok) return tooManyRequests(limit);

  try {
    const status = await getChainStatus();
    return NextResponse.json(status, {
      headers: { 'cache-control': 'public, s-maxage=10, stale-while-revalidate=30' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'chain unavailable' },
      { status: 502 },
    );
  }
}
