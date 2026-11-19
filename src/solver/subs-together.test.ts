import { describe, expect, test } from 'vitest';
import { newConstraint } from '../model/constraints';
import { substitutions } from '../model/subs';
import type { Constraint, MinSubs, TogetherTime } from '../model/types';
import { hardBreaks, scoreBreaks, validate } from '../model/validate';
import { coachesSetup, getHighs, idOf } from '../test/helpers';
import { buildModel } from './model';
import { generate } from './solve';

const comers = (rota: Record<string, string | null>[], s: number) =>
  Object.values(rota[s]).filter((id) => id && !Object.values(rota[s - 1]).includes(id)).length;

describe('substitutions per change', () => {
  test('reference rota: who comes on at each sub point', () => {
    const s = coachesSetup();
    const c = { ...(newConstraint('min_subs', s.settings) as MinSubs), perPoint: 2 };
    expect(validate(s.rota!, s.settings, [c]).map((b) => b.message)).toEqual([
      'Only 1 player comes on at 5 min (2 wanted).',
      'Only 1 player comes on at 35 min (2 wanted).',
    ]);
  });

  test('as a must: at least 2 players come on at every sub point', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    const c = { ...(newConstraint('min_subs', s.settings) as MinSubs), mode: 'hard', perPoint: 2 } as Constraint;
    const res = generate(highs, s.settings, [...s.constraints, c], { count: 3 });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    for (const o of res.options) {
      expect(hardBreaks(o.breaks)).toEqual([]);
      for (const minute of s.settings.match.sub_points) expect(comers(o.rota, minute / 5)).toBeGreaterThanOrEqual(2);
    }
  });

  test('as a preference with a high target: more substitutions than without it', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    s.settings.match.sub_points = [5, 10, 15, 20, 25, 30, 35];
    const total = (rota: Record<string, string | null>[]) => substitutions(rota, s.settings).reduce((n, e) => n + e.swaps.length + e.on.length, 0);
    const base = generate(highs, s.settings, s.constraints, { count: 1 });
    const max = { ...(newConstraint('min_subs', s.settings) as MinSubs), perPoint: 5, weight: 'high' } as Constraint;
    const more = generate(highs, s.settings, [...s.constraints, max], { count: 1 });
    expect(base.status).toBe('ok');
    expect(more.status).toBe('ok');
    if (base.status === 'ok' && more.status === 'ok') {
      expect(hardBreaks(more.options[0].breaks)).toEqual([]);
      expect(total(more.options[0].rota)).toBeGreaterThan(total(base.options[0].rota));
    }
  });
});

describe('time together', () => {
  test('reference rota: George and Martha share 20 min; Milo and Martha none', () => {
    const s = coachesSetup();
    const tt = (names: string[], minMinutes: number) =>
      ({ ...(newConstraint('together_time', s.settings) as TogetherTime), players: names.map((n) => idOf(s, n)), minMinutes }) as Constraint;
    expect(validate(s.rota!, s.settings, [tt(['George', 'Martha'], 20)])).toEqual([]);
    expect(validate(s.rota!, s.settings, [tt(['Milo', 'Martha'], 10)]).map((b) => b.message)).toEqual([
      'Milo and Martha are on together for 0 min (at least 10 wanted).',
    ]);
  });

  test('as a must: three friends share at least 10 minutes', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    const ids = ['Milo', 'Martha', 'Alex'].map((n) => idOf(s, n));
    const c = { ...(newConstraint('together_time', s.settings) as TogetherTime), players: ids, minMinutes: 10 } as Constraint;
    const res = generate(highs, s.settings, [...s.constraints, c], { count: 3 });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    for (const o of res.options) {
      expect(hardBreaks(o.breaks)).toEqual([]);
      const together = o.rota.filter((slot) => ids.every((id) => Object.values(slot).includes(id))).length * 5;
      expect(together).toBeGreaterThanOrEqual(10);
    }
  });

  test('soft versions: solver objective equals the validator score', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    const cs: Constraint[] = [
      ...s.constraints,
      { ...(newConstraint('min_subs', s.settings) as MinSubs), perPoint: 5 },
      { ...(newConstraint('together_time', s.settings) as TogetherTime), mode: 'soft', players: ['Milo', 'Martha', 'Albie', 'Cass'].map((n) => idOf(s, n)), minMinutes: 30 },
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
