import { expect, test } from 'vitest';
import { coachesSetup, idOf } from '../test/helpers';
import { placePlayer, swapCells } from './edit';
import { hardBreaks, validate } from './validate';

test('swapping two players on the pitch for a whole window keeps the rota valid', () => {
  const s = coachesSetup();
  const [milo, cass] = [idOf(s, 'Milo'), idOf(s, 'Cass')];
  const next = swapCells(s.rota!, { player: milo, slot: 2 }, { player: cass, slot: 2 }, [2, 3]);
  expect(next[2].LD).toBe(cass);
  expect(next[3].RD).toBe(milo);
  expect(hardBreaks(validate(next, s.settings, []))).toEqual([]);
  expect(s.rota![2].LD).toBe(milo); // original untouched
});

test('swapping with a bench player subs them on; one slot only breaks the sub rule', () => {
  const s = coachesSetup();
  const [milo, george] = [idOf(s, 'Milo'), idOf(s, 'George')];
  const next = swapCells(s.rota!, { player: milo, slot: 2 }, { player: george, slot: 2 }, [2]);
  expect(next[2].LD).toBe(george);
  expect(next[3].LD).toBe(milo);
  expect(validate(next, s.settings, []).map((b) => b.rule)).toContain('builtin:subs');
});

test('placing a player in a position moves the previous occupant', () => {
  const s = coachesSetup();
  const [george, martha] = [idOf(s, 'George'), idOf(s, 'Martha')];
  const next = placePlayer(s.rota!, george, 'LA', [0, 1]);
  expect(next[0].LA).toBe(george);
  expect(next[0].LD).toBe(martha);
  const benched = placePlayer(s.rota!, george, null, [0]);
  expect(benched[0].LD).toBeNull();
});
