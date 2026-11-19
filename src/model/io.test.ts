import { expect, test } from 'vitest';
import { coachesSetup, reference } from '../test/helpers';
import { migrateSetup, parseRotaFile, toRotaFile } from './io';
import { newConstraint } from './constraints';
import type { GkShare, SidePref } from './types';

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

test('older setups: a goal-time player list becomes GK ticks; rule sides move onto players', () => {
  const setup = coachesSetup();
  const id = (n: string) => setup.settings.squad.find((p) => p.name === n)!.id;
  const oldGk = { ...(newConstraint('gk_share', setup.settings) as GkShare), players: [id('Jake'), id('Milo')] };
  const oldSide = { ...(newConstraint('side_pref', setup.settings) as SidePref), sides: { [id('Alex')]: 'R' as const } };
  const out = migrateSetup({ ...setup, constraints: [oldGk, oldSide] });
  const by = (n: string) => out.settings.squad.find((p) => p.name === n)!;
  expect(by('Milo').allowed_positions).toContain('GK');
  expect(by('Joseph').allowed_positions).not.toContain('GK'); // was ticked, not on the old list
  expect(by('Jake').gk_only).toBe(true);
  expect(by('Alex').side).toBe('R');
  expect(out.constraints[0]).toMatchObject({ kind: 'gk_share', players: [] });
  expect(out.constraints[1]).not.toHaveProperty('sides');
  // Running it again changes nothing.
  expect(migrateSetup(out)).toEqual(out);
});

test('player sides survive export and import', () => {
  const setup = coachesSetup();
  setup.settings.squad[2].side = 'L';
  const back = parseRotaFile(JSON.parse(JSON.stringify(toRotaFile(setup))));
  expect(back.settings.squad[2].side).toBe('L');
  expect(back.settings.squad[3]).not.toHaveProperty('side');
});
