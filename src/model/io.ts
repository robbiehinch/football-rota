import { DEFAULT_POSITIONS, defaultMatch, slotCount, slugId } from './match';
import { emptyRota } from './stats';
import type { Constraint, MatchSettings, Player, Position, Rota, Settings } from './types';

/**
 * File format: the same shape as rota.json, with optional extra fields
 * (sub points, player flags, constraints) so a full setup can be shared.
 */
export interface RotaFile {
  description?: string;
  match?: {
    format?: string;
    age_group?: string;
    quarters?: number;
    quarter_length_min?: number;
    slot_length_min?: number;
    slots?: number;
    sub_points?: number[];
    gk_change_points?: number[];
  };
  positions?: Array<{ code: string; name: string; role: string; side?: string }>;
  squad?: Array<{
    id?: string;
    name: string;
    group?: string;
    available?: boolean;
    allowed_positions?: string[];
    gk_only?: boolean;
    side?: string;
  }>;
  rota?: Array<{
    slot?: number;
    quarter?: number;
    start_min?: number;
    end_min?: number;
    assignments: Record<string, string | null>;
    bench?: string[];
  }>;
  constraints?: Constraint[];
  summary_check?: unknown;
}

export interface Setup {
  settings: Settings;
  constraints: Constraint[];
  rota: Rota | null;
  /** Locked cells on the current rota ("slot|playerId"). */
  locks?: string[];
}

function guessSide(code: string): Position['side'] {
  const c = code.toUpperCase();
  if (c.startsWith('L')) return 'L';
  if (c.startsWith('R')) return 'R';
  return 'C';
}

function uniqueIds(players: Player[]): Player[] {
  const seen = new Set<string>();
  return players.map((p) => {
    let id = p.id;
    let i = 2;
    while (seen.has(id)) id = `${p.id}_${i++}`;
    seen.add(id);
    return { ...p, id };
  });
}

export function parseRotaFile(file: RotaFile): Setup {
  const positions: Position[] = file.positions?.length
    ? file.positions.map((q) => ({
        code: q.code,
        name: q.name,
        role: q.role,
        side: (['L', 'R', 'C'].includes(q.side ?? '') ? q.side : guessSide(q.code)) as Position['side'],
      }))
    : DEFAULT_POSITIONS;
  const outfield = positions.filter((q) => q.role !== 'GK').map((q) => q.code);

  const d = defaultMatch();
  const fm = file.match ?? {};
  const match: MatchSettings = {
    quarters: fm.quarters ?? d.quarters,
    quarter_length_min: fm.quarter_length_min ?? d.quarter_length_min,
    slot_length_min: fm.slot_length_min ?? d.slot_length_min,
    sub_points: [],
    gk_change_points: [],
  };
  const n = slotCount(match);
  const bounds = Array.from({ length: n - 1 }, (_, i) => (i + 1) * match.slot_length_min);
  const qBreaks = Array.from({ length: match.quarters - 1 }, (_, i) => (i + 1) * match.quarter_length_min);
  match.sub_points = fm.sub_points ?? bounds;
  match.gk_change_points = fm.gk_change_points ?? qBreaks;

  let squad: Player[] = uniqueIds(
    (file.squad ?? []).map((p) => ({
      id: p.id ?? slugId(p.name),
      name: p.name,
      group: p.group ?? '',
      available: p.available ?? true,
      allowed_positions: p.allowed_positions ?? outfield,
      gk_only: p.gk_only ?? false,
      ...(p.side === 'L' || p.side === 'R' ? { side: p.side } : {}),
    })),
  );

  let rota: Rota | null = null;
  if (file.rota?.length) {
    const idByName = new Map(squad.map((p) => [p.name, p.id]));
    const idSet = new Set(squad.map((p) => p.id));
    const toId = (v: string | null) => (v == null ? null : idSet.has(v) ? v : (idByName.get(v) ?? null));
    rota = emptyRota({ match, positions, squad });
    file.rota.forEach((row, i) => {
      const s = row.slot != null ? row.slot - 1 : i;
      if (s < 0 || s >= n) return;
      for (const q of positions) rota![s][q.code] = toId(row.assignments[q.code] ?? null);
    });
    // Without explicit flags, infer GK permissions from who played where.
    if (!file.squad?.some((p) => p.allowed_positions || p.gk_only != null)) squad = inferPositions(squad, rota, positions);
    // Without explicit sub points, open those used in the rota plus quarter breaks.
    if (!fm.sub_points) {
      const used = bounds.filter((b) => {
        const s = b / match.slot_length_min;
        return positions.some((q) => rota![s - 1][q.code] !== rota![s][q.code]);
      });
      match.sub_points = [...new Set([...used, ...qBreaks])].sort((a, b) => a - b);
    }
  }
  return migrateSetup({ settings: { match, positions, squad }, constraints: file.constraints ?? [], rota });
}

