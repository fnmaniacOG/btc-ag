'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BuyQuote, BuyResult, ChainStatus, UnifiedListing } from '@/lib/types';
import { btc, commas, usd } from '@/lib/format';
import { useWallet } from '@/wallet/useWallet';
import { signPsbt } from '@/wallet/providers';

type Stage = 'review' | 'quoting' | 'signing' | 'submitting' | 'done' | 'error';

/**
 * The purchase flow: quote → wallet signature → submit.
 *
 * Nothing here ever sees a private key. The origin marketplace builds the PSBT,
 * the user's wallet signs the inputs it owns, and the signed PSBT goes straight
 * back to that marketplace to be verified and broadcast.
 */
export function BuyModal({
  listing,
  chain,
  onClose,
}: {
  listing: UnifiedListing | null;
  chain: ChainStatus | null;
  onClose: () => void;
}) {
  const { session } = useWallet();
  const [stage, setStage] = useState<Stage>('review');
  const [quote, setQuote] = useState<BuyQuote | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feeRate, setFeeRate] = useState<number>(0);

  useEffect(() => {
    if (listing) {
      setStage('review');
      setQuote(null);
      setResult(null);
      setError(null);
      setFeeRate(chain?.fees.halfHour ?? 5);
    }
  }, [listing, chain]);

  const run = useCallback(async () => {
    if (!listing || !session) return;

    const buyer = {
      ordinalsAddress: session.ordinalsAddress,
      ordinalsPublicKey: session.ordinalsPublicKey,
      paymentAddress: session.paymentAddress,
      paymentPublicKey: session.paymentPublicKey,
      feeRate,
    };

    try {
      setStage('quoting');
      setError(null);

      const qres = await fetch('/api/buy/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ listing, buyer }),
      });
      const qdata = await qres.json();
      if (!qres.ok) throw new Error(qdata.error ?? 'Could not build the purchase');

      const q = qdata as BuyQuote;
      setQuote(q);

      setStage('signing');
      const signed = await signPsbt({
        psbtBase64: q.psbtBase64,
        signingIndexes: q.signingIndexes,
        sighashType: q.sighashType,
        session,
      });

      setStage('submitting');
      const sres = await fetch('/api/buy/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quote: q, buyer, signedPsbtBase64: signed }),
      });
      const sdata = await sres.json();
      if (!sres.ok) throw new Error(sdata.error ?? 'Broadcast failed');

      setResult(sdata as BuyResult);
      setStage('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purchase failed');
      setStage('error');
    }
  }, [listing, session, feeRate]);

  if (!listing) return null;

  const busy = stage === 'quoting' || stage === 'signing' || stage === 'submitting';
  const stageLabel: Record<Stage, string> = {
    review: '',
    quoting: 'Asking the venue for a purchase PSBT…',
    signing: 'Waiting for your wallet signature…',
    submitting: 'Broadcasting to the Bitcoin network…',
    done: '',
    error: '',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="card w-full max-w-md p-5 shadow-glow">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-neutral-100">{listing.title}</h2>
            <p className="text-[11px] text-neutral-500">
              on {listing.sourceName}
              {listing.crossListed && ` · cheapest of ${(listing.alsoOn?.length ?? 0) + 1} venues`}
            </p>
          </div>
          {!busy && (
            <button className="text-neutral-600 hover:text-orange-400" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {stage === 'done' && result ? (
          <div className="space-y-3 text-center">
            <div className="text-3xl">✓</div>
            <p className="text-sm text-neutral-200">Broadcast to the network.</p>
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="block break-all font-mono text-[11px] text-orange-400 hover:underline"
            >
              {result.txid}
            </a>
            <p className="text-[11px] text-neutral-600">
              Confirmation takes one block. The asset lands in your ordinals address.
            </p>
            <button className="btn-ghost w-full" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <dl className="space-y-2 border-y border-ink-800 py-3 font-mono text-xs">
              <Row label="Ask" value={`${btc(listing.priceSats)} BTC`} accent />
              {quote && (
                <>
                  <Row label="Venue fee" value={`${commas(quote.marketplaceFeeSats)} sats`} />
                  <Row label="Miner fee" value={`${commas(quote.networkFeeSats)} sats`} />
                  <Row
                    label="Total"
                    value={`${btc(quote.totalSats)} BTC`}
                    accent
                    sub={usd(quote.totalSats, chain?.btcPrice)}
                  />
                </>
              )}
              {!quote && chain?.btcPrice && (
                <Row label="≈" value={usd(listing.priceSats, chain.btcPrice) ?? ''} />
              )}
            </dl>

            {stage === 'review' && (
              <div className="mt-3">
                <label className="label">Fee rate — {feeRate} sat/vB</label>
                <input
                  type="range"
                  min={1}
                  max={Math.max(60, (chain?.fees.fastest ?? 20) * 2)}
                  value={feeRate}
                  onChange={(e) => setFeeRate(Number(e.target.value))}
                  className="w-full accent-orange-500"
                />
                {chain && (
                  <div className="mt-1 flex gap-2 text-[10px] text-neutral-600">
                    <button className="hover:text-orange-400" onClick={() => setFeeRate(chain.fees.economy)}>
                      economy {chain.fees.economy}
                    </button>
                    <button className="hover:text-orange-400" onClick={() => setFeeRate(chain.fees.halfHour)}>
                      normal {chain.fees.halfHour}
                    </button>
                    <button className="hover:text-orange-400" onClick={() => setFeeRate(chain.fees.fastest)}>
                      fast {chain.fees.fastest}
                    </button>
                  </div>
                )}
              </div>
            )}

            {busy && (
              <p className="mt-3 text-center text-xs text-orange-400">{stageLabel[stage]}</p>
            )}

            {error && (
              <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 p-2.5 text-[11px] text-red-300">
                {error}
                <a
                  href={listing.marketUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-orange-400 hover:underline"
                >
                  Open on {listing.sourceName} instead ↗
                </a>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button className="btn-ghost flex-1" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                disabled={busy || !session}
                onClick={run}
              >
                {!session ? 'Connect a wallet' : stage === 'error' ? 'Retry' : 'Buy'}
              </button>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-neutral-600">
              btc.ag routes this purchase to {listing.sourceName}, which builds and
              verifies the PSBT. Your keys never leave your wallet, and btc.ag never
              custodies the asset or the funds.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent?: boolean;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-neutral-600">{label}</dt>
      <dd className={accent ? 'font-semibold text-orange-400' : 'text-neutral-300'}>
        {value}
        {sub && <span className="ml-2 text-[10px] text-neutral-600">{sub}</span>}
      </dd>
    </div>
  );
}
