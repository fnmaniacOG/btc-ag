/**
 * Loads .env.local / .env into process.env for standalone scripts.
 *
 * Next.js does this automatically for the app, but scripts run through `tsx`
 * get a bare environment — so probe/dump/ordnet would silently see no API keys
 * and report every venue as unconfigured.
 *
 * Import this FIRST, before anything that reads config, since config.ts
 * snapshots process.env at module load.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Later files do not override earlier ones, or the shell environment. */
const FILES = ['.env.local', '.env.development.local', '.env'];

function parse(contents: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip matching surrounding quotes, keeping any inside the value.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }

    if (key) out[key] = value;
  }

  return out;
}

let loadedFrom: string[] = [];

for (const file of FILES) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;

  try {
    const vars = parse(readFileSync(path, 'utf8'));
    let applied = 0;
    for (const [k, v] of Object.entries(vars)) {
      // A real shell variable always wins over a file.
      if (process.env[k] === undefined) {
        process.env[k] = v;
        applied++;
      }
    }
    if (applied) loadedFrom.push(`${file} (${applied})`);
  } catch {
    // An unreadable env file should never stop a script from running.
  }
}

export const envSources = loadedFrom;

export function envSummary(): string {
  return loadedFrom.length ? `loaded ${loadedFrom.join(', ')}` : 'no .env file found';
}
