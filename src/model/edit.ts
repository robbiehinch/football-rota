import type { Rota } from './types';

export interface CellRef {
  player: string;
  slot: number;
}

const positionOf = (slot: Record<string, string | null>, player: string) => Object.keys(slot).find((k) => slot[k] === player) ?? null;

/**
 * Swap two players in the given slots. If one of them is on the bench,
 * the other goes off and they come on in their place.
 */
export function swapCells(rota: Rota, a: CellRef, b: CellRef, slots: number[]): Rota {
  const next = rota.map((s) => ({ ...s }));
  if (a.player === b.player) return next;
  for (const s of slots) {
    const slot = next[s];
    const posA = positionOf(slot, a.player);
    const posB = positionOf(slot, b.player);
    if (posA) slot[posA] = b.player;
    if (posB) slot[posB] = a.player;
  }
  return next;
}

/**
 * Put a player in a position (or on the bench, code = null) for the given slots.
 * Whoever was in that position moves to the player's old spot, or the bench.
 */
export function placePlayer(rota: Rota, player: string, code: string | null, slots: number[]): Rota {
  const next = rota.map((s) => ({ ...s }));
  for (const s of slots) {
    const slot = next[s];
    const from = positionOf(slot, player);
    if (code === null) {
      if (from) slot[from] = null;
      continue;
    }
    const other = slot[code] ?? null;
    slot[code] = player;
    if (from && from !== code) slot[from] = other;
  }
  return next;
}
