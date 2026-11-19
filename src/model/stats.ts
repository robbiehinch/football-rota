import { roleOf, slotCount } from './match';
import type { Rota, Settings } from './types';

export interface PlayerStats {
  id: string;
  total: number;
  slots: number;
  byRole: Record<string, number>;
  byPosition: Record<string, number>;
  /** Number of separate spells on the pitch. */
  spells: number;
  /** Longest continuous spell on the bench, in minutes. */
  longestBench: number;
  /** Position code per slot, or null when on the bench. */
  timeline: (string | null)[];
}

/** Position code for each player in each slot. */
export function timelines(rota: Rota, settings: Settings): Record<string, (string | null)[]> {
  const n = rota.length;
  const out: Record<string, (string | null)[]> = {};
  for (const p of settings.squad) out[p.id] = Array(n).fill(null);
  rota.forEach((slot, s) => {
    for (const [code, pid] of Object.entries(slot)) {
      if (!pid) continue;
      if (!out[pid]) out[pid] = Array(n).fill(null);
      out[pid][s] = code;
    }
  });
  return out;
}

export function playerStats(rota: Rota, settings: Settings): Record<string, PlayerStats> {
  const len = settings.match.slot_length_min;
  const roles = [...new Set(settings.positions.map((p) => p.role))];
  const tl = timelines(rota, settings);
  const out: Record<string, PlayerStats> = {};
  for (const [id, line] of Object.entries(tl)) {
    const byRole: Record<string, number> = Object.fromEntries(roles.map((r) => [r, 0]));
    const byPosition: Record<string, number> = {};
    let spells = 0;
    let bench = 0;
    let longestBench = 0;
    let slots = 0;
    line.forEach((code, s) => {
      if (code) {
        slots++;
        byPosition[code] = (byPosition[code] ?? 0) + len;
        const r = roleOf(settings.positions, code);
        byRole[r] = (byRole[r] ?? 0) + len;
        if (s === 0 || !line[s - 1]) spells++;
        bench = 0;
      } else {
        bench += len;
        longestBench = Math.max(longestBench, bench);
      }
    });
    out[id] = { id, total: slots * len, slots, byRole, byPosition, spells, longestBench, timeline: line };
  }
  return out;
}

/** Group consecutive slots with identical line-ups ("By time" view). */
export function lineupWindows(rota: Rota, settings: Settings) {
  const m = settings.match;
  const n = Math.min(rota.length, slotCount(m));
  const same = (a: Record<string, string | null>, b: Record<string, string | null>) =>
    settings.positions.every((q) => (a[q.code] ?? null) === (b[q.code] ?? null));
  const out: { from: number; to: number; start: number; end: number; lineup: Record<string, string | null>; bench: string[] }[] = [];
  let from = 0;
  for (let s = 1; s <= n; s++) {
    if (s === n || !same(rota[s], rota[from])) {
      const lineup = rota[from];
      const on = new Set(Object.values(lineup).filter(Boolean));
      const bench = settings.squad.filter((p) => p.available && !on.has(p.id)).map((p) => p.id);
      out.push({ from, to: s, start: from * m.slot_length_min, end: s * m.slot_length_min, lineup, bench });
      from = s;
    }
  }
  return out;
}

export function emptyRota(settings: Settings): Rota {
  const n = slotCount(settings.match);
  return Array.from({ length: n }, () => Object.fromEntries(settings.positions.map((q) => [q.code, null])));
}
