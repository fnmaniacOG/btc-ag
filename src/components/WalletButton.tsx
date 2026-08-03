'use client';

import { useState } from 'react';
import { useWallet } from '@/wallet/useWallet';
import { WALLETS } from '@/wallet/providers';
import { shortId } from '@/lib/format';

export function WalletButton() {
  const { session, connect, disconnect, connecting, error, available } = useWallet();
  const [open, setOpen] = useState(false);

  if (session) {
    return (
      <div className="relative">
        <button className="btn-ghost" onClick={() => setOpen((v) => !v)}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="font-mono text-xs">{shortId(session.ordinalsAddress, 6, 5)}</span>
        </button>

        {open && (
          <div className="card absolute right-0 z-30 mt-2 w-72 p-3 text-xs shadow-glow">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-500">
              {session.walletName}
            </div>

            <div className="space-y-2 font-mono text-[11px]">
              <div>
                <div className="text-neutral-600">Ordinals</div>
                <div className="break-all text-neutral-300">{session.ordinalsAddress}</div>
              </div>
              <div>
                <div className="text-neutral-600">Payment</div>
                <div className="break-all text-neutral-300">{session.paymentAddress}</div>
              </div>
            </div>

            <button
              className="btn-ghost mt-3 w-full"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button className="btn-primary" onClick={() => setOpen((v) => !v)}>
        Connect wallet
      </button>

      {open && (
        <div className="card absolute right-0 z-30 mt-2 w-72 p-2 shadow-glow">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-neutral-500">
            Bitcoin wallets
          </div>

          {WALLETS.map((w) => {
            const detected = available.includes(w.id);
            return (
              <button
                key={w.id}
                disabled={!detected || connecting !== null}
                onClick={async () => {
                  await connect(w.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm
                           text-neutral-200 transition hover:bg-ink-800 disabled:opacity-40"
              >
                <span>{w.name}</span>
                {connecting === w.id ? (
                  <span className="text-[10px] text-orange-400">connecting…</span>
                ) : detected ? (
                  <span className="text-[10px] text-emerald-500">detected</span>
                ) : (
                  <a
                    href={w.install}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-neutral-600 hover:text-orange-400"
                    onClick={(e) => e.stopPropagation()}
                  >
                    install
                  </a>
                )}
              </button>
            );
          })}

          {error && <div className="px-2 py-1.5 text-[11px] text-red-400">{error}</div>}

          <p className="border-t border-ink-800 px-2 pt-2 text-[10px] leading-relaxed text-neutral-600">
            btc.ag never holds your keys. Purchase PSBTs are built by the origin
            marketplace and signed inside your wallet.
          </p>
        </div>
      )}
    </div>
  );
}
