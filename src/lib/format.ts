export const SATS_PER_BTC = 100_000_000;

export function btc(sats: number, maxFrac = 8): string {
  const v = sats / SATS_PER_BTC;
  if (v === 0) return '0';
  if (v < 0.00001) return v.toFixed(8).replace(/0+$/, '');
  return v.toLocaleString('en-US', { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 });
}

export function usd(sats: number, btcPrice?: number): string | undefined {
  if (!btcPrice) return undefined;
  const v = (sats / SATS_PER_BTC) * btcPrice;
  if (v < 0.01) return '<$0.01';
  if (v < 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function compact(n: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

export function commas(n: number): string {
  return n.toLocaleString('en-US');
}

export function shortId(id: string, head = 6, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function ago(ts?: number): string {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.max(1, Math.floor(d / 1000))}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}
