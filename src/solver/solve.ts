import { describeConstraint } from '../model/constraints';
import { isLockPin } from '../model/locks';
import { allowedPositions, formatMinuteList, gkCodes } from '../model/match';
import type { Break, Constraint, Rota, Settings } from '../model/types';
import { hardBreaks, scoreBreaks, validate } from '../model/validate';
import { buildModel, type BuildOptions } from './model';

/** The part of highs-js we use (its legacy one-shot `solve`). */
export interface HighsLike {
  solve(
    lp: string,
    options?: Record<string, unknown>,
  ): { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal?: number }> };
}

export interface RotaOption {
  rota: Rota;
  breaks: Break[];
  score: number;
}

export interface Conflict {
  key: string;
  label: string;
}

export type SolveResult =
  | { status: 'ok'; options: RotaOption[] }
  | { status: 'infeasible'; message: string; conflicts: Conflict[] }
  | { status: 'error'; message: string };

export interface GenerateOptions {
  /** How many distinct options to return. */
  count?: number;
  /** 0 = deterministic default; anything else gives a different (still valid) set. */
  seed?: number;
  /** Seconds per solver call. */
  timeLimit?: number;
  /** Rough overall time budget in seconds; once spent, return the options found so far. */
  budget?: number;
  /** Rebalance: stay as close as possible to this rota (rules still come first). */
  prefer?: Rota;
}

const NOISE_BUDGET = 0.1;
const SOLVER_OPTS = { output_flag: false, mip_rel_gap: 1e-6, random_seed: 0, threads: 1 };

function run(highs: HighsLike, lp: string, timeLimit: number, extra: Record<string, unknown> = {}) {
  try {
    return highs.solve(lp, { ...SOLVER_OPTS, time_limit: timeLimit, ...extra });
  } catch (e) {
    return { Status: 'Error: ' + (e instanceof Error ? e.message : String(e)), ObjectiveValue: 0, Columns: {} };
  }
}

const hasSolution = (r: { Status: string; Columns: Record<string, { Primal?: number }> }) =>
  r.Status === 'Optimal' ||
  ((r.Status === 'Time limit reached' || r.Status === 'Bound on objective reached') &&
    Object.values(r.Columns).some((c) => typeof c.Primal === 'number'));

