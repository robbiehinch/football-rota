import { expect, test } from 'vitest';
import { newConstraint } from './constraints';
import { cellsChanged, lockKey, lockPins } from './locks';
import { swapCells } from './edit';
import type { MaxOn } from './types';
import { hardBreaks, validate } from './validate';
import { countRotas, generate } from '../solver/solve';
import { coachesSetup, getHighs, idOf } from '../test/helpers';

test('locked cells become pins, merging runs in the same spot', () => {
  const s = coachesSetup();
  const jake = idOf(s, 'Jake');
  const pins = lockPins(s.rota!, [lockKey(0, jake), lockKey(1, jake), lockKey(2, jake), lockKey(7, jake)], s.settings);
  expect(pins.map((p) => [p.position, p.from, p.to])).toEqual([
    ['GK', 0, 10],
    ['BENCH', 10, 15],
    ['GK', 35, 40],
  ]);
});

test('rebalance: keep locked cells, fix the rest, change as little as possible', async () => {
  const highs = await getHighs();
  const s = coachesSetup();
  // Coach swaps George (bench) on for Milo at LD, 10-20. George now has 30 min, Milo 10.
  const [george, milo] = [idOf(s, 'George'), idOf(s, 'Milo')];
  const edited = swapCells(s.rota!, { player: george, slot: 2 }, { player: milo, slot: 2 }, [2, 3]);
  expect(hardBreaks(validate(edited, s.settings, s.constraints)).length).toBeGreaterThan(0);
  const locks = [2, 3].flatMap((slot) => [lockKey(slot, george), lockKey(slot, milo)]);
  const pins = lockPins(edited, locks, s.settings);
  const res = generate(highs, s.settings, [...s.constraints, ...pins], { count: 1, prefer: edited });
  expect(res.status).toBe('ok');
  if (res.status !== 'ok') return;
  const out = res.options[0].rota;
  expect(hardBreaks(validate(out, s.settings, s.constraints))).toEqual([]);
  expect([out[2].LD, out[3].LD]).toEqual([george, george]);
  expect(Object.values(out[2])).not.toContain(milo);
  // Closer to the edited rota than a fresh solve would be.
  const fresh = generate(highs, s.settings, [...s.constraints, ...pins], { count: 1 });
  expect(fresh.status).toBe('ok');
  if (fresh.status === 'ok') expect(cellsChanged(edited, out)).toBeLessThanOrEqual(cellsChanged(edited, fresh.options[0].rota));
});

test('a lock that clashes with the rules is explained', async () => {
  const highs = await getHighs();
  const s = coachesSetup();
  const cass = idOf(s, 'Cass');
  // Lock Cass on from 0 to 30 while nobody may play more than 20 in a row.
  const locks = [0, 1, 2, 3, 4, 5].map((slot) => lockKey(slot, cass));
  const rota = structuredClone(s.rota!);
  for (const slot of [4, 5]) rota[slot].RD = cass; // Cass on at RD 20-30 too (Albie off)
  const maxOn = { ...(newConstraint('max_on', s.settings) as MaxOn), maxMinutes: 20 };
  const res = generate(highs, s.settings, [...s.constraints, maxOn, ...lockPins(rota, locks, s.settings)], { count: 1, prefer: rota });
  expect(res.status).toBe('infeasible');
  if (res.status === 'infeasible') {
    expect(res.conflicts.some((c) => c.label.startsWith('Locked: Cass'))).toBe(true);
    expect(res.conflicts.map((c) => c.label)).toContain('Nobody plays more than 20 min in a row');
  }
});

test('counting: a fully locked rota counts exactly 1; a cap gives a lower bound', async () => {
  const highs = await getHighs();
  const s = coachesSetup();
  const all = s.rota!.flatMap((_, i) => s.settings.squad.map((p) => lockKey(i, p.id)));
  const one = countRotas(highs, s.settings, [...s.constraints, ...lockPins(s.rota!, all, s.settings)], { budget: 10 });
  expect(one).toMatchObject({ count: 1, exact: true });
  const capped = countRotas(highs, s.settings, s.constraints, { limit: 5, budget: 10 });
  expect(capped).toMatchObject({ count: 5, exact: false, stoppedBy: 'limit' });
});
