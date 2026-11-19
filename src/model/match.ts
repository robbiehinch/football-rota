import type { MatchSettings, Player, Position, Settings, Weight } from './types';

export const DEFAULT_POSITIONS: Position[] = [
  { code: 'GK', name: 'Goalkeeper', role: 'GK', side: 'C' },
  { code: 'LD', name: 'Left defence', role: 'DEF', side: 'L' },
  { code: 'RD', name: 'Right defence', role: 'DEF', side: 'R' },
  { code: 'LA', name: 'Left attack', role: 'ATT', side: 'L' },
  { code: 'RA', name: 'Right attack', role: 'ATT', side: 'R' },
];

export const ROLE_NAMES: Record<string, string> = { GK: 'goal', DEF: 'defence', ATT: 'attack' };

export const WEIGHT_VALUE: Record<Weight, number> = { low: 1, medium: 3, high: 10 };

export function totalMinutes(m: MatchSettings): number {
  return m.quarters * m.quarter_length_min;
}

export function slotCount(m: MatchSettings): number {
  return Math.round(totalMinutes(m) / m.slot_length_min);
}

/** Minutes at the internal slot boundaries (5, 10, ... 35 for the default match). */
export function slotBoundaries(m: MatchSettings): number[] {
  const n = slotCount(m);
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) * m.slot_length_min);
}

export function quarterBreaks(m: MatchSettings): number[] {
  return Array.from({ length: m.quarters - 1 }, (_, i) => (i + 1) * m.quarter_length_min);
}

export function slotStart(m: MatchSettings, s: number): number {
  return s * m.slot_length_min;
}

export function slotLabel(m: MatchSettings, s: number): string {
  return `${slotStart(m, s)}-${slotStart(m, s + 1)}`;
}

export function defaultMatch(): MatchSettings {
  const m: MatchSettings = {
    quarters: 4,
    quarter_length_min: 10,
    slot_length_min: 5,
    sub_points: [],
    gk_change_points: [],
  };
  m.sub_points = slotBoundaries(m);
  m.gk_change_points = quarterBreaks(m);
  return m;
}

/** A run of slots with no open substitution point inside it. */
export interface Window {
  index: number;
  /** First slot (inclusive). */
  from: number;
  /** Last slot (exclusive). */
  to: number;
  start: number;
  end: number;
  minutes: number;
}

/** Split the match into windows at the given open boundaries (minutes). */
export function windowsFor(m: MatchSettings, open: number[]): Window[] {
  const n = slotCount(m);
  const openSet = new Set(open);
  const out: Window[] = [];
  let from = 0;
  for (let s = 1; s <= n; s++) {
    if (s === n || openSet.has(slotStart(m, s))) {
      out.push({
        index: out.length,
        from,
        to: s,
        start: slotStart(m, from),
        end: slotStart(m, s),
        minutes: (s - from) * m.slot_length_min,
      });
      from = s;
    }
  }
  return out;
}

export function allowedPositions(p: Player, positions: Position[]): string[] {
  const gk = positions.filter((q) => q.role === 'GK').map((q) => q.code);
  if (p.gk_only) return gk;
  return positions.map((q) => q.code).filter((c) => p.allowed_positions.includes(c));
}

export function canPlayGk(p: Player, positions: Position[]): boolean {
  return allowedPositions(p, positions).some((c) => positions.find((q) => q.code === c)?.role === 'GK');
}

export function isOutfielder(p: Player, positions: Position[]): boolean {
  return allowedPositions(p, positions).some((c) => positions.find((q) => q.code === c)?.role !== 'GK');
}

export function availablePlayers(settings: Settings): Player[] {
  return settings.squad.filter((p) => p.available);
}

export function playerName(settings: Settings, id: string): string {
  return settings.squad.find((p) => p.id === id)?.name ?? '(removed player)';
}

export function roleOf(positions: Position[], code: string): string {
  return positions.find((q) => q.code === code)?.role ?? '?';
}

export function gkCodes(positions: Position[]): string[] {
  return positions.filter((q) => q.role === 'GK').map((q) => q.code);
}

export function outfieldRoles(positions: Position[]): string[] {
  return [...new Set(positions.filter((q) => q.role !== 'GK').map((q) => q.role))];
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function slugId(name: string): string {
  return 'p_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function formatMinuteList(xs: number[]): string {
  return [...xs].sort((a, b) => a - b).join('/');
}