/** Small deterministic PRNG so "shuffle" is repeatable for a given seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generate(highs: HighsLike, settings: Settings, constraints: Constraint[], opts: GenerateOptions = {}): SolveResult {
  const count = opts.count ?? 5;
  const seed = opts.seed ?? 0;
  const timeLimit = opts.timeLimit ?? 20;
  const started = Date.now();
  const budget = opts.budget ?? 8;
  const remaining = () => budget - (Date.now() - started) / 1000;

  const pre = precheck(settings);
  if (pre) return { status: 'infeasible', message: pre, conflicts: [] };

  let noise: BuildOptions['noise'];
  if (seed) {
    const rnd = mulberry32(seed);
    const cache = new Map<string, number>();
    const cells = settings.positions.length * settings.match.quarters * settings.match.quarter_length_min / settings.match.slot_length_min;
    // Total noise stays below any real difference in score, and the solver may
    // stop within that margin: shuffling never trades away a preference.
    const eps = NOISE_BUDGET / Math.max(1, cells);
    noise = (v) => {
      if (!cache.has(v)) cache.set(v, rnd() * eps);
      return cache.get(v)!;
    };
  }

  const options: RotaOption[] = [];
  const exclude: NonNullable<BuildOptions['exclude']> = [];
  let minDiff = 0;
  // Fast path: first look for rotas that meet every preference too (soft rules
  // treated as hard). Those score 0, so they are optimal by definition, and this
  // model is far quicker to solve than the weighted one.
  const strict = constraints.map((c) => (c.mode === 'soft' ? { ...c, mode: 'hard' as const } : c));
  let tryStrict = constraints.some((c) => c.enabled && c.mode === 'soft');
  for (let i = 0; i < count; i++) {
    // The first option always gets the full time limit; later ones share what's left.
    if (i > 0 && remaining() <= 0.2) break;
    const limitFor = (cap: number) => (i === 0 ? cap : Math.max(0.2, Math.min(cap, remaining())));
    let found = false;
    // Prefer options that differ in several cells; fall back to any difference.
    const diffs = i === 0 ? [0] : [...new Set([minDiff, 2])];
    const attempts = [
      ...(tryStrict ? diffs.map((diff) => ({ cs: strict, diff, limit: limitFor(Math.min(timeLimit, 3)), strict: true })) : []),
      ...diffs.map((diff) => ({ cs: constraints, diff, limit: limitFor(timeLimit), strict: false })),
    ];
    for (const { cs, diff, limit, strict: isStrict } of attempts) {
      if (isStrict && !tryStrict) continue;
      const model = buildModel(settings, cs, { noise, prefer: opts.prefer, exclude: exclude.map((e) => ({ ...e, minDiff: diff })) });
      const res = run(highs, model.lp, limit, seed ? { mip_abs_gap: NOISE_BUDGET } : {});
      if (res.Status.startsWith('Error')) return { status: 'error', message: `The solver failed: ${res.Status}` };
      if (!hasSolution(res)) {
        if (isStrict && diff === diffs[diffs.length - 1]) tryStrict = false;
        continue;
      }
      const { rota, ones } = model.decode(res.Columns as Record<string, { Primal: number }>);
      if (i === 0) minDiff = Math.max(2, Math.round(ones.length / 5));
      exclude.push({ ones, minDiff: diff });
      const breaks = validate(rota, settings, constraints);
      options.push({ rota, breaks, score: scoreBreaks(breaks) });
      found = true;
      break;
    }
    if (!found) break;
  }

  if (!options.length) {
    const conflicts = explain(highs, settings, constraints, Math.min(timeLimit, 5));
    return {
      status: 'infeasible',
      conflicts,
      message: conflicts.length
        ? 'These rules can’t all be met at the same time. Switch one off, loosen it, or make it a preference (soft):'
        : 'No rota fits these rules, and no single rule could be pinned down as the cause.',
    };
  }
  // Rank by score; keep discovery order for ties (stable sort).
  options.sort((a, b) => a.score - b.score);
  // Safety net: never hand back something that breaks a hard rule.
  return { status: 'ok', options: options.filter((o) => hardBreaks(o.breaks).length === 0) };
}

/** Plain-English reasons that need no solver at all. */
export function precheck(settings: Settings): string | null {
  const avail = settings.squad.filter((p) => p.available);
  const need = settings.positions.length;
  if (avail.length < need)
    return `Only ${avail.length} player${avail.length === 1 ? ' is' : 's are'} available, but ${need} are needed on the pitch.`;
  for (const q of settings.positions) {
    if (!avail.some((p) => allowedPositions(p, settings.positions).includes(q.code)))
      return q.role === 'GK'
        ? `Nobody available is allowed in goal. Tick “GK” for someone in the squad.`
        : `Nobody available is allowed to play ${q.name} (${q.code}).`;
  }
  const outfieldSpots = settings.positions.filter((q) => q.role !== 'GK').length;
  const outfielders = avail.filter((p) => !p.gk_only).length;
  if (outfielders < outfieldSpots)
    return `Only ${outfielders} available player${outfielders === 1 ? ' plays' : 's play'} outfield, but ${outfieldSpots} outfield positions need filling.`;
  return null;
}

/** Everything that could be switched off to make room, in the order we try dropping them. */
function candidateRules(settings: Settings, constraints: Constraint[]): Conflict[] {
  const m = settings.match;
  const positions = settings.positions;
  const gk = gkCodes(positions);
  const avail = settings.squad.filter((p) => p.available);
  const all = positions.map((q) => q.code);
  const restricted = avail.filter((p) => allowedPositions(p, positions).length < all.length);
  const describeAllowed = (p: (typeof avail)[number]) => {
    const a = allowedPositions(p, positions);
    if (p.gk_only || a.every((c) => gk.includes(c))) return `${p.name} only plays in goal`;
    const missing = all.filter((c) => !a.includes(c));
    if (missing.every((c) => gk.includes(c))) return `${p.name} can’t go in goal`;
    return `${p.name} only plays ${a.join(', ')}`;
  };
  const items: Conflict[] = [];
  // Ordinary position limits ("can't go in goal") stay fixed: they are rarely the
  // rule a coach wants to change, and relaxing them all makes the search slow.
  // Rules earlier in this list are tried (and dropped from the answer) first.
  for (const c of constraints)
    if (c.enabled && c.mode === 'hard')
      items.push({ key: c.id, label: (isLockPin(c.id) ? 'Locked: ' : '') + describeConstraint(onlyAvailable(c, settings), settings) });
  for (const p of restricted.filter((p) => p.gk_only)) items.push({ key: `builtin:allowed:${p.id}`, label: describeAllowed(p) });
  items.push({ key: 'builtin:gk_fixed', label: `Goalkeeper only changes at ${formatMinuteList(m.gk_change_points) || 'no point'} min` });
  items.push({ key: 'builtin:subs', label: `Subs only at ${formatMinuteList(m.sub_points) || 'no point'} min` });
  return items;
}

