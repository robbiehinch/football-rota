import { expect, test } from 'vitest';
import { coachesSetup } from '../test/helpers';
import { describeSub, substitutions } from './subs';

test('reference rota: substitutions at each change, including mid-quarter ones', () => {
  const { rota, settings } = coachesSetup();
  const name = (id: string) => settings.squad.find((p) => p.id === id)!.name;
  const events = substitutions(rota!, settings);
  expect(events.map((e) => e.minute)).toEqual([5, 10, 20, 30, 35]);
  expect(events.map((e) => e.midQuarter)).toEqual([true, false, false, false, true]);
  expect(events.map((e) => e.quarter)).toEqual([1, 2, 3, 4, 4]);
  expect(describeSub(events[0], name)).toEqual(['Albie on for Joseph (RD)']);
  expect(describeSub(events[1], name)).toEqual([
    'Joseph on for Jake (GK)',
    'Milo on for George (LD)',
    'Alex on for Martha (LA)',
    'Rufus on for Albie (RA)',
    'Cass RA → RD',
  ]);
  expect(describeSub(events[4], name)).toEqual(['Rufus on for Cass (RD)', 'Alex RD → LD']);
});

test('a newcomer is paired through a chain of moves with the player who went off', () => {
  const { rota, settings } = coachesSetup();
  const id = (n: string) => settings.squad.find((p) => p.name === n)!.id;
  const name = (pid: string) => settings.squad.find((p) => p.id === pid)!.name;
  // 0-5 -> 5-10: George (LD) goes off, Martha LA -> LD, Cass RA -> LA, Milo comes on at RA.
  const r = structuredClone(rota!);
  r[1] = { ...r[0], LD: id('Martha'), LA: id('Cass'), RA: id('Milo') };
  const [e] = substitutions(r, settings);
  expect(describeSub(e, name)).toEqual(['Milo on for George (RA)', 'Martha LA → LD', 'Cass RA → LA']);
});
