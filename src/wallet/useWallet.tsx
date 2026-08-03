'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { WALLETS, connect as connectWallet, type WalletId, type WalletSession } from './providers';

interface WalletCtx {
  session: WalletSession | null;
  connecting: WalletId | null;
  error: string | null;
  available: WalletId[];
  connect: (id: WalletId) => Promise<void>;
  disconnect: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);

const STORAGE_KEY = 'btcag.wallet';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [connecting, setConnecting] = useState<WalletId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<WalletId[]>([]);

  useEffect(() => {
    // Extensions inject asynchronously; poll briefly on mount.
    const scan = () => setAvailable(WALLETS.filter((w) => w.check()).map((w) => w.id));
    scan();
    const t = setInterval(scan, 600);
    setTimeout(() => clearInterval(t), 4000);

    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setSession(JSON.parse(saved) as WalletSession);
    } catch {
      /* no saved session */
    }

    return () => clearInterval(t);
  }, []);

  const connect = useCallback(async (id: WalletId) => {
    setConnecting(id);
    setError(null);
    try {
      const s = await connectWallet(id);
      setSession(s);
      // Session storage only: the connection dies with the tab, which is the
      // right default for anything touching money.
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } catch {
        /* private mode */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setConnecting(null);
    }
  }, []);

  const disconnect = useCallback(() => {
    setSession(null);
    setError(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ session, connecting, error, available, connect, disconnect }),
    [session, connecting, error, available, connect, disconnect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
