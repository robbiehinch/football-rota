import loadHighs from 'highs';
import referenceJson from '../../rota.json';
import { PRESETS } from '../model/constraints';
import { parseRotaFile, type RotaFile, type Setup } from '../model/io';
import type { HighsLike } from '../solver/solve';

let highs: HighsLike | null = null;
export async function getHighs(): Promise<HighsLike> {
  if (!highs) highs = (await loadHighs()) as unknown as HighsLike;
  return highs;
}

export const reference = referenceJson as RotaFile & {
  summary_check: Record<string, { total_min: number; by_role_min: Record<string, number>; by_position_min: Record<string, number> }>;
};

/** rota.json + the "Coaches' current rules" preset. */
export function coachesSetup(): Setup {
  const setup = parseRotaFile(reference);
  const preset = PRESETS.find((p) => p.id === 'coaches')!.build(setup.settings);
  setup.settings.match = { ...setup.settings.match, ...preset.match };
  setup.constraints = preset.constraints;
  return setup;
}

export const idOf = (setup: Setup, name: string) => setup.settings.squad.find((p) => p.name === name)!.id;
