/// <reference lib="webworker" />
import loadHighs from 'highs';
import wasmUrl from 'highs/runtime?url';
import type { Constraint, Settings } from '../model/types';
import { countRotas, generate, type CountOptions, type CountResult, type GenerateOptions, type HighsLike, type SolveResult } from './solve';

export type WorkerRequest =
  | { kind: 'warmUp' }
  | { kind: 'solve'; id: number; settings: Settings; constraints: Constraint[]; opts: GenerateOptions }
  | { kind: 'count'; id: number; settings: Settings; constraints: Constraint[]; opts: Omit<CountOptions, 'onProgress'> };

export type WorkerResponse =
  | { kind: 'solve'; id: number; result: SolveResult; ms: number }
  | { kind: 'count'; id: number; result: CountResult }
  | { kind: 'progress'; id: number; count: number };

let highs: Promise<HighsLike> | null = null;
const load = () => (highs ??= loadHighs({ locateFile: () => wasmUrl }) as unknown as Promise<HighsLike>);
const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind === 'warmUp') {
    void load();
    return;
  }
  const t0 = performance.now();
  try {
    const h = await load();
    if (req.kind === 'solve') post({ kind: 'solve', id: req.id, result: generate(h, req.settings, req.constraints, req.opts), ms: performance.now() - t0 });
    else
      post({
        kind: 'count',
        id: req.id,
        result: countRotas(h, req.settings, req.constraints, { ...req.opts, onProgress: (count) => post({ kind: 'progress', id: req.id, count }) }),
      });
  } catch (err) {
    highs = null; // reload the solver next time
    const message = `The solver failed: ${err instanceof Error ? err.message : String(err)}`;
    if (req.kind === 'solve') post({ kind: 'solve', id: req.id, result: { status: 'error', message }, ms: 0 });
    else post({ kind: 'count', id: req.id, result: { count: 0, exact: false, ms: 0, error: message } });
  }
};
