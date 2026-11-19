import { describe, expect, test } from 'vitest';
import { coachesSetup, reference } from '../test/helpers';
import { lineupWindows, playerStats } from './stats';

describe('player stats (Shifts view)', () => {
  // Acceptance test 5
  test('minutes and role totals match summary_check in rota.json', () => {
    const setup = coachesSetup();
    const stats = playerStats(setup.rota!, setup.settings);
    for (const [name, check] of Object.entries(reference.summary_check)) {
      const id = setup.settings.squad.find((p) => p.name === name)!.id;
      expect(stats[id].total, name).toBe(check.total_min);
      expect(stats[id].byRole, name).toEqual(check.by_role_min);
      expect(stats[id].byPosition, name).toEqual(check.by_position_min);
    }
  });

  test('spells and longest bench spell', () => {
    const setup = coachesSetup();
    const stats = playerStats(setup.rota!, setup.settings);
    const by = (n: string) => stats[setup.settings.squad.find((p) => p.name === n)!.id];
    expect(by('Jake').spells).toBe(2);
    expect(by('Jake').longestBench).toBe(20);
    expect(by('Cass').spells).toBe(2); // 0-20, 30-35
    expect(by('Cass').longestBench).toBe(10);
    expect(by('Albie').spells).toBe(2); // 5-10, 20-40
  });

  test('by-time windows follow line-up changes', () => {
    const setup = coachesSetup();
    const ws = lineupWindows(setup.rota!, setup.settings).map((w) => `${w.start}-${w.end}`);
    expect(ws).toEqual(['0-5', '5-10', '10-20', '20-30', '30-35', '35-40']);
  });
});
