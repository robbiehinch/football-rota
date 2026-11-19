import {
  WEIGHT_VALUE,
  allowedPositions,
  canPlayGk,
  isOutfielder,
  slotBoundaries,
  slotCount,
  totalMinutes,
  windowsFor,
  type Window,
} from '../model/match';
import { plannedKeepers } from '../model/constraints';
import { emptyRota } from '../model/stats';
import type { Constraint, Rota, Settings } from '../model/types';
import { roleBlocks, scopePlayers } from '../model/validate';
import { LpModel, scale, terms, type Terms } from './lp';

export interface BuildOptions {
  /** Rule keys to leave out (constraint ids or builtin:* keys). Used to explain conflicts. */
  drop?: Set<string>;
  /** Only hard rules, no objective. */
  feasibilityOnly?: boolean;
  /** Small per-cell objective noise for "shuffle". */
  noise?: (key: string) => number;
  /** Earlier solutions (lists of x variables set to 1) to differ from. */
  exclude?: { ones: string[]; minDiff: number }[];
  /**
   * Stay close to this rota: each slot a player spends somewhere other than
   * where this rota has them costs a little. Kept below any preference's
   * penalty, so rules come first and closeness only breaks ties.
   */
  prefer?: Rota;
}

/** Cost per changed cell-slot when staying close to a rota (see BuildOptions.prefer). */
export const CLOSENESS_COST = 0.004;

export interface BuiltModel {
  lp: string;
  windows: Window[];
  decode: (columns: Record<string, { Primal: number }>) => { rota: Rota; ones: string[] };
}

/**
 * Integer program: binary x[player][window][position], where a window is a run
 * of slots with no open substitution point (rule 3 is built into the variables).
 */
