import { NextRequest, NextResponse } from 'next/server';
import { getAddressStats, getAddressUtxos } from '@/lib/chain';
import { classifyRanges, satHeight, satName } from '@/lib/sats';
import { config } from '@/lib/config';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Reject obvious garbage before spending an upstream call on it. */
const ADDRESS_RE = /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

/**
 * Address view, straight from the chain.
 *
 * Balance and UTXO set come from mempool.space (or your own node). Sat ranges
 * require an ordinals index, so when ORD_BASE points at an `ord` server we ask
 * it for each UTXO's ranges and classify them locally.
 */
const ORD_BASE = (process.env.ORD_BASE ?? '').trim();

export async function GET(req: NextRequest) {
  const limit = await rateLimit(
    clientIp(req),
    'light',
    config.rateLimit.light,
    config.rateLimit.windowMs,
  );
  if (!limit.ok) return tooManyRequests(limit);

  const address = req.nextUrl.searchParams.get('address')?.trim();
  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'not a valid Bitcoin address' }, { status: 400 });
  }

  try {
    const [stats, utxos] = await Promise.all([
      getAddressStats(address),
      getAddressUtxos(address),
    ]);

    const balanceSats =
      stats.chain_stats.funded_txo_sum -
      stats.chain_stats.spent_txo_sum +
      stats.mempool_stats.funded_txo_sum -
      stats.mempool_stats.spent_txo_sum;

    // Cardinal UTXOs (>1000 sats and not a known inscription envelope) are
    // spendable; small ones are very likely holding an ordinal.
    const enriched = await Promise.all(
      utxos.slice(0, 200).map(async (u) => {
        const base = {
          outpoint: `${u.txid}:${u.vout}`,
          valueSats: u.value,
          confirmed: u.status.confirmed,
          blockHeight: u.status.block_height,
          likelyInscribed: u.value <= 1000,
          rarity: undefined as string | undefined,
          sattributes: [] as string[],
          firstSat: undefined as number | undefined,
          firstSatName: undefined as string | undefined,
          firstSatBlock: undefined as number | undefined,
        };

        if (!ORD_BASE) return base;

        try {
          const res = await fetch(`${ORD_BASE}/output/${u.txid}:${u.vout}`, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: AbortSignal.timeout(4000),
          });
          if (!res.ok) return base;
          const data = (await res.json()) as { sat_ranges?: Array<[number, number]> };
          if (!data.sat_ranges?.length) return base;

          const ranges = data.sat_ranges.map(([start, end]) => ({ start, size: end - start }));
          const c = classifyRanges(ranges);
          const first = ranges[0].start;

          return {
            ...base,
            rarity: c.rarity,
            sattributes: c.sattributes,
            firstSat: first,
            firstSatName: satName(first),
            firstSatBlock: satHeight(first),
          };
        } catch {
          return base;
        }
      }),
    );

    return NextResponse.json({
      address,
      balanceSats,
      txCount: stats.chain_stats.tx_count + stats.mempool_stats.tx_count,
      utxoCount: utxos.length,
      utxos: enriched,
      ordIndexed: Boolean(ORD_BASE),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'lookup failed' },
      { status: 502 },
    );
  }
}
