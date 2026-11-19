import { describe, expect, test } from 'vitest';
import { describeConstraint, newConstraint } from '../model/constraints';
import { playerStats } from '../model/stats';
import type { Constraint, GkPlan, MaxOn, Spells } from '../model/types';
import { hardBreaks, scoreBreaks, validate } from '../model/validate';
import { coachesSetup, getHighs, idOf } from '../test/helpers';
import { buildModel } from './model';
import { generate } from './solve';

const plan = (setup: ReturnType<typeof coachesSetup>, keepers: Record<string, string>): GkPlan => ({
  ...(newConstraint('gk_plan', setup.settings) as GkPlan),
  keepers: Object.fromEntries(Object.entries(keepers).map(([k, name]) => [k, name ? idOf(setup, name) : ''])),
});

describe('goalkeeper plan', () => {
  test('reference rota matches its own plan; a different plan is a hard break', () => {
    const s = coachesSetup();
    const ok = plan(s, { 0: 'Jake', 10: 'Joseph', 20: 'Rufus', 30: 'Jake' });
    expect(describeConstraint(ok, s.settings)).toBe('In goal: Jake 0–10, Joseph 10–20, Rufus 20–30, Jake 30–40');
    expect(validate(s.rota!, s.settings, [ok])).toEqual([]);
    const other = plan(s, { 0: 'Rufus' });
    const breaks = validate(s.rota!, s.settings, [other]);
    expect(breaks.map((b) => b.message)).toEqual(['Rufus should be in goal 0–10 (not at 0–10).']);
  });

  test('solver follows the plan, leaving blank blocks to choose', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    // 20-30 is left blank: the goalkeeper list forces Joseph in.
    const c = plan(s, { 0: 'Jake', 10: 'Rufus', 20: '', 30: 'Jake' });
    const res = generate(highs, s.settings, [...s.constraints, c], { count: 3 });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    for (const o of res.options) {
      expect(hardBreaks(o.breaks)).toEqual([]);
      expect(o.rota.map((slot) => s.settings.squad.find((p) => p.id === slot.GK)!.name)).toEqual([
        'Jake', 'Jake', 'Rufus', 'Rufus', 'Joseph', 'Joseph', 'Jake', 'Jake',
      ]);
    }
  });

  test('a plan that clashes with the goalkeeper list is explained', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    // Jake in goal all match leaves no goal time for Joseph and Rufus (each needs 10 min).
    const c = plan(s, { 0: 'Jake', 10: 'Jake', 20: 'Jake', 30: 'Jake' });
    const res = generate(highs, s.settings, [...s.constraints, c]);
    expect(res.status).toBe('infeasible');
    if (res.status === 'infeasible') expect(res.conflicts.map((x) => x.key)).toContain(c.id);
  });
});

describe('times on the pitch and max time on in a row', () => {
  test('reference rota: everyone has 2 spells, longest spell on is 20 min', () => {
    const s = coachesSetup();
    const stats = playerStats(s.rota!, s.settings);
    expect(Object.values(stats).map((x) => x.spells)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(Math.max(...Object.values(stats).map((x) => x.longestOn))).toBe(20);
    const max1 = { ...(newConstraint('spells', s.settings) as Spells), min: null, max: 1 };
    expect(validate(s.rota!, s.settings, [max1]).length).toBe(9);
    const on15 = { ...(newConstraint('max_on', s.settings) as MaxOn), maxMinutes: 15 };
    expect(validate(s.rota!, s.settings, [on15]).map((b) => b.message)).toEqual([
      'Joseph plays 20 min in a row (limit 15).',
      'Rufus plays 20 min in a row (limit 15).',
      'Albie plays 20 min in a row (limit 15).',
      'Cass plays 20 min in a row (limit 15).',
    ]);
  });

  test('solver respects "come on at most twice" and "at most 15 min in a row"', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    // With no subs at 15 or 25 a 15-minute limit is impossible, so open every 5 minutes.
    s.settings.match.sub_points = [5, 10, 15, 20, 25, 30, 35];
    const extra: Constraint[] = [
      { ...(newConstraint('spells', s.settings) as Spells), min: 1, max: 2 },
      { ...(newConstraint('max_on', s.settings) as MaxOn), maxMinutes: 15 },
    ];
    const cs = [...s.constraints, ...extra];
    const res = generate(highs, s.settings, cs, { count: 3 });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    for (const o of res.options) {
      expect(hardBreaks(o.breaks)).toEqual([]);
      const stats = Object.values(playerStats(o.rota, s.settings));
      expect(Math.max(...stats.map((x) => x.spells))).toBeLessThanOrEqual(2);
      expect(Math.max(...stats.map((x) => x.longestOn))).toBeLessThanOrEqual(15);
    }
  });

  test('exactly one spell each, with subs every 5 minutes', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    s.settings.match.sub_points = [5, 10, 15, 20, 25, 30, 35];
    s.settings.match.gk_change_points = [5, 10, 15, 20, 25, 30, 35];
    const once = { ...(newConstraint('spells', s.settings) as Spells), min: 1, max: 1 };
    const res = generate(highs, s.settings, [once], { count: 2 });
    expect(res.status).toBe('ok');
    if (res.status === 'ok')
      for (const o of res.options) expect(Object.values(playerStats(o.rota, s.settings)).every((x) => x.spells === 1)).toBe(true);
  });

  test('soft versions: solver objective equals the validator score', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    const soft = (c: Constraint): Constraint => ({ ...c, mode: 'soft', weight: 'medium' });
    const cs = [
      ...s.constraints,
      soft({ ...(newConstraint('spells', s.settings) as Spells), min: 3, max: 3 }),
      soft({ ...(newConstraint('max_on', s.settings) as MaxOn), maxMinutes: 5 }),
      soft(plan(s, { 0: 'Milo', 20: 'Jake' })),
    ];
    const model = buildModel(s.settings, cs);
    const r = highs.solve(model.lp, { output_flag: false, mip_rel_gap: 0, time_limit: 60 });
    expect(r.Status).toBe('Optimal');
    const { rota } = model.decode(r.Columns as Record<string, { Primal: number }>);
    const breaks = validate(rota, s.settings, cs);
    expect(hardBreaks(breaks)).toEqual([]);
    expect(scoreBreaks(breaks)).toBeCloseTo(r.ObjectiveValue, 4);
  });
});

test('a 15-minute limit with no subs at 15 or 25 is explained', async () => {
  const highs = await getHighs();
  const s = coachesSetup();
  const c = { ...(newConstraint('max_on', s.settings) as MaxOn), maxMinutes: 15 };
  const res = generate(highs, s.settings, [...s.constraints, c]);
  expect(res.status).toBe('infeasible');
  if (res.status === 'infeasible')
    expect(res.conflicts.map((x) => x.label)).toEqual(['Nobody plays more than 15 min in a row', 'Subs only at 5/10/20/30/35 min']);
});
