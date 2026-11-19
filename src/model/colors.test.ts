import { expect, test } from 'vitest';
import { coachesSetup } from '../test/helpers';
import { minutesColors } from './colors';
import { playerStats } from './stats';

test('players are coloured by minutes played, most minutes first', () => {
  const { rota, settings } = coachesSetup();
  const stats = playerStats(rota!, settings);
  const totals = Object.fromEntries(Object.values(stats).map((s) => [s.id, s.total]));
  const { byPlayer, key } = minutesColors(totals);
  expect(key.map((k) => [k.minutes, k.colorName, k.players.length])).toEqual([
    [25, 'Blue', 4],
    [20, 'Yellow', 5],
  ]);
  const id = (n: string) => settings.squad.find((p) => p.name === n)!.id;
  expect(byPlayer[id('Joseph')]).toBe(byPlayer[id('Cass')]);
  expect(byPlayer[id('Jake')]).not.toBe(byPlayer[id('Joseph')]);
});
