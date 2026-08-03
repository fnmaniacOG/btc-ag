import { NextRequest, NextResponse } from 'next/server';
import { aggregate } from '@/lib/aggregate';
import { getChainStatus } from '@/lib/chain';
import { getOrdnetSession } from '@/lib/ordnet-auth';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Cache warmer, driven by Vercel Cron (see vercel.json).
 *
 * Two jobs:
 *  1. Keep the popular views hot in shared Redis, so a visitor arriving on a
 *     cold cache gets an instant page instead of waiting on a nine-way fan-out.
 *  2. Refresh the ORD.NET session before its one-hour token expires, so that
 *     venue never goes dark between visits.
 *
 * Protected by CRON_SECRET. Vercel Cron sends it as a bearer token
 * automatically; anyone else gets a 401, because this route is the one
 * endpoint that deliberately bypasses the cache.
 */

const WARM: Array<{ label: string; query: Parameters<typeof aggregate>[0] }> = [
  { label: 'all', query: { assetType: 'all', sort: 'price_asc', limit: 120, depth: 60 } },
  { label: 'ordinals', query: { assetType: 'ordinal', sort: 'price_asc', limit: 120, depth: 60 } },
  { label: 'runes', query: { assetType: 'rune', sort: 'price_asc', limit: 120, depth: 60 } },
  { label: 'rare-sats', query: { assetType: 'rare-sat', sort: 'price_asc', limit: 120, depth: 60 } },
];

function authorized(req: NextRequest): boolean {
  if (!config.cronSecret) return false;
  const header = req.headers.get('authorization');
  return header === `Bearer ${config.cronSecret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { error: config.cronSecret ? 'unauthorized' : 'CRON_SECRET is not set' },
      { status: 401 },
    );
  }

  const started = Date.now();

  // Refresh the ORD.NET token first: if it is stale, every warmed view below
  // would be missing that venue's listings.
  let ordnet: string;
  try {
    const session = await getOrdnetSession();
    ordnet = session ? `ok (expires in ${Math.round((session.expiresAt - Date.now()) / 60_000)}m)` : 'not configured';
  } catch (err) {
    ordnet = err instanceof Error ? err.message : 'failed';
  }

  const chain = await getChainStatus()
    .then((c) => `block ${c.height}`)
    .catch(() => 'failed');

  const warmed = await Promise.all(
    WARM.map(async ({ label, query }) => {
      try {
        const r = await aggregate({ ...query, forceRefresh: true });
        return { view: label, listings: r.total, elapsedMs: r.elapsedMs, live: r.sources.filter((s) => s.ok).length };
      } catch (err) {
        return { view: label, error: err instanceof Error ? err.message : 'failed' };
      }
    }),
  );

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - started,
    ordnet,
    chain,
    warmed,
  });
}
