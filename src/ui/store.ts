import { useEffect, useState } from 'react';
import referenceJson from '../../rota.json';
import { PRESETS } from '../model/constraints';
import { parseRotaFile, type RotaFile, type Setup } from '../model/io';
import { slotCount } from '../model/match';
import type { Rota } from '../model/types';

const KEY = 'rota-builder:v1';

export const reference = referenceJson as RotaFile;

/** First run: the coaches' current squad, rules and rota. */
export function defaultSetup(): Setup {
  const setup = parseRotaFile(reference);
  const preset = PRESETS[0].build(setup.settings);
  setup.settings.match = { ...setup.settings.match, ...preset.match };
  setup.constraints = preset.constraints;
  return setup;
}

function load(): Setup {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Setup;
      if (s?.settings?.squad && s.settings.match && Array.isArray(s.constraints)) return s;
    }
  } catch {
    /* storage blocked or corrupt: fall back to defaults */
  }
  return defaultSetup();
}

export function usePersistentSetup() {
  const [setup, setSetup] = useState<Setup>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(setup));
    } catch {
      /* ignore */
    }
  }, [setup]);
  return [setup, setSetup] as const;
}

export function rotaFits(rota: Rota | null, setup: Setup): rota is Rota {
  return !!rota && rota.length === slotCount(setup.settings.match);
}
