import { canPlayGk, formatMinuteList, isOutfielder, playerName, uid } from './match';
import type { Constraint, ConstraintKind, MatchSettings, Settings, Weight } from './types';

export const KIND_LABELS: Record<ConstraintKind, string> = {
  even_time: 'Even playing time',
  minutes: 'Minimum / maximum minutes',
  role_balance: 'Role balance',
  gk_share: 'Goal time',
  role_blocks: 'Role blocks',
  position_stability: 'Position stability',
  max_bench: 'Max time on the bench',
  start_finish: 'Play in both halves',
  together: 'Always together',
  apart: 'Keep apart',
  group_mix: 'Group mix',
  pin: 'Pin',
  gk_plan: 'Goalkeeper plan',
  spells: 'Times on the pitch',
  max_on: 'Max time on in a row',
  rotate: 'Rotate positions',
  side_pref: 'Preferred side',
  min_subs: 'Substitutions',
  together_time: 'Time together',
};

export const KIND_HELP: Record<ConstraintKind, string> = {
  even_time: 'Total minutes for each player differ by at most N minutes.',
  minutes: 'Everyone (or chosen players) plays at least / at most this many minutes.',
  role_balance: 'Each outfield player gets at least X minutes in defence and in attack.',
  gk_share: 'How goal time is shared among the players ticked “GK” on the Squad tab: a minimum each, and/or roughly equal.',
  role_blocks: 'Outfield players keep the same role (defence or attack) for a whole quarter.',
  position_stability: 'Keep position changes during a spell on the pitch to a minimum.',
  max_bench: 'Nobody sits out more than N minutes in a row.',
  start_finish: 'Everyone plays at least once in the first half and once in the second.',
  together: 'Two players are always on and off at the same time (strict). For “some time together”, use Time together.',
  apart: 'Two players are never on the pitch at the same time.',
  group_mix: 'At least / at most N players from a group on the pitch at all times.',
  pin: 'Fix a cell, e.g. Jake in goal 0–10, or Martha starts on the bench.',
  gk_plan: 'Choose who goes in goal in each goalkeeper block (e.g. each quarter). Leave a block blank to let the app choose.',
  spells: 'How many separate times each player comes on, e.g. at most 2 spells each.',
  max_on: 'Nobody plays more than N minutes without a break.',
  rotate: 'A player who stays on through a substitution point moves to a different outfield position (e.g. LD → RD).',
  side_pref: 'Keep players on the side of the pitch they prefer. Set each player’s side (L / R) on the Squad tab.',
  min_subs: 'Bring on at least N players at every substitution point. As a “Try to” rule with a high N, it makes as many substitutions as the other rules allow.',
  together_time: 'Chosen players share the pitch for at least N minutes in total.',
};

export const WEIGHT_LABELS: Record<Weight, string> = { low: 'Low', medium: 'Medium', high: 'High' };

function base(mode: 'hard' | 'soft' = 'hard', weight: Weight = 'medium') {
  return { id: uid('c'), enabled: true, mode, weight };
}

export function newConstraint(kind: ConstraintKind, settings: Settings): Constraint {
  const ids = settings.squad.filter((p) => p.available).map((p) => p.id);
  const a = ids[0] ?? '';
  const b = ids[1] ?? '';
  const total = settings.match.quarters * settings.match.quarter_length_min;
  switch (kind) {
    case 'even_time':
      return { ...base(), kind, maxDiff: 5 };
    case 'minutes':
      return { ...base(), kind, min: Math.round(total / 2), max: null, players: [] };
    case 'role_balance':
      return { ...base(), kind, minDef: 10, minAtt: 10, players: [] };
    case 'gk_share':
      return { ...base(), kind, players: [], minEach: settings.match.quarter_length_min, evenWithin: null };
    case 'role_blocks':
      return { ...base(), kind, exceptions: [] };
    case 'position_stability':
      return { ...base('soft', 'low'), kind, maxChanges: 1 };
    case 'max_bench':
      return { ...base('soft'), kind, maxMinutes: settings.match.quarter_length_min * 2 };
    case 'start_finish':
      return { ...base(), kind };
    case 'together':
      return { ...base(), kind, a, b, scope: 'pitch' };
    case 'apart':
      return { ...base(), kind, a, b, scope: 'pitch' };
    case 'group_mix': {
      const group = settings.squad[0]?.group ?? 'blue';
      return { ...base(), kind, group, min: 1, max: null };
    }
    case 'pin':
      return { ...base(), kind, player: a, position: 'GK', from: 0, to: settings.match.quarter_length_min };
    case 'gk_plan':
      return { ...base(), kind, keepers: {} };
    case 'spells':
      return { ...base(), kind, min: 1, max: 2, players: [] };
    case 'max_on':
      return { ...base(), kind, maxMinutes: settings.match.quarter_length_min * 2, players: [] };
    case 'rotate':
      return { ...base('soft', 'medium'), kind, players: [] };
    case 'side_pref':
      return { ...base('soft', 'medium'), kind };
    case 'min_subs':
      return { ...base('soft', 'medium'), kind, perPoint: 3 };
    case 'together_time':
      return { ...base(), kind, players: [], minMinutes: settings.match.quarter_length_min };
  }
}

