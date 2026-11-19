/// <reference lib="webworker" />
import loadHighs from 'highs';
import wasmUrl from 'highs/runtime?url';
import type { Constraint, Settings } from '../model/types';
import { generate, type GenerateOptions, type HighsLike, type SolveResult } from './solve';

export interface SolveRequest {
  id: number;
  settings: Settings;
  constraints: Constraint[];
  opts: GenerateOptions;
}
export interface SolveResponse {
  id: number;
  result: SolveResult;
  ms: number;
}

let highs: Promise<HighsLike> | null = null;

self.onmessage = async (e: MessageEvent<SolveRequest | { warmUp: true }>) => {
  if ('warmUp' in e.data) {
    highs ??= loadHighs({ locateFile: () => wasmUrl }) as unknown as Promise<HighsLike>;
    return;
  }
  const { id, settings, constraints, opts } = e.data;
  const t0 = performance.now();
  let result: SolveResult;
  try {
    highs ??= loadHighs({ locateFile: () => wasmUrl }) as unknown as Promise<HighsLike>;
    result = generate(await highs, settings, constraints, opts);
  } catch (err) {
    highs = null; // reload the solver next time
    result = { status: 'error', message: `The solver failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  (self as unknown as Worker).postMessage({ id, result, ms: performance.now() - t0 } satisfies SolveResponse);
};
