import { describe, expect, test } from 'vitest';
import { newConstraint } from '../model/constraints';
import { timelines } from '../model/stats';
import type { Constraint, Rotate, SidePref } from '../model/types';
import { hardBreaks, scoreBreaks, validate } from '../model/validate';
import { coachesSetup, getHighs, idOf } from '../test/helpers';
import { buildModel } from './model';
import { generate } from './solve';

const sideOf = (code: string | null) => (code ? ({ GK: 'C', LD: 'L', LA: 'L', RD: 'R', RA: 'R' } as Record<string, string>)[code] : null);

describe('rotate positions', () => {
  test('reference rota: who stays in the same position through a sub', () => {
    const s = coachesSetup();
    const c = newConstraint('rotate', s.settings) as Rotate;
    const msgs = validate(s.rota!, s.settings, [c]).map((b) => b.message);
    expect(msgs).toEqual([
      'Albie stays in the same position through the sub at 35 (RA) min.',
      'Cass stays in the same position through the sub at 5 (RA) min.',
      'Milo stays in the same position through the sub at 35 (LA) min.',
      'George stays in the same position through the sub at 5 (LD) min.',
      'Martha stays in the same position through the sub at 5 (LA) min.',
    ]);
  });

  test('as a must: everyone staying on through a sub changes outfield position', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    const rotate = { ...(newConstraint('rotate', s.settings) as Rotate), mode: 'hard' } as Constraint;
    const cs = [...s.constraints.filter((c) => c.kind !== 'position_stability'), rotate];
    const res = generate(highs, s.settings, cs, { count: 3 });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    for (const o of res.options) {
      expect(hardBreaks(o.breaks)).toEqual([]);
      const tl = timelines(o.rota, s.settings);
      for (const line of Object.values(tl))
        for (const minute of s.settings.match.sub_points) {
          const i = minute / 5;
          if (line[i - 1] && line[i - 1] !== 'GK') expect(line[i]).not.toBe(line[i - 1]);
        }
    }
  });
});

describe('preferred side', () => {
  test('validator counts minutes on the wrong side', () => {
    const s = coachesSetup();
    const c = { ...(newConstraint('side_pref', s.settings) as SidePref), sides: { [idOf(s, 'Cass')]: 'L' as const } };
    // Cass: RA 0-10, RD 10-20, LD 30-35 -> 20 min on the right
    expect(validate(s.rota!, s.settings, [c]).map((b) => b.message)).toEqual(['Cass plays 20 min on the right (prefers left).']);
  });

  test('as a must: players never play on the other side', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    const sides = { [idOf(s, 'Milo')]: 'L' as const, [idOf(s, 'Alex')]: 'R' as const, [idOf(s, 'George')]: 'L' as const };
    const c = { ...(newConstraint('side_pref', s.settings) as SidePref), mode: 'hard', sides } as Constraint;
    const res = generate(highs, s.settings, [...s.constraints, c], { count: 3 });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    for (const o of res.options) {
      expect(hardBreaks(o.breaks)).toEqual([]);
      const tl = timelines(o.rota, s.settings);
      for (const [pid, side] of Object.entries(sides))
        for (const code of tl[pid]) if (code && code !== 'GK') expect(sideOf(code)).toBe(side);
    }
  });

  test('soft rotate + side preference: solver objective equals the validator score', async () => {
    const highs = await getHighs();
    const s = coachesSetup();
    const sides = Object.fromEntries(s.settings.squad.map((p, i) => [p.id, i % 2 ? 'L' : 'R'])) as Record<string, 'L' | 'R'>;
    const cs: Constraint[] = [
      ...s.constraints,
      { ...(newConstraint('rotate', s.settings) as Rotate), weight: 'high' },
      { ...(newConstraint('side_pref', s.settings) as SidePref), sides, weight: 'low' },
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
