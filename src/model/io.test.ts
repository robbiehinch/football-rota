import { expect, test } from 'vitest';
import { coachesSetup, reference } from '../test/helpers';
import { parseRotaFile, toRotaFile } from './io';

test('importing rota.json infers GK permissions and sub points', () => {
  const { settings, rota } = parseRotaFile(reference);
  const by = (n: string) => settings.squad.find((p) => p.name === n)!;
  expect(by('Jake').gk_only).toBe(true);
  expect(by('Joseph').allowed_positions).toContain('GK');
  expect(by('Milo').allowed_positions).not.toContain('GK');
  expect(settings.match.sub_points).toEqual([5, 10, 20, 30, 35]);
  expect(settings.match.gk_change_points).toEqual([10, 20, 30]);
  expect(rota).toHaveLength(8);
});

test('export → import round-trips squad, settings, rules and rota', () => {
  const setup = coachesSetup();
  setup.settings.squad[3].available = false;
  const file = JSON.parse(JSON.stringify(toRotaFile(setup)));
  // Same top-level shape as rota.json
  expect(Object.keys(file)).toEqual(expect.arrayContaining(['description', 'match', 'positions', 'squad', 'rota']));
  expect(file.rota[0].assignments).toEqual(reference.rota![0].assignments);
  const back = parseRotaFile(file);
  expect(back.settings).toEqual(setup.settings);
  expect(back.constraints).toEqual(setup.constraints);
  expect(back.rota).toEqual(setup.rota);
});