/** Goalkeeper blocks: [start, end) between GK change points. */
export function gkBlocks(m: MatchSettings): { start: number; end: number }[] {
  const total = m.quarters * m.quarter_length_min;
  const cuts = [...new Set([0, ...m.gk_change_points.filter((x) => x > 0 && x < total), total])].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, i) => ({ start, end: cuts[i + 1] }));
}

/** Goalkeeper blocks that have a chosen keeper in the plan. */
export function plannedKeepers(c: { keepers: Record<string, string> }, m: MatchSettings) {
  return gkBlocks(m)
    .map((b) => ({ ...b, player: c.keepers[String(b.start)] ?? '' }))
    .filter((b) => b.player);
}

function names(settings: Settings, ids: string[]): string {
  if (!ids.length) return 'everyone';
  const ns = ids.map((id) => playerName(settings, id));
  return ns.length <= 2 ? ns.join(' and ') : `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/** Plain-English one-liner for a constraint. */
export function describeConstraint(c: Constraint, settings: Settings): string {
  const n = (id: string) => playerName(settings, id);
  switch (c.kind) {
    case 'even_time':
      return `Everyone's total minutes within ${c.maxDiff} min of each other`;
    case 'minutes': {
      const who = c.players.length ? names(settings, c.players) : 'Everyone';
      if (c.min != null && c.max != null) return `${who}: between ${c.min} and ${c.max} minutes`;
      if (c.min != null) return `${who}: at least ${c.min} minutes`;
      if (c.max != null) return `${who}: no more than ${c.max} minutes`;
      return `${who}: no minute limits set`;
    }
    case 'role_balance': {
      const who = c.players.length ? names(settings, c.players) : 'Every outfield player';
      return `${who}: at least ${c.minDef} min in defence and ${c.minAtt} min in attack`;
    }
    case 'gk_share': {
      const keepers = c.players.length
        ? c.players
        : settings.squad.filter((p) => p.available && canPlayGk(p, settings.positions)).map((p) => p.id);
      const parts: string[] = [];
      if (c.minEach != null) parts.push(`each at least ${c.minEach} min in goal`);
      if (c.evenWithin != null) parts.push(`goal time within ${c.evenWithin} min of each other`);
      const who = keepers.length ? `Goalkeepers (${names(settings, keepers)})` : 'Goalkeepers (none ticked yet)';
      return parts.length ? `${who}: ${parts.join('; ')}` : `${who}: no limits set`;
    }
    case 'role_blocks':
      return c.exceptions.length
        ? `Outfield players keep one role per quarter (role swaps also allowed at ${formatMinuteList(c.exceptions)} min)`
        : 'Outfield players keep one role (defence or attack) for a whole quarter';
    case 'position_stability':
      return c.maxChanges === 0
        ? 'No position changes while staying on the pitch'
        : `At most ${c.maxChanges} position change${c.maxChanges === 1 ? '' : 's'} per player while staying on`;
    case 'max_bench':
      return `Nobody sits out more than ${c.maxMinutes} min in a row`;
    case 'start_finish':
      return 'Everyone plays in the first half and in the second half';
    case 'together': {
      const extra = c.scope === 'side' ? ', on the same side' : c.scope === 'unit' ? ', in the same unit' : '';
      return `${n(c.a)} and ${n(c.b)} play together${extra}`;
    }
    case 'apart':
      return c.scope === 'unit'
        ? `${n(c.a)} and ${n(c.b)} never in the same unit`
        : `${n(c.a)} and ${n(c.b)} never on the pitch together`;
    case 'group_mix': {
      const g = c.group;
      if (c.min != null && c.max != null) return `Between ${c.min} and ${c.max} ${g} players on the pitch`;
      if (c.min != null) return `At least ${c.min} ${g} player${c.min === 1 ? '' : 's'} on the pitch`;
      if (c.max != null) return `At most ${c.max} ${g} player${c.max === 1 ? '' : 's'} on the pitch`;
      return `No limits on ${g} players`;
    }
    case 'gk_plan': {
      const planned = plannedKeepers(c, settings.match);
      if (!planned.length) return 'In goal: no one chosen yet (the app picks)';
      return 'In goal: ' + planned.map((b) => `${n(b.player)} ${b.start}–${b.end}`).join(', ');
    }
    case 'spells': {
      const who = c.players.length ? names(settings, c.players) : 'Everyone';
      const t = (k: number) => `${k} time${k === 1 ? '' : 's'}`;
      if (c.min != null && c.max != null)
        return c.min === c.max ? `${who} comes on exactly ${t(c.min)}` : `${who} comes on between ${c.min} and ${t(c.max)}`;
      if (c.min != null) return `${who} comes on at least ${t(c.min)}`;
      if (c.max != null) return `${who} comes on at most ${t(c.max)}`;
      return `${who}: no limit on times coming on`;
    }
    case 'max_on': {
      const who = c.players.length ? names(settings, c.players) : 'Nobody';
      return c.players.length
        ? `${who}: no more than ${c.maxMinutes} min on the pitch in a row`
        : `Nobody plays more than ${c.maxMinutes} min in a row`;
    }
    case 'rotate': {
      const who = c.players.length ? names(settings, c.players) : 'Players';
      return `${who} staying on change position at every sub`;
    }
    case 'side_pref': {
      const left = settings.squad.filter((p) => p.side === 'L').map((p) => p.id);
      const right = settings.squad.filter((p) => p.side === 'R').map((p) => p.id);
      const parts = [];
      if (left.length) parts.push(`${names(settings, left)} on the left`);
      if (right.length) parts.push(`${names(settings, right)} on the right`);
      return parts.length ? `Keep ${parts.join('; ')}` : 'No sides set yet (set L / R on the Squad tab)';
    }
    case 'min_subs':
      return c.mode === 'soft' && c.perPoint >= 3
        ? `As many substitutions as possible (aim: ${c.perPoint} players on at each sub)`
        : `At least ${c.perPoint} player${c.perPoint === 1 ? '' : 's'} come${c.perPoint === 1 ? 's' : ''} on at each sub`;
    case 'together_time':
      return c.players.length < 2
        ? 'Pick at least two players'
        : `${names(settings, c.players)} on the pitch together for at least ${c.minMinutes} min`;
    case 'pin': {
      const where = c.position === 'BENCH' ? 'on the bench' : c.position === 'ON' ? 'on the pitch' : `in ${c.position}`;
      return `${n(c.player)} ${where} ${c.from}–${c.to} min`;
    }
  }
}

