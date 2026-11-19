import { describeConstraint } from './constraints';
import {
  ROLE_NAMES,
  WEIGHT_VALUE,
  allowedPositions,
  canPlayGk,
  gkCodes,
  isOutfielder,
  quarterBreaks,
  roleOf,
  slotCount,
  totalMinutes,
} from './match';
import { timelines } from './stats';
import type { Break, Constraint, Player, Rota, Settings } from './types';

const span = (a: number, b: number) => `${a}–${b}`;

function list(names: string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Group consecutive slot indices into human "a–b" minute ranges. */
function ranges(slots: number[], len: number): string {
  const sorted = [...slots].sort((a, b) => a - b);
  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(span(sorted[i] * len, (sorted[j] + 1) * len));
    i = j + 1;
  }
  return out.join(', ');
}

/** Players a rule with an optional player list applies to. */
export function scopePlayers(ids: string[], settings: Settings, fallback: (p: Player) => boolean): Player[] {
  const avail = settings.squad.filter((p) => p.available);
  return ids.length ? avail.filter((p) => ids.includes(p.id)) : avail.filter(fallback);
}

/** Role-block boundaries: quarter breaks plus exception minutes. */
export function roleBlocks(settings: Settings, exceptions: number[]): { start: number; end: number }[] {
  const total = totalMinutes(settings.match);
  const cuts = [...new Set([0, ...quarterBreaks(settings.match), ...exceptions, total])]
    .filter((x) => x >= 0 && x <= total)
    .sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, i) => ({ start, end: cuts[i + 1] }));
}

/**
 * Check a rota against the built-in hard rules and the given constraints.
 * Pure: used by the solver tests, the results cards and the Edit screen.
 */