export function buildModel(settings: Settings, constraints: Constraint[], opts: BuildOptions = {}): BuiltModel {
  const drop = opts.drop ?? new Set<string>();
  const m = settings.match;
  const len = m.slot_length_min;
  const n = slotCount(m);
  const positions = settings.positions;
  const avail = settings.squad.filter((p) => p.available);
  const pIndex = new Map(avail.map((p, i) => [p.id, i]));
  const bounds = slotBoundaries(m);
  const open = drop.has('builtin:subs') ? bounds : m.sub_points.filter((b) => bounds.includes(b));
  const windows = windowsFor(m, open);
  const lp = new LpModel();

  const allowed = new Map(
    avail.map((p) => [p.id, drop.has(`builtin:allowed:${p.id}`) ? positions.map((q) => q.code) : allowedPositions(p, positions)]),
  );
  const xName = (pid: string, w: number, qi: number) => `x_${pIndex.get(pid)}_${w}_${qi}`;
  const x = (pid: string, w: number, code: string): string | null => {
    const qi = positions.findIndex((q) => q.code === code);
    if (qi < 0 || !pIndex.has(pid) || !allowed.get(pid)!.includes(code)) return null;
    return xName(pid, w, qi);
  };
  for (const p of avail)
    for (const w of windows) for (const code of allowed.get(p.id)!) lp.binary(x(p.id, w.index, code)!);

  const sumX = (pid: string, w: number, pred: (code: string) => boolean): Terms =>
    terms(positions.filter((q) => pred(q.code)).map((q) => x(pid, w, q.code)).filter((v): v is string => !!v).map((v) => [v, 1] as [string, number]));
  const on = (pid: string, w: number) => sumX(pid, w, () => true);
  const roleOf = (code: string) => positions.find((q) => q.code === code)!.role;
  const sideOf = (code: string) => positions.find((q) => q.code === code)!.side;
  const role = (pid: string, w: number, r: string) => sumX(pid, w, (c) => roleOf(c) === r);
  const minutes = (pid: string, pred: (code: string) => boolean = () => true) =>
    terms(...windows.map((w) => scale(sumX(pid, w.index, pred), w.minutes)));

  // Rule 1: exactly one player per position per window; nobody in two places.
  for (const w of windows) {
    positions.forEach((q) => lp.row(terms(avail.map((p) => x(p.id, w.index, q.code)).filter((v): v is string => !!v).map((v) => [v, 1])), '=', 1));
    for (const p of avail) lp.row(on(p.id, w.index), '<=', 1);
  }

  // Rule 4: the goalkeeper only changes at GK change points.
  if (!drop.has('builtin:gk_fixed')) {
    const gkPoints = new Set(m.gk_change_points);
    for (let i = 1; i < windows.length; i++) {
      if (gkPoints.has(windows[i].start)) continue;
      for (const p of avail) {
        const gk = (w: number) => role(p.id, w, 'GK');
        lp.row(terms(gk(i - 1), scale(gk(i), -1)), '=', 0);
      }
    }
  }

  // Configurable rules -------------------------------------------------------
  let slackId = 0;
  for (const c of constraints) {
    if (!c.enabled || drop.has(c.id)) continue;
    if (c.mode === 'soft' && opts.feasibilityOnly) continue;
    const w8 = WEIGHT_VALUE[c.weight];
    /** A slack variable when soft (penalty per unit), or null when hard. */
    const slack = (penaltyPerUnit: number, hi = Infinity): string | null => {
      if (c.mode === 'hard') return null;
      const s = lp.continuous(`s${slackId++}`, 0, hi);
      lp.cost(s, w8 * penaltyPerUnit);
      return s;
    };
    const perMinute = 1 / len;
    const ge = (t: Terms, rhs: number, s: string | null) => lp.row(s ? terms(t, [[s, 1]]) : t, '>=', rhs);
    const le = (t: Terms, rhs: number, s: string | null) => lp.row(s ? terms(t, [[s, -1]]) : t, '<=', rhs);
    const aux = (prefix: string, hi = Infinity) => lp.continuous(`${prefix}${slackId++}`, 0, hi);

    switch (c.kind) {
      case 'even_time': {
        if (avail.length < 2) break;
        // Valid cuts that make the solver much faster: min <= average <= max,
        // and (when hard) every total lies within maxDiff of the average.
        // Totals are multiples of the slot length, so the range can be rounded.
        const mean = (totalMinutes(m) * positions.length) / avail.length;
        const floorT = Math.ceil((mean - c.maxDiff) / len - 1e-9) * len;
        const ceilT = Math.floor((mean + c.maxDiff) / len + 1e-9) * len;
        if (c.mode === 'hard') {
          for (const p of avail) {
            ge(minutes(p.id), floorT, null);
            le(minutes(p.id), ceilT, null);
          }
          // The bounds alone are enough when the allowed range is narrow.
          if (ceilT - floorT <= c.maxDiff) break;
          // Otherwise pick a base level L (binary choice); everyone plays L..L+maxDiff.
          const levels: number[] = [];
          for (let L = floorT; L + c.maxDiff <= ceilT + 1e-9 || !levels.length; L += len) levels.push(L);
          const ys = levels.map(() => lp.binary(`lvl${slackId++}`));
          lp.row(terms(ys.map((y) => [y, 1] as [string, number])), '=', 1);
          for (const p of avail) {
            ge(terms(minutes(p.id), ys.map((y, i) => [y, -levels[i]] as [string, number])), 0, null);
            le(terms(minutes(p.id), ys.map((y, i) => [y, -(levels[i] + c.maxDiff)] as [string, number])), 0, null);
          }
          break;
        }
        const hi = aux('tmax');
        const lo = aux('tmin');
        for (const p of avail) {
          le(terms(minutes(p.id), [[hi, -1]]), 0, null);
          ge(terms(minutes(p.id), [[lo, -1]]), 0, null);
        }
        ge(terms([[hi, 1]]), mean, null);
        le(terms([[lo, 1]]), mean, null);
        le(terms([[hi, 1], [lo, -1]]), c.maxDiff, slack(perMinute));
        break;
      }
      case 'minutes':
        for (const p of scopePlayers(c.players, settings, () => true)) {
          if (c.min != null) ge(minutes(p.id), c.min, slack(perMinute));
          if (c.max != null) le(minutes(p.id), c.max, slack(perMinute));
        }
        break;
      case 'role_balance':
        for (const p of scopePlayers(c.players, settings, (p) => isOutfielder(p, positions))) {
          ge(minutes(p.id, (code) => roleOf(code) === 'DEF'), c.minDef, slack(perMinute));
          ge(minutes(p.id, (code) => roleOf(code) === 'ATT'), c.minAtt, slack(perMinute));
        }
        break;
      case 'gk_share': {
        const listed = c.players.length ? avail.filter((p) => c.players.includes(p.id)) : avail.filter((p) => canPlayGk(p, positions));
        const isGk = (code: string) => roleOf(code) === 'GK';
        if (c.players.length)
          for (const p of avail) if (!c.players.includes(p.id)) le(minutes(p.id, isGk), 0, slack(perMinute));
        if (c.minEach != null) for (const p of listed) ge(minutes(p.id, isGk), c.minEach, slack(perMinute));
        if (c.evenWithin != null && listed.length > 1) {
          const hi = aux('gmax');
          const lo = aux('gmin');
          for (const p of listed) {
            le(terms(minutes(p.id, isGk), [[hi, -1]]), 0, null);
            ge(terms(minutes(p.id, isGk), [[lo, -1]]), 0, null);
          }
          le(terms([[hi, 1], [lo, -1]]), c.evenWithin, slack(perMinute));
        }
        break;
      }
      case 'role_blocks': {
        const roles = [...new Set(positions.map((q) => q.role))].filter((r) => r !== 'GK');
        for (const block of roleBlocks(settings, c.exceptions)) {
          const ws = windows.filter((w) => w.start < block.end && w.end > block.start);
          if (ws.length < 2) continue;
          for (const p of avail) {
            const hs = roles.map((r) => {
              const h = aux('h', 1);
              for (const w of ws) le(terms(role(p.id, w.index, r), [[h, -1]]), 0, null);
              return h;
            });
            le(terms(hs.map((h) => [h, 1] as [string, number])), 1, slack(1));
          }
        }
        break;
      }
      case 'position_stability':
        for (const p of avail) {
          const changes: string[] = [];
          for (let i = 1; i < windows.length; i++) {
            const ch = aux('chg', 1);
            changes.push(ch);
            for (const code of allowed.get(p.id)!) {
              // in `code` before, on the pitch after, but not in `code` after => a change
              const t = terms([[x(p.id, i - 1, code)!, 1]], on(p.id, i), [[x(p.id, i, code)!, -1]], [[ch, -1]]);
              le(t, 1, null);
            }
          }
          if (changes.length) le(terms(changes.map((v) => [v, 1] as [string, number])), c.maxChanges, slack(1));
        }
        break;
      case 'max_bench': {
        const k = Math.floor(c.maxMinutes / len) + 1;
        for (const p of avail)
          for (let s = 0; s + k <= n; s++) {
            const ws = windows.filter((w) => w.from < s + k && w.to > s);
            ge(terms(...ws.map((w) => on(p.id, w.index))), 1, slack(1, 1));
          }
        break;
      }
      case 'start_finish': {
        const half = totalMinutes(m) / 2;
        for (const p of avail) {
          ge(terms(...windows.filter((w) => w.start < half).map((w) => on(p.id, w.index))), 1, slack(1, 1));
          ge(terms(...windows.filter((w) => w.end > half).map((w) => on(p.id, w.index))), 1, slack(1, 1));
        }
        break;
      }
      case 'together': {
        if (!pIndex.has(c.a) || !pIndex.has(c.b) || c.a === c.b) break;
        const features: Array<(pid: string, w: number) => Terms> =
          c.scope === 'side'
            ? [...new Set(positions.map((q) => q.side))].map((sd) => (pid: string, w: number) => sumX(pid, w, (code) => sideOf(code) === sd))
            : c.scope === 'unit'
              ? [...new Set(positions.map((q) => q.role))].map((r) => (pid: string, w: number) => role(pid, w, r))
              : [on];
        for (const w of windows) {
          const s = slack(w.minutes / len, 1);
          for (const f of features) {
            le(terms(f(c.a, w.index), scale(f(c.b, w.index), -1)), 0, s);
            le(terms(f(c.b, w.index), scale(f(c.a, w.index), -1)), 0, s);
          }
        }
        const zs = windows.map((w) => {
          const z = aux('z', 1);
          le(terms([[z, 1]], scale(on(c.a, w.index), -1)), 0, null);
          le(terms([[z, 1]], scale(on(c.b, w.index), -1)), 0, null);
          return z;
        });
        ge(terms(zs.map((z) => [z, 1] as [string, number])), 1, slack(1, 1));
        break;
      }
      case 'apart': {
        if (!pIndex.has(c.a) || !pIndex.has(c.b) || c.a === c.b) break;
        for (const w of windows) {
          const s = slack(w.minutes / len, 1);
          if (c.scope === 'pitch') le(terms(on(c.a, w.index), on(c.b, w.index)), 1, s);
          else
            for (const r of new Set(positions.map((q) => q.role)))
              if (r !== 'GK') le(terms(role(c.a, w.index, r), role(c.b, w.index, r)), 1, s);
        }
        break;
      }
      case 'group_mix': {
        const members = avail.filter((p) => p.group === c.group);
        for (const w of windows) {
          const count = terms(...members.map((p) => on(p.id, w.index)));
          if (c.min != null) ge(count, c.min, slack(w.minutes / len));
          if (c.max != null) le(count, c.max, slack(w.minutes / len));
        }
        break;
      }
      case 'pin': {
        const inRange = (s: number) => s * len >= c.from && (s + 1) * len <= c.to;
        for (const w of windows) {
          let k = 0;
          for (let s = w.from; s < w.to; s++) if (inRange(s)) k++;
          if (!k) continue;
          const s = slack(k, 1);
          if (c.position === 'BENCH') le(on(c.player, w.index), 0, s);
          else if (c.position === 'ON') ge(on(c.player, w.index), 1, s);
          else {
            const v = x(c.player, w.index, c.position);
            ge(v ? terms([[v, 1]]) : terms(), 1, s);
          }
        }
        break;
      }
      case 'gk_plan':
        for (const block of plannedKeepers(c, m))
          for (const w of windows) {
            let k = 0;
            for (let s = w.from; s < w.to; s++) if (s * len >= block.start && (s + 1) * len <= block.end) k++;
            if (k) ge(role(block.player, w.index, 'GK'), 1, slack(k, 1));
          }
        break;
      case 'spells':
        for (const p of scopePlayers(c.players, settings, () => true)) {
          // starts[w] = 1 exactly when the player comes on at the start of window w.
          const starts: Terms[] = windows.map((w) => {
            if (w.index === 0) return on(p.id, 0);
            const st = aux('st', 1);
            ge(terms([[st, 1]], scale(on(p.id, w.index), -1), on(p.id, w.index - 1)), 0, null);
            le(terms([[st, 1]], scale(on(p.id, w.index), -1)), 0, null);
            le(terms([[st, 1]], on(p.id, w.index - 1)), 1, null);
            return terms([[st, 1]]);
          });
          const count = terms(...starts);
          if (c.min != null) ge(count, c.min, slack(1));
          if (c.max != null) le(count, c.max, slack(1));
        }
        break;
      case 'rotate': {
        const outfield = positions.filter((q) => q.role !== 'GK').map((q) => q.code);
        for (const p of scopePlayers(c.players, settings, () => true))
          for (let i = 1; i < windows.length; i++) {
            const s = slack(1, 1);
            for (const code of outfield) {
              const a = x(p.id, i - 1, code);
              const b = x(p.id, i, code);
              if (a && b) le(terms([[a, 1], [b, 1]]), 1, s);
            }
          }
        break;
      }
      case 'side_pref':
        for (const p of avail) {
          const pid = p.id;
          const side = p.side;
          if (!side) continue;
          for (const w of windows) {
            const wrong = sumX(pid, w.index, (code) => sideOf(code) !== 'C' && sideOf(code) !== side);
            if (!wrong.size) continue;
            if (c.mode === 'hard') le(wrong, 0, null);
            // Soft: cost per slot played on the wrong side (no slack variable needed).
            else for (const [v] of wrong) lp.cost(v, w8 * (w.minutes / len));
          }
        }
        break;
      case 'min_subs':
        for (let i = 1; i < windows.length; i++) {
          // Every position is filled in both windows, so players coming on = positions
          // minus players who stay on. stay[p] >= 1 when p is on in both windows;
          // capping the number who stay is a much tighter model than counting arrivals.
          const stay = avail.map((p) => {
            const y = aux('sy', 1);
            le(terms(on(p.id, i - 1), on(p.id, i), [[y, -1]]), 1, null);
            return [y, 1] as [string, number];
          });
          // Only players on the bench can come on, so the target is capped at the bench size.
          const target = Math.min(c.perPoint, Math.max(0, avail.length - positions.length));
          le(terms(stay), positions.length - target, slack(1));
        }
        break;
      case 'together_time': {
        const group = c.players.filter((id) => pIndex.has(id));
        if (group.length < 2) break;
        const zs = windows.map((w) => {
          const z = aux('tg', 1);
          for (const id of group) le(terms([[z, 1]], scale(on(id, w.index), -1)), 0, null);
          return [z, w.minutes] as [string, number];
        });
        ge(terms(zs), c.minMinutes, slack(perMinute));
        break;
      }
      case 'max_on': {
        const k = Math.floor(c.maxMinutes / len) + 1;
        for (const p of scopePlayers(c.players, settings, () => true))
          for (let s = 0; s + k <= n; s++) {
            const ws = windows.filter((w) => w.from < s + k && w.to > s);
            le(terms(...ws.map((w) => on(p.id, w.index))), ws.length - 1, slack(1, 1));
          }
        break;
      }
    }
  }

  // Shuffle noise and "be different from earlier options" cuts.
  const allX: string[] = [];
  for (const p of avail) for (const w of windows) for (const code of allowed.get(p.id)!) allX.push(x(p.id, w.index, code)!);
  if (opts.noise && !opts.feasibilityOnly) for (const v of allX) lp.cost(v, opts.noise(v));
  if (opts.prefer && !opts.feasibilityOnly)
    for (const p of avail)
      for (const w of windows)
        for (const code of allowed.get(p.id)!) {
          let differ = 0;
          for (let s = w.from; s < w.to; s++) if (opts.prefer[s]?.[code] !== p.id) differ++;
          if (differ) lp.cost(x(p.id, w.index, code)!, CLOSENESS_COST * differ);
        }
  for (const ex of opts.exclude ?? []) {
    const ones = ex.ones.filter((v) => lp.has(v));
    lp.row(terms(ones.map((v) => [v, 1] as [string, number])), '<=', ones.length - ex.minDiff);
  }

  const decode = (columns: Record<string, { Primal: number }>) => {
    const rota = emptyRota(settings);
    const ones: string[] = [];
    for (const p of avail)
      for (const w of windows)
        positions.forEach((q) => {
          const v = x(p.id, w.index, q.code);
          if (v && (columns[v]?.Primal ?? 0) > 0.5) {
            ones.push(v);
            for (let s = w.from; s < w.to; s++) rota[s][q.code] = p.id;
          }
        });
    return { rota, ones };
  };

  return { lp: lp.toString(), windows, decode };
}
