'use client';

/**
 * Bitcoin wallet connectors.
 *
 * Two families exist in practice:
 *  - injected providers (UniSat, OKX) with their own bespoke APIs
 *  - sats-connect providers (Xverse, Leather, Magic Eden) speaking a shared RPC
 *
 * Both are normalised to the same `WalletSession` so the buy flow doesn't care
 * which wallet the user brought.
 *
 * btc.ag never sees a private key. The wallet signs; we relay the signature.
 */

export type WalletId = 'unisat' | 'xverse' | 'leather' | 'magiceden' | 'okx';

export interface WalletSession {
  walletId: WalletId;
  walletName: string;
  /** Taproot address that receives the asset. */
  ordinalsAddress: string;
  ordinalsPublicKey?: string;
  /** Address that funds the purchase (often a separate segwit address). */
  paymentAddress: string;
  paymentPublicKey?: string;
}

export interface SignRequest {
  psbtBase64: string;
  signingIndexes: number[];
  sighashType?: number;
  session: WalletSession;
}

interface UnisatProvider {
  requestAccounts(): Promise<string[]>;
  getPublicKey(): Promise<string>;
  signPsbt(psbtHex: string, opts?: unknown): Promise<string>;
}

interface OkxProvider {
  connect(): Promise<{ address: string; publicKey: string; compressedPublicKey?: string }>;
  signPsbt(psbtHex: string, opts?: unknown): Promise<string>;
}

declare global {
  interface Window {
    unisat?: UnisatProvider;
    okxwallet?: { bitcoin?: OkxProvider };
  }
}

/**
 * Presence check for wallets whose globals sats-connect already types (Xverse,
 * Leather, Magic Eden). Re-declaring them on Window collides with those types,
 * so detection reads the key dynamically instead.
 */
function hasGlobal(key: string): boolean {
  return typeof window !== 'undefined' && (window as unknown as Record<string, unknown>)[key] != null;
}

export const WALLETS: Array<{ id: WalletId; name: string; check: () => boolean; install: string }> = [
  {
    id: 'unisat',
    name: 'UniSat',
    check: () => typeof window !== 'undefined' && !!window.unisat,
    install: 'https://unisat.io/download',
  },
  {
    id: 'xverse',
    name: 'Xverse',
    check: () => hasGlobal('XverseProviders'),
    install: 'https://www.xverse.app/download',
  },
  {
    id: 'leather',
    name: 'Leather',
    check: () => hasGlobal('LeatherProvider'),
    install: 'https://leather.io/install-extension',
  },
  {
    id: 'magiceden',
    name: 'Magic Eden',
    check: () => hasGlobal('magicEden'),
    install: 'https://wallet.magiceden.io',
  },
  {
    id: 'okx',
    name: 'OKX',
    check: () => typeof window !== 'undefined' && !!window.okxwallet?.bitcoin,
    install: 'https://www.okx.com/web3',
  },
];

/** base64 ⇄ hex, since injected wallets want hex and sats-connect wants base64. */
export function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let out = '';
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

export function hexToBase64(hex: string): string {
  const clean = hex.replace(/^0x/, '');
  let bin = '';
  for (let i = 0; i < clean.length; i += 2) bin += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return btoa(bin);
}

const isBase64Psbt = (v: string) => !/^[0-9a-fA-F]+$/.test(v);

async function connectUnisat(): Promise<WalletSession> {
  const p = window.unisat!;
  const accounts = await p.requestAccounts();
  if (!accounts?.length) throw new Error('UniSat returned no accounts');
  const pubkey = await p.getPublicKey().catch(() => undefined);

  // UniSat exposes a single address that serves both roles.
  return {
    walletId: 'unisat',
    walletName: 'UniSat',
    ordinalsAddress: accounts[0],
    ordinalsPublicKey: pubkey,
    paymentAddress: accounts[0],
    paymentPublicKey: pubkey,
  };
}

async function connectOkx(): Promise<WalletSession> {
  const p = window.okxwallet!.bitcoin!;
  const res = await p.connect();
  return {
    walletId: 'okx',
    walletName: 'OKX',
    ordinalsAddress: res.address,
    ordinalsPublicKey: res.compressedPublicKey ?? res.publicKey,
    paymentAddress: res.address,
    paymentPublicKey: res.compressedPublicKey ?? res.publicKey,
  };
}

/** Xverse / Leather / Magic Eden, via the sats-connect standard. */
async function connectSatsConnect(id: WalletId, name: string): Promise<WalletSession> {
  const { default: Wallet, request, AddressPurpose } = await import('sats-connect');
  void Wallet;

  const res = await request('getAccounts', {
    purposes: [AddressPurpose.Ordinals, AddressPurpose.Payment],
    message: 'btc.ag would like to see your Bitcoin addresses',
  });

  if (res.status !== 'success') throw new Error(`${name}: connection rejected`);

  const ordinals = res.result.find((a) => a.purpose === AddressPurpose.Ordinals);
  const payment = res.result.find((a) => a.purpose === AddressPurpose.Payment);
  if (!ordinals || !payment) throw new Error(`${name}: missing ordinals or payment address`);

  return {
    walletId: id,
    walletName: name,
    ordinalsAddress: ordinals.address,
    ordinalsPublicKey: ordinals.publicKey,
    paymentAddress: payment.address,
    paymentPublicKey: payment.publicKey,
  };
}

export async function connect(id: WalletId): Promise<WalletSession> {
  switch (id) {
    case 'unisat':
      if (!window.unisat) throw new Error('UniSat is not installed');
      return connectUnisat();
    case 'okx':
      if (!window.okxwallet?.bitcoin) throw new Error('OKX Wallet is not installed');
      return connectOkx();
    case 'xverse':
      return connectSatsConnect('xverse', 'Xverse');
    case 'leather':
      return connectSatsConnect('leather', 'Leather');
    case 'magiceden':
      return connectSatsConnect('magiceden', 'Magic Eden');
    default:
      throw new Error(`unknown wallet ${id}`);
  }
}

/**
 * Sign a purchase PSBT. Returns base64, which is what every venue's submit
 * endpoint expects.
 */
export async function signPsbt(req: SignRequest): Promise<string> {
  const { psbtBase64, signingIndexes, sighashType, session } = req;

  if (session.walletId === 'unisat' || session.walletId === 'okx') {
    const provider =
      session.walletId === 'unisat' ? window.unisat! : window.okxwallet!.bitcoin!;

    const hex = isBase64Psbt(psbtBase64) ? base64ToHex(psbtBase64) : psbtBase64;

    const signed = await provider.signPsbt(hex, {
      autoFinalized: false,
      toSignInputs: signingIndexes.map((index) => ({
        index,
        address: session.paymentAddress,
        ...(sighashType !== undefined ? { sighashTypes: [sighashType] } : {}),
      })),
    });

    return isBase64Psbt(signed) ? signed : hexToBase64(signed);
  }

  const { request } = await import('sats-connect');

  const res = await request('signPsbt', {
    psbt: psbtBase64,
    signInputs: { [session.paymentAddress]: signingIndexes },
    broadcast: false,
  });

  if (res.status !== 'success') throw new Error('Signing was rejected');
  return res.result.psbt;
}
