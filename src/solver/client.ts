import type { Constraint, Settings } from '../model/types';
import type { GenerateOptions, SolveResult } from './solve';
import type { SolveRequest, SolveResponse } from './worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: SolveResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<SolveResponse>) => {
    pending.get(e.data.id)?.(e.data);
    pending.delete(e.data.id);
  };
  worker.onerror = (e) => {
    for (const [id, resolve] of pending) resolve({ id, ms: 0, result: { status: 'error', message: e.message || 'The solver stopped unexpectedly.' } });
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Run the solver off the main thread so the page stays responsive. */
export function solve(settings: Settings, constraints: Constraint[], opts: GenerateOptions): Promise<SolveResponse & { result: SolveResult }> {
  const id = nextId++;
  const req: SolveRequest = { id, settings, constraints, opts };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage(req);
  });
}

/** Start loading the solver in the background so the first "Generate" is quick. */
export function warmUp() {
  getWorker().postMessage({ warmUp: true });
}
