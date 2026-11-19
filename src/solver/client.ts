import type { Constraint, Settings } from '../model/types';
import type { CountOptions, CountResult, GenerateOptions, SolveResult } from './solve';
import type { WorkerRequest, WorkerResponse } from './worker';

/**
 * Two workers: one for generating/rebalancing, one for counting, so a long
 * count never holds up a rebalance.
 */
class SolverWorker {
  private worker: Worker | null = null;
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; progress?: (n: number) => void }>();
  private nextId = 1;

  private get(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      if (e.data.kind === 'progress') return p.progress?.(e.data.count);
      this.pending.delete(e.data.id);
      p.resolve(e.data);
    };
    w.onerror = (e) => {
      const message = e.message || 'The solver stopped unexpectedly.';
      for (const [id, p] of this.pending) p.resolve({ kind: 'solve', id, ms: 0, result: { status: 'error', message } });
      this.reset();
    };
    this.worker = w;
    return w;
  }

  reset() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  warmUp() {
    this.get().postMessage({ kind: 'warmUp' } satisfies WorkerRequest);
  }

  request(req: Omit<Extract<WorkerRequest, { id: number }>, 'id'>, progress?: (n: number) => void): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, progress });
      this.get().postMessage({ ...req, id } as WorkerRequest);
    });
  }
}

const solver = new SolverWorker();
const counter = new SolverWorker();

/** Start loading the solver in the background so the first "Generate" is quick. */
export function warmUp() {
  solver.warmUp();
}

/** Run the solver off the main thread so the page stays responsive. */
export async function solve(settings: Settings, constraints: Constraint[], opts: GenerateOptions): Promise<{ result: SolveResult; ms: number }> {
  const r = await solver.request({ kind: 'solve', settings, constraints, opts });
  return r.kind === 'solve' ? { result: r.result, ms: r.ms } : { result: { status: 'error', message: 'Unexpected reply' }, ms: 0 };
}

export async function count(
  settings: Settings,
  constraints: Constraint[],
  opts: Omit<CountOptions, 'onProgress'>,
  onProgress?: (n: number) => void,
): Promise<CountResult> {
  const r = await counter.request({ kind: 'count', settings, constraints, opts }, onProgress);
  if (r.kind === 'count') return r.result;
  return { count: 0, exact: false, ms: 0, error: r.kind === 'solve' && r.result.status === 'error' ? r.result.message : 'The count failed.' };
}

/** Stop a running count. */
export function cancelCount() {
  counter.reset();
}
