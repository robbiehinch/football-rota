import type { Rota, Settings } from './types';

export interface SubEvent {
  /** Minute of the change. */
  minute: number;
  /** True when the change is inside a quarter rather than at a quarter break. */
  midQuarter: boolean;
  /** The quarter the change happens in (or starts, at a break), 1-based. */
  quarter: number;
  /** A player coming on in place of one going off. */
  swaps: { on: string; off: string; position: string }[];
  /** Coming on with no one paired going off (rare: only if numbers differ). */
  on: { player: string; position: string }[];
  /** Going off with no one paired coming on. */
  off: string[];
  /** Staying on the pitch but changing position. */
  moves: { player: string; from: string; to: string }[];
}

const where = (slot: Record<string, string | null>) => {
  const m = new Map<string, string>();
  for (const [code, id] of Object.entries(slot)) if (id) m.set(id, code);
  return m;
};

/** Every change between consecutive slots: who comes on, who goes off, who moves. */
export function substitutions(rota: Rota, settings: Settings): SubEvent[] {
  const m = settings.match;
  const len = m.slot_length_min;
  const codes = settings.positions.map((q) => q.code);
  const events: SubEvent[] = [];
  for (let s = 1; s < rota.length; s++) {
    const prev = where(rota[s - 1]);
    const next = where(rota[s]);
    const comers = [...next].filter(([id]) => !prev.has(id)).map(([player, position]) => ({ player, position }));
    const goers = [...prev.keys()].filter((id) => !next.has(id));
    const moves = [...next]
      .filter(([id, code]) => prev.has(id) && prev.get(id) !== code)
      .map(([player, to]) => ({ player, from: prev.get(player)!, to }));
    if (!comers.length && !goers.length && !moves.length) continue;
    // Pair each newcomer with the player they effectively replace: follow the chain
    // "X takes the spot of Y, who moved into the spot of Z, ..." until it reaches
    // someone who went off.
    const swaps: SubEvent['swaps'] = [];
    const freeGoers = new Set(goers);
    const unpaired: typeof comers = [];
    for (const c of comers) {
      let occupant = rota[s - 1][c.position] ?? null;
      const seen = new Set<string>();
      while (occupant && next.has(occupant) && !seen.has(occupant)) {
        seen.add(occupant);
        occupant = rota[s - 1][next.get(occupant)!] ?? null;
      }
      if (occupant && freeGoers.has(occupant)) {
        swaps.push({ on: c.player, off: occupant, position: c.position });
        freeGoers.delete(occupant);
      } else unpaired.push(c);
    }
    const restGoers = goers.filter((g) => freeGoers.has(g));
    const on: SubEvent['on'] = [];
    unpaired.forEach((c, i) => {
      if (restGoers[i]) swaps.push({ on: c.player, off: restGoers[i], position: c.position });
      else on.push(c);
    });
    const order = (code: string) => codes.indexOf(code);
    swaps.sort((a, b) => order(a.position) - order(b.position));
    moves.sort((a, b) => order(a.from) - order(b.from));
    const minute = s * len;
    events.push({
      minute,
      midQuarter: minute % m.quarter_length_min !== 0,
      quarter: Math.floor(minute / m.quarter_length_min) + 1,
      swaps,
      on,
      off: restGoers.slice(unpaired.length),
      moves,
    });
  }
  return events;
}

/** Plain-text pieces for one event, e.g. "Albie on for Joseph (RD)", "Alex RD → LD". */
export function describeSub(e: SubEvent, name: (id: string) => string): string[] {
  return [
    ...e.swaps.map((x) => `${name(x.on)} on for ${name(x.off)} (${x.position})`),
    ...e.on.map((x) => `${name(x.player)} on (${x.position})`),
    ...e.off.map((id) => `${name(id)} off`),
    ...e.moves.map((x) => `${name(x.player)} ${x.from} → ${x.to}`),
  ];
}
