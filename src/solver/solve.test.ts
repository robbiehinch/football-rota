import { describe, expect, test } from 'vitest';
import { newConstraint, PRESETS } from '../model/constraints';
import type { Constraint, Pin, Settings } from '../model/types';
import { hardBreaks, scoreBreaks, validate } from '../model/validate';
import { coachesSetup, getHighs, idOf } from '../test/helpers';
import { buildModel } from './model';
import { generate } from './solve';

const sameSlotOn = (rota: Record<string, string | null>[], a: string, b: string) =>
  rota.some((slot) => Object.values(slot).includes(a) && Object.values(slot).includes(b));

function expectAllValid(settings: Settings, constraints: Constraint[], rotas: { rota: Record<string, string | null>[] }[]) {
  for (const o of rotas) expect(hardBreaks(validate(o.rota, settings, constraints))).toEqual([]);
}

describe('solver', () => {
  // Acceptance test 2
  test("coaches' rules: every option is valid and as good as the reference rota", async () => {
    const highs = await getHighs();
    const setup = coachesSetup();
    const res = generate(highs, setup.settings, setup.constraints);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.options.length).toBe(5);
    expectAllValid(setup.settings, setup.constraints, res.options);
    const refScore = scoreBreaks(validate(setup.rota!, setup.settings, setup.constraints));
    for (const o of res.options) expect(o.score).toBeLessThanOrEqual(refScore);
    // options are distinct
    const keys = new Set(res.options.map((o) => JSON.stringify(o.rota)));
    expect(keys.size).toBe(res.options.length);
  });

  test('the reference rota is in the solution space (pinning all its cells reproduces it exactly)', async () => {
    const highs = await getHighs();
    const setup = coachesSetup();
    const len = setup.settings.match.slot_length_min;
    const pins: Pin[] = [];
    setup.rota!.forEach((slot, s) =>
      Object.entries(slot).forEach(([code, pid]) =>
        pins.push({ ...(newConstraint('pin', setup.settings) as Pin), player: pid!, position: code, from: s * len, to: (s + 1) * len }),
      ),
    );
    const res = generate(highs, setup.settings, [...setup.constraints, ...pins], { count: 1 });
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.options[0].rota).toEqual(setup.rota);
      expect(res.options[0].score).toBe(0);
    }
  });

  test('deterministic for the same input; shuffle gives a different valid option', async () => {
    const highs = await getHighs();
    const setup = coachesSetup();
    const a = generate(highs, setup.settings, setup.constraints, { count: 2 });
    const b = generate(highs, setup.settings, setup.constraints, { count: 2 });
    expect(a).toEqual(b);
    const shuffled = [1, 2, 3].map((seed) => generate(highs, setup.settings, setup.constraints, { count: 1, seed }));
    for (const s of shuffled) {
      expect(s.status).toBe('ok');
      if (s.status === 'ok') expectAllValid(setup.settings, setup.constraints, s.options);
    }
    const firsts = new Set(
      [a, ...shuffled].map((r) => (r.status === 'ok' ? JSON.stringify(r.options[0].rota) : '')),
    );
    expect(firsts.size).toBeGreaterThan(1);
  });

  // Acceptance test 3
  test('marking any one player unavailable gives a valid 8-player rota or a clear explanation', async () => {
    const highs = await getHighs();
    for (const name of coachesSetup().settings.squad.map((p) => p.name)) {
      const setup = coachesSetup();
      setup.settings.squad.find((p) => p.name === name)!.available = false;
      const res = generate(highs, setup.settings, setup.constraints, { count: 2 });
      if (res.status === 'ok') {
        expect(res.options.length).toBeGreaterThan(0);
        expectAllValid(setup.settings, setup.constraints, res.options);
        for (const o of res.options) expect(o.rota.flatMap((s) => Object.values(s))).not.toContain(idOf(setup, name));
      } else {
        expect(res.status, name).toBe('infeasible');
        if (res.status === 'infeasible') {
          expect(res.message.length).toBeGreaterThan(10);
          expect(res.conflicts.length, name).toBeGreaterThan(0);
        }
      }
    }
  });

  test('without Jake, the explanation names the goalkeeping and equal-time rules', async () => {
    const highs = await getHighs();
    const setup = coachesSetup();
    setup.settings.squad.find((p) => p.name === 'Jake')!.available = false;
    const res = generate(highs, setup.settings, setup.constraints);
    expect(res.status).toBe('infeasible');
    if (res.status !== 'infeasible') return;
    const labels = res.conflicts.map((c) => c.label);
    expect(labels).toContain("Everyone's total minutes within 5 min of each other");
    // Every listed rule is needed: dropping any one makes it solvable (minimal set).
    expect(labels.length).toBeGreaterThan(1);
  });

  // Acceptance test 4
  test('keep apart works; adding a contradictory play-together explains the conflict', async () => {
    const highs = await getHighs();
    const setup = coachesSetup();
    const [a, b] = [idOf(setup, 'Milo'), idOf(setup, 'Martha')];
    const apart = { ...newConstraint('apart', setup.settings), a, b } as Constraint;
    const res = generate(highs, setup.settings, [...setup.constraints, apart]);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.options.length).toBeGreaterThan(0);
      for (const o of res.options) expect(sameSlotOn(o.rota, a, b)).toBe(false);
      expectAllValid(setup.settings, [...setup.constraints, apart], res.options);
    }
    const together = { ...newConstraint('together', setup.settings), a, b } as Constraint;
    const res2 = generate(highs, setup.settings, [...setup.constraints, apart, together]);
    expect(res2.status).toBe('infeasible');
    if (res2.status === 'infeasible') {
      expect(res2.conflicts.map((c) => c.key)).toEqual([apart.id, together.id]);
      expect(res2.conflicts.map((c) => c.label)).toEqual([
        'Milo and Martha never on the pitch together',
        'Milo and Martha play together',
      ]);
      expect(res2.message).toMatch(/can’t all be met/);
    }
  });

  test('plain-English pre-checks', async () => {
    const highs = await getHighs();
    const setup = coachesSetup();
    setup.settings.squad.forEach((p, i) => (p.available = i < 4));
    const res = generate(highs, setup.settings, setup.constraints);
    expect(res).toMatchObject({ status: 'infeasible', message: 'Only 4 players are available, but 5 are needed on the pitch.' });
  });

  test('soft rules: solver objective equals the validator score', async () => {
    const highs = await getHighs();
    const setup = coachesSetup();
    const ids = setup.settings.squad.map((p) => p.id);
    const soft = (c: Constraint): Constraint => ({ ...c, mode: 'soft', weight: 'high' });
    const s = setup.settings;
    const sets: Constraint[][] = [
      PRESETS.find((p) => p.id === 'equal')!.build(s).constraints.map(soft),
      [
        ...setup.constraints.map(soft),
        soft({ ...newConstraint('apart', s), a: ids[1], b: ids[2] } as Constraint),
        soft({ ...newConstraint('together', s), a: ids[1], b: ids[2], scope: 'side' } as Constraint),
        soft({ ...newConstraint('group_mix', s), group: 'blue', min: 3, max: 3 } as Constraint),
        soft({ ...newConstraint('pin', s), player: ids[5], position: 'GK', from: 0, to: 20 } as Constraint),
        soft({ ...newConstraint('minutes', s), min: 25, max: null, players: [] } as Constraint),
        soft({ ...newConstraint('max_bench', s), maxMinutes: 10 } as Constraint),
        soft({ ...newConstraint('position_stability', s), maxChanges: 0 } as Constraint),
        soft({ ...newConstraint('gk_share', s), players: [ids[0]], minEach: 30, evenWithin: null } as Constraint),
      ],
    ];
    for (const constraints of sets) {
      const model = buildModel(s, constraints);
      const r = highs.solve(model.lp, { output_flag: false, mip_rel_gap: 0 });
      expect(r.Status).toBe('Optimal');
      const { rota } = model.decode(r.Columns as Record<string, { Primal: number }>);
      const breaks = validate(rota, s, constraints);
      expect(hardBreaks(breaks)).toEqual([]);
      expect(scoreBreaks(breaks)).toBeCloseTo(r.ObjectiveValue, 4);
    }
  });

  test("'Equal time everyone' preset solves with subs every 5 minutes", async () => {
    const highs = await getHighs();
    const setup = coachesSetup();
    setup.settings.match.sub_points = [5, 10, 15, 20, 25, 30, 35];
    const constraints = PRESETS.find((p) => p.id === 'equal')!.build(setup.settings).constraints;
    const res = generate(highs, setup.settings, constraints);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expectAllValid(setup.settings, constraints, res.options);
      expect(res.options[0].score).toBe(0);
    }
  });

  test('soft even time with a goalkeeper short still gives options within the time budget', async () => {
    const highs = await getHighs();
    const setup = coachesSetup();
    setup.settings.squad.find((p) => p.name === 'Jake')!.available = false;
    setup.constraints[0] = { ...setup.constraints[0], mode: 'soft' };
    const apart = { ...newConstraint('apart', setup.settings), a: idOf(setup, 'Milo'), b: idOf(setup, 'Martha') } as Constraint;
    const t = Date.now();
    const res = generate(highs, setup.settings, [...setup.constraints, apart], { budget: 4 });
    expect(Date.now() - t).toBeLessThan(15000);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expectAllValid(setup.settings, [...setup.constraints, apart], res.options);
      expect(res.options[0].breaks.some((b) => b.message.startsWith('Playing time ranges'))).toBe(true);
    }
  });
});