/** Leave unavailable players out of a rule's player list (for messages). */
function onlyAvailable(c: Constraint, settings: Settings): Constraint {
  if (!('players' in c) || !c.players.length) return c;
  const avail = new Set(settings.squad.filter((p) => p.available).map((p) => p.id));
  const players = c.players.filter((id) => avail.has(id));
  return players.length ? { ...c, players } : c;
}

/**
 * Deletion filter: drop rules one at a time; keep a rule only if the rest
 * become solvable without it. What's left is a minimal conflicting set.
 */
export function explain(highs: HighsLike, settings: Settings, constraints: Constraint[], timeLimit = 5): Conflict[] {
  const items = candidateRules(settings, constraints);
  const all = new Set(items.map((i) => i.key));
  const feasible = (keep: Set<string>): boolean | null => {
    const drop = new Set([...all].filter((k) => !keep.has(k)));
    const model = buildModel(settings, constraints, { drop, feasibilityOnly: true });
    const res = run(highs, model.lp, timeLimit);
    if (res.Status === 'Infeasible') return false;
    if (hasSolution(res)) return true;
    return null;
  };
  if (feasible(new Set(all)) !== false) return [];
  const keep = new Set(all);
  for (const item of items) {
    keep.delete(item.key);
    if (feasible(keep) !== false) keep.add(item.key);
  }
  return items.filter((i) => keep.has(i.key));
}

export interface CountOptions {
  /** Stop after this many rotas. */
  limit?: number;
  /** Stop after this many seconds. */
  budget?: number;
  /** Count only rotas that also meet every preference ("Try to" rule). */
  includePreferences?: boolean;
  onProgress?: (count: number) => void;
}

export interface CountResult {
  count: number;
  /** True when every rota was found (not stopped by the limit or time). */
  exact: boolean;
  stoppedBy?: 'limit' | 'time';
  ms: number;
  error?: string;
}

/**
 * Count distinct rotas that meet the rules by enumerating them one at a time,
 * each new one required to differ from all before it. Exact when it finishes;
 * otherwise a lower bound.
 */
export function countRotas(highs: HighsLike, settings: Settings, constraints: Constraint[], opts: CountOptions = {}): CountResult {
  const started = Date.now();
  const limit = opts.limit ?? 1000;
  const budget = opts.budget ?? 10;
  const elapsed = () => (Date.now() - started) / 1000;
  if (precheck(settings)) return { count: 0, exact: true, ms: 0 };
  const cs = opts.includePreferences ? constraints.map((c) => (c.mode === 'soft' ? { ...c, mode: 'hard' as const } : c)) : constraints;
  const exclude: NonNullable<BuildOptions['exclude']> = [];
  let count = 0;
  for (;;) {
    if (count >= limit) return { count, exact: false, stoppedBy: 'limit', ms: Date.now() - started };
    const left = budget - elapsed();
    if (left <= 0) return { count, exact: false, stoppedBy: 'time', ms: Date.now() - started };
    const model = buildModel(settings, cs, { feasibilityOnly: true, exclude });
    const res = run(highs, model.lp, Math.max(0.5, left));
    if (res.Status === 'Infeasible') return { count, exact: true, ms: Date.now() - started };
    if (!hasSolution(res)) return { count, exact: false, stoppedBy: 'time', ms: Date.now() - started };
    const { ones } = model.decode(res.Columns as Record<string, { Primal: number }>);
    exclude.push({ ones, minDiff: 1 });
    count++;
    if (count % 10 === 0) opts.onProgress?.(count);
  }
}
