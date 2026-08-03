/**
 * Live Bitcoin chain state, straight from a mempool.space instance.
 *
 * Point MEMPOOL_BASE at your own node's mempool instance and btc.ag runs with
 * no third-party dependency for chain data at all.
 */

import { config } from './config';
import { cached } from './cache';
import { request } from './http';
import type { ChainStatus } from './types';

interface FeeEstimate {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

interface MempoolInfo {
  count: number;
  vsize: number;
  total_fee: number;
}

interface PriceInfo {
  USD?: number;
}

export async function getChainStatus(): Promise<ChainStatus> {
  const { value } = await cached('chain:status', config.chainCacheTtlMs, async () => {
    const base = config.mempool.base;

    const [height, fees, mempool, price] = await Promise.allSettled([
      request<number>(`${base}/blocks/tip/height`, { retries: 1, timeoutMs: 6000 }),
      request<FeeEstimate>(`${base}/v1/fees/recommended`, { retries: 1, timeoutMs: 6000 }),
      request<MempoolInfo>(`${base}/mempool`, { retries: 1, timeoutMs: 6000 }),
      request<PriceInfo>(`${base}/v1/prices`, { retries: 1, timeoutMs: 6000 }),
    ]);

    const f = fees.status === 'fulfilled' ? fees.value : undefined;
    const m = mempool.status === 'fulfilled' ? mempool.value : undefined;

    const status: ChainStatus = {
      height: height.status === 'fulfilled' ? Number(height.value) : 0,
      fees: {
        fastest: f?.fastestFee ?? 0,
        halfHour: f?.halfHourFee ?? 0,
        hour: f?.hourFee ?? 0,
        economy: f?.economyFee ?? 0,
        minimum: f?.minimumFee ?? 1,
      },
      mempool: {
        count: m?.count ?? 0,
        vsize: m?.vsize ?? 0,
        totalFeeSats: m?.total_fee ?? 0,
      },
      btcPrice: price.status === 'fulfilled' ? price.value?.USD : undefined,
      fetchedAt: Date.now(),
    };

    return status;
  });

  return value;
}

/** Broadcast a raw signed transaction. Returns the txid. */
export async function broadcastTx(rawHex: string): Promise<string> {
  const txid = await request<string>(`${config.mempool.base}/tx`, {
    method: 'POST',
    body: rawHex,
    headers: { 'content-type': 'text/plain' },
    retries: 0,
    timeoutMs: 15_000,
  });
  return String(txid).trim();
}

/** UTXO set for an address — used by the portfolio view. */
export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

export async function getAddressUtxos(address: string): Promise<Utxo[]> {
  return request<Utxo[]>(`${config.mempool.base}/address/${encodeURIComponent(address)}/utxo`, {
    retries: 1,
  });
}

export interface AddressStats {
  address: string;
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
}

export async function getAddressStats(address: string): Promise<AddressStats> {
  return request<AddressStats>(`${config.mempool.base}/address/${encodeURIComponent(address)}`, {
    retries: 1,
  });
}

export const explorerTxUrl = (txid: string) => `https://mempool.space/tx/${txid}`;

/**
 * Rough vsize of a taproot purchase: buyer inputs + seller escrow input,
 * asset output, seller payout, marketplace fee, change.
 * Good enough for a fee preview; the venue returns the real number at submit.
 */
export function estimatePurchaseVsize(buyerInputs = 2): number {
  const base = 10.5;
  const taprootInput = 57.5;
  const output = 43;
  return Math.ceil(base + (buyerInputs + 1) * taprootInput + 4 * output);
}
