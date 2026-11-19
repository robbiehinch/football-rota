import type { Pin, Rota, Settings } from './types';

/** A locked cell: this player stays exactly as they are in this slot (in a position, or on the bench). */
export const lockKey = (slot: number, player: string) => `${slot}|${player}`;

export function parseLockKey(key: string): { slot: number; player: string } {
  const i = key.indexOf('|');
  return { slot: Number(key.slice(0, i)), player: key.slice(i + 1) };
}

export const isLockPin = (id: string) => id.startsWith('lock:');

/**
 * Turn locked cells into hard pins on the current rota. Consecutive locked
 * slots where the player stays in the same spot become a single pin.
 */
export function lockPins(rota: Rota, locks: string[], settings: Settings): Pin[] {
  const len = settings.match.slot_length_min;
  const byPlayer = new Map<string, number[]>();
  for (const key of locks) {
    const { slot, player } = parseLockKey(key);
    if (slot < 0 || slot >= rota.length || !settings.squad.some((p) => p.id === player)) continue;
    byPlayer.set(player, [...(byPlayer.get(player) ?? []), slot]);
  }
  const where = (slot: number, player: string) => Object.keys(rota[slot]).find((k) => rota[slot][k] === player) ?? 'BENCH';
  const pins: Pin[] = [];
  for (const [player, slots] of byPlayer) {
    const sorted = [...new Set(slots)].sort((a, b) => a - b);
    let start = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const runEnds = i === sorted.length || sorted[i] !== sorted[i - 1] + 1 || where(sorted[i], player) !== where(sorted[start], player);
      if (!runEnds) continue;
      const from = sorted[start];
      const to = sorted[i - 1];
      pins.push({
        id: `lock:${player}:${from}`,
        kind: 'pin',
        enabled: true,
        mode: 'hard',
        weight: 'high',
        player,
        position: where(from, player),
        from: from * len,
        to: (to + 1) * len,
      });
      start = i;
    }
  }
  return pins;
}

/** Number of cells (slot x position) that differ between two rotas. */
export function cellsChanged(a: Rota, b: Rota): number {
  let n = 0;
  a.forEach((slot, s) => {
    for (const k of Object.keys(slot)) if ((slot[k] ?? null) !== (b[s]?.[k] ?? null)) n++;
  });
  return n;
}
