/**
 * ORD.NET session management.
 *
 * ORD.NET has no API keys. A wallet signs a BIP-322 challenge, the server
 * verifies it, and issues a bearer token that is valid for exactly **one hour**.
 * For a public site that must stay up unattended, a pasted-in token is not an
 * option — it dies within an hour of deploy.
 *
 * So btc.ag holds a dedicated signing key server-side and re-runs the auth flow
 * automatically before each token expires:
 *
 *   POST /auth/challenge  → one message per address (ordinals + payment)
 *   BIP-322 sign both     → hex-encoded simple signatures
 *   POST /auth/verify     → { sessionToken, expiresAt, walletBindings }
 *
 * ── SECURITY ────────────────────────────────────────────────────────────────
 * ORDNET_SIGNING_WIF is a hot private key sitting in your environment. Use a
 * wallet created *solely* for this purpose, holding a little over the 0.01 BTC
 * that ORD.NET requires and nothing else. Never reuse a wallet that holds
 * inscriptions, runes, or meaningful balance. The key signs auth challenges
 * only — btc.ag never builds a spend with it — but treat it as compromised-by-
 * default the way you would any credential in a deployed environment.
 *
 * Leaving ORDNET_SIGNING_WIF unset is fully supported: ORD.NET simply shows as
 * unconfigured and the other eight venues carry on.
 */

import { config } from './config';
import { request } from './http';
import { kvGet, kvLock, kvSet } from './kv';

/**
 * The Bitcoin crypto stack is loaded lazily and only once.
 *
 * Two reasons. First, `bip322-js` is CommonJS with named exports, and its
 * interop shape differs between the ESM and CJS transforms — resolving it at
 * runtime and accepting either shape avoids a whole class of build-dependent
 * breakage. Second, when ORD.NET is unconfigured (the common case) these
 * packages never load at all, which keeps serverless cold starts lean.
 */
type CryptoStack = {
  bitcoin: typeof import('bitcoinjs-lib');
  ECPair: ReturnType<typeof import('ecpair').default>;
  sign: (wif: string, address: string, message: string) => string;
};

let stackPromise: Promise<CryptoStack> | null = null;

function loadCrypto(): Promise<CryptoStack> {
  stackPromise ??= (async () => {
    const [bitcoin, ecpairMod, eccMod, bip322Mod] = await Promise.all([
      import('bitcoinjs-lib'),
      import('ecpair'),
      import('@bitcoinerlab/secp256k1'),
      import('bip322-js'),
    ]);

    const ecc = (eccMod as { default?: unknown }).default ?? eccMod;
    const ECPairFactory = (ecpairMod as { default?: unknown }).default ?? ecpairMod;

    // bip322-js exports { Signer } as a named export, but bundlers may nest it
    // under .default. Accept both rather than betting on one.
    const bip322 = bip322Mod as unknown as {
      Signer?: { sign: (k: string, a: string, m: string) => string };
      default?: { Signer?: { sign: (k: string, a: string, m: string) => string } };
    };
    const Signer = bip322.Signer ?? bip322.default?.Signer;
    if (!Signer?.sign) throw new Error('ordnet: could not load the BIP-322 signer');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bitcoin.initEccLib(ecc as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ECPair = (ECPairFactory as any)(ecc);

    return { bitcoin, ECPair, sign: (w, a, m) => Signer.sign(w, a, m) };
  })();

  return stackPromise;
}

const cfg = config.sources.ordnet;
const TOKEN_KEY = 'ordnet:session';
/** Refresh this far before the stated expiry, so no request races the cutoff. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

export interface OrdnetSession {
  token: string;
  expiresAt: number;
  walletBindingId?: string;
  ordinalsAddress: string;
  paymentAddress: string;
}

interface Challenge {
  authRequestId: string;
  challenges: Array<{
    challengeId: string;
    message: string;
    address: string;
    role: 'ordinals' | 'payment';
  }>;
}

interface VerifyResponse {
  sessionToken: string;
  expiresAt: string;
  walletBindings?: Array<{ walletBindingId: string; paymentAddress: string }>;
}

export interface DerivedWallet {
  wif: string;
  /** Taproot, receives inscriptions. */
  ordinalsAddress: string;
  ordinalsPublicKey: string;
  /** Native segwit — this is the address checked for the 0.01 BTC requirement. */
  paymentAddress: string;
  paymentPublicKey: string;
}

/**
 * Derive both addresses ORD.NET's auth flow expects from one WIF.
 *
 * Ordinals = P2TR (taproot, receives inscriptions).
 * Payment  = P2WPKH (native segwit) — this is the address ORD.NET checks for
 * the 0.01 BTC funding requirement.
 */