export function validate(rota: Rota, settings: Settings, constraints: Constraint[]): Break[] {
  const m = settings.match;
  const len = m.slot_length_min;
  const n = slotCount(m);
  const positions = settings.positions;
  const byId = new Map(settings.squad.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? '(unknown player)';
  const tl = timelines(rota, settings);
  const breaks: Break[] = [];
  const hard = (rule: string, message: string, extra: Partial<Break> = {}) =>
    breaks.push({ rule, severity: 'hard', message, amount: 1, ...extra });

  // ---- Built-in hard rules -------------------------------------------------
  if (rota.length !== n) hard('builtin:shape', `The rota has ${rota.length} time slots but the match has ${n}.`);
  for (let s = 0; s < Math.min(n, rota.length); s++) {
    const slot = rota[s];
    const seen = new Map<string, string[]>();
    for (const q of positions) {
      const pid = slot[q.code];
      const when = span(s * len, (s + 1) * len);
      if (!pid) {
        hard('builtin:fill', `Nobody in ${q.code} at ${when}.`, { slots: [s] });
        continue;
      }
      const p = byId.get(pid);
      if (!p) {
        hard('builtin:fill', `${q.code} at ${when} has a player who isn't in the squad.`, { slots: [s] });
        continue;
      }
      seen.set(pid, [...(seen.get(pid) ?? []), q.code]);
      if (!p.available) hard('builtin:available', `${p.name} is marked unavailable but plays ${q.code} at ${when}.`, { players: [pid], slots: [s] });
      else if (!allowedPositions(p, positions).includes(q.code))
        hard('builtin:allowed', `${p.name} isn't allowed in ${q.code} (${when}).`, { players: [pid], slots: [s] });
    }
    for (const [pid, codes] of seen)
      if (codes.length > 1)
        hard('builtin:double', `${name(pid)} is in ${codes.join(' and ')} at the same time (${span(s * len, (s + 1) * len)}).`, {
          players: [pid],
          slots: [s],
        });
  }
  const subs = new Set(m.sub_points);
  const gkChanges = new Set(m.gk_change_points);
  const gk = gkCodes(positions);
  for (let s = 1; s < Math.min(n, rota.length); s++) {
    const minute = s * len;
    const a = rota[s - 1];
    const b = rota[s];
    const changed = positions.filter((q) => (a[q.code] ?? null) !== (b[q.code] ?? null));
    if (!subs.has(minute) && changed.length)
      hard('builtin:subs', `Changes at ${minute} min (${changed.map((q) => q.code).join(', ')}), but subs aren't open then.`, {
        slots: [s - 1, s],
      });
    else if (!gkChanges.has(minute) && gk.some((c) => (a[c] ?? null) !== (b[c] ?? null)))
      hard('builtin:gk_fixed', `Goalkeeper changes at ${minute} min, but the keeper only changes at ${[...gkChanges].sort((x, y) => x - y).join('/') || 'no point'}.`, {
        slots: [s - 1, s],
      });
  }

  // ---- Configurable rules --------------------------------------------------
  const avail = settings.squad.filter((p) => p.available);
  const total = (id: string) => (tl[id] ?? []).filter(Boolean).length * len;
  const roleMins = (id: string, role: string) => (tl[id] ?? []).filter((c) => c && roleOf(positions, c) === role).length * len;
  const on = (id: string, s: number) => !!tl[id]?.[s];

  for (const c of constraints) {
    if (!c.enabled) continue;
    const add = (message: string, amount: number, extra: Partial<Break> = {}) => {
      if (amount <= 0) return;
      breaks.push({ rule: c.id, severity: c.mode, weight: c.weight, message, amount, ...extra });
    };
    switch (c.kind) {
      case 'even_time': {
        if (avail.length < 2) break;
        const t = avail.map((p) => ({ p, t: total(p.id) }));
        const hi = Math.max(...t.map((x) => x.t));
        const lo = Math.min(...t.map((x) => x.t));
        if (hi - lo > c.maxDiff) {
          const his = t.filter((x) => x.t === hi).map((x) => x.p.name);
          const los = t.filter((x) => x.t === lo).map((x) => x.p.name);
          add(`Playing time ranges from ${lo} min (${list(los)}) to ${hi} min (${list(his)}): more than ${c.maxDiff} min apart.`, (hi - lo - c.maxDiff) / len, {
            players: t.filter((x) => x.t === hi || x.t === lo).map((x) => x.p.id),
          });
        }
        break;
      }
      case 'minutes':
        for (const p of scopePlayers(c.players, settings, () => true)) {
          const t = total(p.id);
          if (c.min != null && t < c.min) add(`${p.name} plays ${t} min (at least ${c.min} wanted).`, (c.min - t) / len, { players: [p.id] });
          if (c.max != null && t > c.max) add(`${p.name} plays ${t} min (no more than ${c.max} wanted).`, (t - c.max) / len, { players: [p.id] });
        }
        break;
      case 'role_balance':
        for (const p of scopePlayers(c.players, settings, (p) => isOutfielder(p, positions))) {
          for (const [role, need] of [['DEF', c.minDef], ['ATT', c.minAtt]] as const) {
            const got = roleMins(p.id, role);
            if (got < need) add(`${p.name} gets ${got} min in ${ROLE_NAMES[role]} (needs ${need}).`, (need - got) / len, { players: [p.id] });
          }
        }
        break;
      case 'gk_share': {
        const listed = c.players.length ? avail.filter((p) => c.players.includes(p.id)) : avail.filter((p) => canPlayGk(p, positions));
        const listedIds = new Set(listed.map((p) => p.id));
        if (c.players.length)
          for (const p of avail) {
            if (listedIds.has(p.id)) continue;
            const g = roleMins(p.id, 'GK');
            if (g > 0) add(`${p.name} goes in goal but isn't on the goalkeeper list.`, g / len, { players: [p.id] });
          }
        if (c.minEach != null)
          for (const p of listed) {
            const g = roleMins(p.id, 'GK');
            if (g < c.minEach) add(`${p.name} gets ${g} min in goal (at least ${c.minEach} wanted).`, (c.minEach - g) / len, { players: [p.id] });
          }
        if (c.evenWithin != null && listed.length > 1) {
          const g = listed.map((p) => ({ p, g: roleMins(p.id, 'GK') }));
          const hi = Math.max(...g.map((x) => x.g));
          const lo = Math.min(...g.map((x) => x.g));
          if (hi - lo > c.evenWithin)
            add(`Goal time isn't shared evenly: ${g.map((x) => `${x.p.name} ${x.g}`).join(', ')} min.`, (hi - lo - c.evenWithin) / len, {
              players: listed.map((p) => p.id),
            });
        }
        break;
      }
      case 'role_blocks':
        for (const block of roleBlocks(settings, c.exceptions)) {
          const slots = [];
          for (let s = 0; s < n; s++) if (s * len >= block.start && (s + 1) * len <= block.end) slots.push(s);
          for (const p of avail) {
            const roles = [...new Set(slots.map((s) => tl[p.id]?.[s]).filter(Boolean).map((code) => roleOf(positions, code!)))].filter(
              (r) => r !== 'GK',
            );
            if (roles.length > 1)
              add(`${p.name} switches between ${roles.map((r) => ROLE_NAMES[r] ?? r).join(' and ')} during ${span(block.start, block.end)}.`, roles.length - 1, {
                players: [p.id],
                slots,
              });
          }
        }
        break;
      case 'position_stability':
        for (const p of avail) {
          const line = tl[p.id] ?? [];
          let changes = 0;
          for (let s = 1; s < n; s++) if (line[s - 1] && line[s] && line[s - 1] !== line[s]) changes++;
          if (changes > c.maxChanges)
            add(`${p.name} changes position ${changes} times while on the pitch (at most ${c.maxChanges} wanted).`, changes - c.maxChanges, { players: [p.id] });
        }
        break;
      case 'max_bench': {
        const k = Math.floor(c.maxMinutes / len) + 1;
        for (const p of avail) {
          let runs = 0;
          for (let s = 0; s + k <= n; s++) {
            let off = true;
            for (let t = s; t < s + k; t++) if (on(p.id, t)) off = false;
            if (off) runs++;
          }
          if (runs) {
            let longest = 0;
            let cur = 0;
            for (let s = 0; s < n; s++) {
              cur = on(p.id, s) ? 0 : cur + len;
              longest = Math.max(longest, cur);
            }
            add(`${p.name} sits out ${longest} min in a row (limit ${c.maxMinutes}).`, runs, { players: [p.id] });
          }
        }
        break;
      }
      case 'start_finish': {
        const half = totalMinutes(m) / 2;
        for (const p of avail) {
          let first = false;
          let second = false;
          for (let s = 0; s < n; s++) {
            if (!on(p.id, s)) continue;
            if (s * len < half) first = true;
            if ((s + 1) * len > half) second = true;
          }
          if (!first) add(`${p.name} doesn't play in the first half.`, 1, { players: [p.id] });
          if (!second) add(`${p.name} doesn't play in the second half.`, 1, { players: [p.id] });
        }
        break;
      }
      case 'together': {
        const a = byId.get(c.a);
        const b = byId.get(c.b);
        if (!a?.available || !b?.available || a.id === b.id) break;
        const sig = (id: string, s: number) => {
          const code = tl[id]?.[s];
          if (!code) return 'off';
          if (c.scope === 'side') return positions.find((q) => q.code === code)?.side ?? '?';
          if (c.scope === 'unit') return roleOf(positions, code);
          return 'on';
        };
        const bad: number[] = [];
        let shared = 0;
        for (let s = 0; s < n; s++) {
          if (sig(a.id, s) !== sig(b.id, s)) bad.push(s);
          if (on(a.id, s) && on(b.id, s)) shared++;
        }
        const what = c.scope === 'side' ? 'on the same side' : c.scope === 'unit' ? 'in the same unit' : 'on the pitch together';
        add(`${a.name} and ${b.name} aren't ${what} at ${ranges(bad, len)}.`, bad.length, { players: [a.id, b.id], slots: bad });
        if (!shared) add(`${a.name} and ${b.name} never play together.`, 1, { players: [a.id, b.id] });
        break;
      }
      case 'apart': {
        const a = byId.get(c.a);
        const b = byId.get(c.b);
        if (!a?.available || !b?.available || a.id === b.id) break;
        const bad: number[] = [];
        for (let s = 0; s < n; s++) {
          const ca = tl[a.id]?.[s];
          const cb = tl[b.id]?.[s];
          if (!ca || !cb) continue;
          if (c.scope === 'pitch' || (roleOf(positions, ca) === roleOf(positions, cb) && roleOf(positions, ca) !== 'GK')) bad.push(s);
        }
        add(
          `${a.name} and ${b.name} are ${c.scope === 'unit' ? 'in the same unit' : 'on the pitch together'} at ${ranges(bad, len)}.`,
          bad.length,
          { players: [a.id, b.id], slots: bad },
        );
        break;
      }
      case 'group_mix': {
        const members = avail.filter((p) => p.group === c.group);
        const low: number[] = [];
        const high: number[] = [];
        let lowAmt = 0;
        let highAmt = 0;
        for (let s = 0; s < n; s++) {
          const k = members.filter((p) => on(p.id, s)).length;
          if (c.min != null && k < c.min) {
            low.push(s);
            lowAmt += c.min - k;
          }
          if (c.max != null && k > c.max) {
            high.push(s);
            highAmt += k - c.max;
          }
        }
        add(`Fewer than ${c.min} ${c.group} players on at ${ranges(low, len)}.`, lowAmt, { slots: low });
        add(`More than ${c.max} ${c.group} players on at ${ranges(high, len)}.`, highAmt, { slots: high });
        break;
      }
      case 'pin': {
        const p = byId.get(c.player);
        if (!p) break;
        const bad: number[] = [];
        for (let s = 0; s < n; s++) {
          if (s * len < c.from || (s + 1) * len > c.to) continue;
          const code = tl[p.id]?.[s] ?? null;
          const ok = c.position === 'BENCH' ? !code : c.position === 'ON' ? !!code : code === c.position;
          if (!ok) bad.push(s);
        }
        add(`Pin not met: ${describeConstraint(c, settings)} (${ranges(bad, len)}).`, bad.length, { players: [p.id], slots: bad });
        break;
      }
    }
  }
  return breaks;
}

export function hardBreaks(breaks: Break[]): Break[] {
  return breaks.filter((b) => b.severity === 'hard');
}

export function softBreaks(breaks: Break[]): Break[] {
  return breaks.filter((b) => b.severity === 'soft');
}

/** Lower is better. Hard breaks count far more than any soft one. */
export function scoreBreaks(breaks: Break[]): number {
  let score = 0;
  for (const b of breaks) score += b.severity === 'hard' ? 1000 * b.amount : WEIGHT_VALUE[b.weight ?? 'medium'] * b.amount;
  return Math.round(score * 1000) / 1000;
}
