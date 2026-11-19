import { describe, expect, test } from 'vitest';
import { coachesSetup, idOf } from '../test/helpers';
import { newConstraint } from './constraints';
import { hardBreaks, softBreaks, validate } from './validate';

describe('validate', () => {
  // Acceptance test 1
  test("reference rota has zero hard breaks under the coaches' rules", () => {
    const { rota, settings, constraints } = coachesSetup();
    const breaks = validate(rota!, settings, constraints);
    expect(hardBreaks(breaks)).toEqual([]);
    // ...and it meets every preference too.
    expect(softBreaks(breaks)).toEqual([]);
  });

  test('a change at a closed substitution point is a hard break', () => {
    const setup = coachesSetup();
    const rota = structuredClone(setup.rota!);
    // swap LD and RD in 15-20 only (no subs at 15)
    [rota[3].LD, rota[3].RD] = [rota[3].RD, rota[3].LD];
    const breaks = validate(rota, setup.settings, setup.constraints);
    expect(breaks.some((b) => b.rule === 'builtin:subs' && b.severity === 'hard')).toBe(true);
  });

  test('keeper change at 5 breaks the GK rule; GK-only player outfield breaks allowed positions', () => {
    const setup = coachesSetup();
    const rota = structuredClone(setup.rota!);
    // 5-10: Jake (GK-only) and George swap GK/LD.
    [rota[1].GK, rota[1].LD] = [rota[1].LD, rota[1].GK];
    const rules = validate(rota, setup.settings, []).map((b) => b.rule);
    expect(rules).toContain('builtin:gk_fixed');
    expect(rules).toContain('builtin:allowed');
  });

  test('empty cells, double-booking and unavailable players are hard breaks', () => {
    const setup = coachesSetup();
    const rota = structuredClone(setup.rota!);
    rota[0].LD = null;
    rota[2].RA = rota[2].LD; // Milo twice
    setup.settings.squad.find((p) => p.name === 'Cass')!.available = false;
    const rules = validate(rota, setup.settings, []).map((b) => b.rule);
    expect(rules).toEqual(expect.arrayContaining(['builtin:fill', 'builtin:double', 'builtin:available']));
  });

  test('soft rules are reported in amber with plain-English messages', () => {
    const setup = coachesSetup();
    const c = { ...newConstraint('max_bench', setup.settings), mode: 'soft' as const, maxMinutes: 15 };
    const breaks = validate(setup.rota!, setup.settings, [c]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].severity).toBe('soft');
    expect(breaks[0].message).toBe('Jake sits out 20 min in a row (limit 15).');
  });

  test('keep apart / play together on the reference rota', () => {
    const setup = coachesSetup();
    const apart = { ...newConstraint('apart', setup.settings), a: idOf(setup, 'Jake'), b: idOf(setup, 'Martha') };
    const together = { ...newConstraint('together', setup.settings), a: idOf(setup, 'George'), b: idOf(setup, 'Martha') };
    const msgs = validate(setup.rota!, setup.settings, [apart, together]).map((b) => b.message);
    expect(msgs).toEqual(['Jake and Martha are on the pitch together at 0–10.']);
  });
});