/**
 * Bring older setups up to date (idempotent):
 * - a "Goal time" rule with its own player list -> those players get the GK
 *   tick (others lose it, unless GK-only) and the list is cleared;
 * - side preferences stored on the "Preferred side" rule -> moved onto players.
 */
export function migrateSetup(setup: Setup): Setup {
  let squad = setup.settings.squad;
  const gk = setup.settings.positions.filter((q) => q.role === 'GK').map((q) => q.code);
  const constraints = setup.constraints.map((c) => {
    if (c.kind === 'gk_share' && c.players.length) {
      const listed = new Set(c.players);
      squad = squad.map((p) => {
        if (listed.has(p.id)) return { ...p, allowed_positions: [...new Set([...gk, ...p.allowed_positions])] };
        if (p.gk_only) return p;
        return { ...p, allowed_positions: p.allowed_positions.filter((code) => !gk.includes(code)) };
      });
      return { ...c, players: [] };
    }
    if (c.kind === 'side_pref' && c.sides) {
      const sides = c.sides;
      squad = squad.map((p) => (sides[p.id] ? { ...p, side: sides[p.id] } : p));
      const rest = { ...c };
      delete rest.sides;
      return rest;
    }
    return c;
  });
  return { ...setup, settings: { ...setup.settings, squad }, constraints };
}

/** Allow GK for anyone who kept goal; mark players who only ever kept goal as GK-only. */
function inferPositions(squad: Player[], rota: Rota, positions: Position[]): Player[] {
  const gk = positions.filter((q) => q.role === 'GK').map((q) => q.code);
  const outfield = positions.filter((q) => q.role !== 'GK').map((q) => q.code);
  return squad.map((p) => {
    const played = rota.flatMap((slot) => Object.entries(slot).filter(([, id]) => id === p.id).map(([c]) => c));
    const inGoal = played.some((c) => gk.includes(c));
    const outField = played.some((c) => !gk.includes(c));
    if (inGoal && !outField) return { ...p, allowed_positions: gk, gk_only: true };
    if (inGoal) return { ...p, allowed_positions: [...gk, ...outfield] };
    return { ...p, allowed_positions: outfield };
  });
}

export function toRotaFile(setup: Setup, description = 'Rota Builder setup'): RotaFile {
  const { settings, constraints, rota } = setup;
  const m = settings.match;
  const name = (id: string | null) => (id ? (settings.squad.find((p) => p.id === id)?.name ?? null) : null);
  const file: RotaFile = {
    description,
    match: {
      format: '5-a-side',
      quarters: m.quarters,
      quarter_length_min: m.quarter_length_min,
      slot_length_min: m.slot_length_min,
      slots: slotCount(m),
      sub_points: m.sub_points,
      gk_change_points: m.gk_change_points,
    },
    positions: settings.positions.map((q) => ({ ...q })),
    squad: settings.squad.map((p) => ({
      id: p.id,
      name: p.name,
      group: p.group,
      available: p.available,
      allowed_positions: p.allowed_positions,
      gk_only: !!p.gk_only,
      ...(p.side ? { side: p.side } : {}),
    })),
    constraints,
  };
  if (rota) {
    const perQuarter = m.quarter_length_min / m.slot_length_min;
    file.rota = rota.map((slot, s) => {
      const on = new Set(Object.values(slot).filter(Boolean));
      return {
        slot: s + 1,
        quarter: Math.floor(s / perQuarter) + 1,
        start_min: s * m.slot_length_min,
        end_min: (s + 1) * m.slot_length_min,
        assignments: Object.fromEntries(settings.positions.map((q) => [q.code, name(slot[q.code] ?? null)])),
        bench: settings.squad.filter((p) => p.available && !on.has(p.id)).map((p) => p.name),
      };
    });
  }
  return file;
}
