import type { MarketSource, SourceId } from '../types';

import { unisat } from './unisat';
import { magisat } from './magisat';
import { satflow } from './satflow';
import { gamma } from './gamma';
import { ordinalswallet } from './ordinalswallet';
import { ordnet } from './ordnet';
import { odin } from './odin';
import { wecsats } from './wecsats';
import { nexus } from './nexus';

/** Every venue btc.ag aggregates. Order here is the order in the status rail. */
export const SOURCES: MarketSource[] = [
  unisat,
  magisat,
  satflow,
  gamma,
  ordinalswallet,
  ordnet,
  odin,
  wecsats,
  nexus,
];

export const SOURCE_MAP: Record<SourceId, MarketSource> = Object.fromEntries(
  SOURCES.map((s) => [s.id, s]),
) as Record<SourceId, MarketSource>;

export function getSource(id: SourceId): MarketSource | undefined {
  return SOURCE_MAP[id];
}
