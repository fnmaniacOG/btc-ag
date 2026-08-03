'use client';

import { useEffect, useState } from 'react';
import type { ChainStatus } from '@/lib/types';
import { commas, compact } from '@/lib/format';

/**
 * Live chain header. Fees are the number that decides whether a purchase is
 * worth making at all, so they sit at the top of the page permanently.
 */
export function ChainBar() {
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch('/api/chain');
        if (!res.ok) throw new Error('chain');
        const data = (await res.json()) as ChainStatus;
        if (alive) {
          setChain(data);
          setStale(false);
        }
      } catch {
        if (alive) setStale(true);
      }
    };

    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const feeTone = (v: number) =>
    v >= 100 ? 'text-red-400' : v >= 30 ? 'text-orange-300' : 'text-emerald-400';

  return (
    <div className="border-b border-ink-800 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-1.5 px-4 py-2 font-mono text-[11px] text-neutral-500">
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-red-500' : 'bg-emerald-500 animate-pulseline'}`}
          />
          <span className="uppercase tracking-wider">{stale ? 'chain offline' : 'chain live'}</span>
        </span>

        <span>
          block <span className="text-neutral-200">{chain ? commas(chain.height) : '—'}</span>
        </span>

        {chain && (
          <>
            <span className="hidden sm:inline">
              fees{' '}
              <span className={feeTone(chain.fees.fastest)}>{chain.fees.fastest}</span>
              <span className="text-neutral-700"> / </span>
              <span className={feeTone(chain.fees.halfHour)}>{chain.fees.halfHour}</span>
              <span className="text-neutral-700"> / </span>
              <span className={feeTone(chain.fees.hour)}>{chain.fees.hour}</span>
              <span className="text-neutral-600"> sat/vB</span>
            </span>

            <span className="hidden md:inline">
              mempool{' '}
              <span className="text-neutral-200">{compact(chain.mempool.count)}</span>
              <span className="text-neutral-600"> tx</span>
            </span>

            {chain.btcPrice ? (
              <span className="ml-auto text-orange-400">
                BTC ${commas(Math.round(chain.btcPrice))}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
