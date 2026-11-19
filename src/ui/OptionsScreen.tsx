import type { Setup } from '../model/io';
import type { Rota } from '../model/types';
import { hardBreaks, softBreaks } from '../model/validate';
import type { SolveResult } from '../solver/solve';
import { BreakList, RotaViews } from './RotaViews';

export interface RunState {
  running: boolean;
  result: SolveResult | null;
  /** JSON of the inputs the result was made from (to spot stale results). */
  inputKey: string | null;
  ms: number;
  seed: number;
}

interface Props {
  setup: Setup;
  run: RunState;
  stale: boolean;
  onGenerate: (seed: number) => void;
  onUse: (rota: Rota) => void;
  goRules: () => void;
}

export function OptionsScreen({ setup, run, stale, onGenerate, onUse, goRules }: Props) {
  const { result } = run;
  return (
    <section className="screen">
      <header className="screen-head">
        <h1>Options</h1>
        <p className="muted">Rotas that fit your squad, match and rules, best first.</p>
      </header>

      <div className="gen-bar">
        <button type="button" className="btn primary" disabled={run.running} onClick={() => onGenerate(0)}>
          {run.running ? 'Working…' : result ? 'Generate again' : 'Generate rotas'}
        </button>
        <button type="button" className="btn" disabled={run.running || !result} onClick={() => onGenerate(run.seed + 1)} title="A different set of valid options">
          Shuffle
        </button>
      </div>
      {stale && result && !run.running && <p className="notice">Squad or rules changed since these were made. Tap “Generate again”.</p>}
      {run.running && (
        <p className="muted" aria-live="polite">
          <span className="spinner" /> Working out rotas…
        </p>
      )}

      {result?.status === 'error' && (
        <div className="card problem">
          <h2>Something went wrong</h2>
          <p>{result.message}</p>
        </div>
      )}

      {result?.status === 'infeasible' && (
        <div className="card problem" role="alert">
          <h2>No rota fits</h2>
          <p>{result.message}</p>
          {result.conflicts.length > 0 && (
            <ul className="conflicts">
              {result.conflicts.map((c) => (
                <li key={c.key}>{c.label}</li>
              ))}
            </ul>
          )}
          <button type="button" className="btn small" onClick={goRules}>
            Go to rules
          </button>
        </div>
      )}

      {result?.status === 'ok' && (
        <>
          <p className="muted small">
            {result.options.length} option{result.options.length === 1 ? '' : 's'}
            {run.ms ? ` in ${(run.ms / 1000).toFixed(1)} s` : ''}
            {run.seed ? ` · shuffle #${run.seed}` : ''}
          </p>
          {result.options.map((o, i) => {
            const soft = softBreaks(o.breaks);
            const hard = hardBreaks(o.breaks);
            return (
              <article key={i} className="card option">
                <header className="option-head">
                  <h2>Option {i + 1}</h2>
                  <span className={`badge ${soft.length ? 'soft' : 'good'}`}>
                    {soft.length ? `${soft.length} preference${soft.length === 1 ? '' : 's'} missed` : 'All rules met'}
                  </span>
                </header>
                <RotaViews rota={o.rota} settings={setup.settings} breaks={o.breaks} />
                <BreakList breaks={[...hard, ...soft]} />
                <button type="button" className="btn primary block" onClick={() => onUse(o.rota)}>
                  Use this rota
                </button>
              </article>
            );
          })}
        </>
      )}

      {!result && !run.running && (
        <div className="card empty">
          <p>
            Tap <b>Generate rotas</b> to get up to 5 options. They are the same every time for the same squad and rules; <b>Shuffle</b> gives
            a different set.
          </p>
        </div>
      )}
    </section>
  );
}