export async function deriveWallet(wif: string): Promise<DerivedWallet> {
  const { bitcoin, ECPair } = await loadCrypto();
  const network = bitcoin.networks.bitcoin;

  const keyPair = ECPair.fromWIF(wif, network);
  const pubkey = Buffer.from(keyPair.publicKey);

  const payment = bitcoin.payments.p2wpkh({ pubkey, network });
  const xOnly = pubkey.subarray(1, 33);
  const ordinals = bitcoin.payments.p2tr({ internalPubkey: xOnly, network });

  if (!payment.address || !ordinals.address) {
    throw new Error('ordnet: could not derive addresses from ORDNET_SIGNING_WIF');
  }

  return {
    wif,
    ordinalsAddress: ordinals.address,
    ordinalsPublicKey: xOnly.toString('hex'),
    paymentAddress: payment.address,
    paymentPublicKey: pubkey.toString('hex'),
  };
}

/** ORD.NET wants hex-encoded BIP-322 simple signatures; bip322-js emits base64. */
async function signHex(wif: string, address: string, message: string): Promise<string> {
  const { sign } = await loadCrypto();
  return Buffer.from(sign(wif, address, message), 'base64').toString('hex');
}

async function authenticate(wallet: DerivedWallet): Promise<OrdnetSession> {
  const challenge = await request<Challenge>(`${cfg.base}/auth/challenge`, {
    method: 'POST',
    json: {
      ordinalsAddress: wallet.ordinalsAddress,
      paymentAddress: wallet.paymentAddress,
    },
    headers: { 'content-type': 'application/json' },
    retries: 1,
    timeoutMs: 12_000,
  });

  if (!challenge?.challenges?.length) {
    throw new Error('ordnet: auth challenge returned no messages');
  }

  const verifications = await Promise.all(
    challenge.challenges.map(async (c) => ({
      challengeId: c.challengeId,
      address: c.address,
      signature: await signHex(wallet.wif, c.address, c.message),
    })),
  );

  const verified = await request<VerifyResponse>(`${cfg.base}/auth/verify`, {
    method: 'POST',
    json: { authRequestId: challenge.authRequestId, verifications },
    headers: { 'content-type': 'application/json' },
    // A 403 here means the funding requirement is unmet — retrying cannot fix
    // it and only burns the 5-per-address-per-minute auth budget.
    retries: 0,
    timeoutMs: 15_000,
  });

  if (!verified?.sessionToken) {
    throw new Error('ordnet: auth verify returned no session token');
  }

  const binding =
    verified.walletBindings?.find((b) => b.paymentAddress === wallet.paymentAddress) ??
    verified.walletBindings?.[0];

  return {
    token: verified.sessionToken,
    expiresAt: Date.parse(verified.expiresAt) || Date.now() + 55 * 60 * 1000,
    walletBindingId: binding?.walletBindingId,
    ordinalsAddress: wallet.ordinalsAddress,
    paymentAddress: wallet.paymentAddress,
  };
}

let memoSession: OrdnetSession | null = null;

/**
 * Current session, refreshed automatically.
 *
 * Returns null when ORD.NET is not configured, which the adapter reports as
 * "unconfigured" rather than as a failure.
 */
export async function getOrdnetSession(): Promise<OrdnetSession | null> {
  const fresh = (s: OrdnetSession | null) =>
    s && Date.now() < s.expiresAt - REFRESH_MARGIN_MS ? s : null;

  // A manually supplied token still works — useful for local testing, and it
  // skips the hot key entirely. It simply will not survive its first hour.
  if (!cfg.signingWif && cfg.token) {
    return {
      token: cfg.token,
      expiresAt: Date.now() + 55 * 60 * 1000,
      ordinalsAddress: '',
      paymentAddress: '',
    };
  }

  if (!cfg.signingWif) return null;

  const memo = fresh(memoSession);
  if (memo) return memo;

  const shared = fresh(await kvGet<OrdnetSession>(TOKEN_KEY));
  if (shared) {
    memoSession = shared;
    return shared;
  }

  // Only one instance should re-authenticate: ORD.NET allows just 5 auth
  // attempts per address per minute, and a stampede would lock everyone out.
  const gotLock = await kvLock('lock:ordnet:auth', 30_000);
  if (!gotLock) {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const s = fresh(await kvGet<OrdnetSession>(TOKEN_KEY));
      if (s) {
        memoSession = s;
        return s;
      }
    }
  }

  const wallet = await deriveWallet(cfg.signingWif);
  const session = await authenticate(wallet);

  memoSession = session;
  await kvSet(TOKEN_KEY, session, session.expiresAt - Date.now());
  return session;
}

/** Drop the cached session after a 401 so the next call re-authenticates. */
export async function invalidateOrdnetSession(): Promise<void> {
  memoSession = null;
  await kvSet(TOKEN_KEY, null, 1_000);
}

/**
 * Human-readable reason ORD.NET is unavailable, for the status rail.
 * ORD.NET's own error strings are good, so they are surfaced as-is.
 */
export function explainOrdnetError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('403')) {
    return 'signing wallet holds < 0.01 BTC confirmed (ORD.NET funding requirement)';
  }
  if (msg.includes('401')) return 'signature rejected — check ORDNET_SIGNING_WIF';
  if (msg.includes('429')) return 'rate limited by ORD.NET';
  if (msg.includes('503')) return 'ORD.NET funding check temporarily unavailable';
  return msg.slice(0, 120);
}