/** Ids a constraint refers to (for tidying up after a player is deleted). */
export function referencedPlayers(c: Constraint): string[] {
  switch (c.kind) {
    case 'minutes':
    case 'role_balance':
    case 'gk_share':
    case 'spells':
    case 'max_on':
      return c.players;
    case 'gk_plan':
      return Object.values(c.keepers).filter(Boolean);
    case 'rotate':
      return c.players;
    case 'side_pref':
    case 'min_subs':
      return [];
    case 'together_time':
      return c.players;
    case 'together':
    case 'apart':
      return [c.a, c.b];
    case 'pin':
      return [c.player];
    default:
      return [];
  }
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  build: (settings: Settings) => { constraints: Constraint[]; match?: Partial<MatchSettings> };
}

export const PRESETS: Preset[] = [
  {
    id: 'coaches',
    name: "Coaches' current rules",
    description:
      'Subs at 5, 10, 20, 30 and 35. Keeper changes at quarter breaks. Everyone within 5 minutes; one role per quarter; at least 10 min in defence and attack.',
    build: (settings) => {
      const gk = settings.squad.filter((p) => canPlayGk(p, settings.positions));
      const outfieldKeepers = gk.filter((p) => isOutfielder(p, settings.positions)).map((p) => p.id);
      const outfieldOnly = settings.squad
        .filter((p) => !canPlayGk(p, settings.positions) && isOutfielder(p, settings.positions))
        .map((p) => p.id);
      const q = settings.match.quarter_length_min;
      const slot = settings.match.slot_length_min;
      const constraints: Constraint[] = [
        { ...base(), kind: 'even_time', maxDiff: slot },
        { ...base(), kind: 'gk_share', players: [], minEach: q, evenWithin: null },
        { ...base(), kind: 'role_blocks', exceptions: [] },
        { ...base(), kind: 'role_balance', minDef: q, minAtt: q, players: outfieldOnly },
        { ...base(), kind: 'role_balance', minDef: slot, minAtt: slot, players: outfieldKeepers },
        { ...base(), kind: 'start_finish' },
        { ...base('soft', 'medium'), kind: 'max_bench', maxMinutes: 2 * q },
        { ...base('soft', 'low'), kind: 'position_stability', maxChanges: 1 },
      ];
      if (!outfieldKeepers.length) constraints.splice(4, 1);
      if (!outfieldOnly.length) constraints.splice(3, 1);
      const m = settings.match;
      const subs = [5, 10, 20, 30, 35].filter((x) => x % m.slot_length_min === 0 && x < m.quarters * m.quarter_length_min);
      const breaks = Array.from({ length: m.quarters - 1 }, (_, i) => (i + 1) * m.quarter_length_min);
      return {
        constraints,
        match: { sub_points: [...new Set([...subs, ...breaks])].sort((a, b) => a - b), gk_change_points: breaks },
      };
    },
  },
  {
    id: 'equal',
    name: 'Equal time everyone',
    description: 'Everyone within 5 minutes of each other, plays in both halves and never sits out more than 15 minutes.',
    build: (settings) => {
      const slot = settings.match.slot_length_min;
      return {
        constraints: [
          { ...base(), kind: 'even_time', maxDiff: slot },
          { ...base(), kind: 'start_finish' },
          { ...base('soft', 'high'), kind: 'max_bench', maxMinutes: 15 },
          { ...base('soft', 'medium'), kind: 'role_balance', minDef: slot, minAtt: slot, players: [] },
          { ...base('soft', 'low'), kind: 'position_stability', maxChanges: 1 },
        ],
      };
    },
  },
];
