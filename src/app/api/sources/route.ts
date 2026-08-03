import { NextResponse } from 'next/server';
import { SOURCES } from '@/lib/sources';
import { kvEnabled, kvPing } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Public status endpoint. Doubles as the container/uptime health check.
 *
 * Deliberately reveals no secrets — only whether each venue is configured, and
 * the operator-facing note about what is missing.
 */
export async function GET() {
  const redis = kvEnabled() ? await kvPing() : false;

  return NextResponse.json(
    {
      ok: true,
      sources: SOURCES.map((s) => ({
        source: s.id,
        name: s.name,
        url: s.url,
        assetTypes: s.assetTypes,
        configured: s.isConfigured(),
        canBuy: typeof s.quoteBuy === 'function',
        note: s.isConfigured() ? undefined : s.configNote,
      })),
      cache: {
        shared: kvEnabled(),
        reachable: redis,
        // Loud, because running a public aggregator without a shared cache
        // means marketplace quota burn scales with visitors.
        warning: kvEnabled()
          ? undefined
          : 'No shared cache configured. Set UPSTASH_REDIS_REST_URL/TOKEN before serving real traffic.',
      },
    },
    { headers: { 'cache-control': 'public, s-maxage=30' } },
  );
}
