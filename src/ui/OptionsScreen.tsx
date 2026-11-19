import type { Setup } from '../model/io';
import type { Rota } from '../model/types';
import { hardBreaks, softBreaks } from '../model/validate';
import type { SolveResult } from '../solver/solve';
import { useRef, useState } from 'react';
import { cancelCount, count } from '../solver/client';
import type { CountResult } from '../solver/solve';
import { BreakList, RotaViews, ScreenHead } from './RotaViews';

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
  openRules?: { label: string; open: () => void };
}

export function OptionsScreen({ setup, run, stale, onGenerate, onUse, goRules, openRules }: Props) {
  const { result } = run;
  return (
    <section className="screen">
      <ScreenHead title="Options" openRules={openRules}>
        <p className="muted">Rotas that fit your squad, match and rules, best first.</p>
      </ScreenHead>

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

      <CountCard setup={setup} />

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

/** "How many rotas fit?": counts in the background, exact if it finishes, else a lower bound. */
function CountCard({ setup }: { setup: Setup }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [res, setRes] = useState<(CountResult & { key: string; prefs: boolean }) | null>(null);
  const [prefs, setPrefs] = useState(false);
  const runId = useRef(0);
  const key = JSON.stringify([setup.settings, setup.constraints, prefs]);

  const start = async (budget: number) => {
    const id = ++runId.current;
    setRunning(true);
    setProgress(0);
    const r = await count(setup.settings, setup.constraints, { budget, limit: 5000, includePreferences: prefs }, (n) => id === runId.current && setProgress(n));
    if (id !== runId.current) return;
    setRunning(false);
    setRes({ ...r, key, prefs });
  };
  const stop = () => {
    runId.current++;
    cancelCount();
    setRunning(false);
    setRes(progress ? { count: progress, exact: false, stoppedBy: 'time', ms: 0, key, prefs } : null);
  };

  const what = (p: boolean) => (p ? 'meet every rule and preference' : 'meet every Must rule');
  return (
    <details className="card count-card">
      <summary>
        <b>How many rotas fit?</b>
        {res && !running && res.key === key && (
          <span className="muted small"> {res.error ? 'error' : res.exact ? `exactly ${res.count}` : `at least ${res.count}`}</span>
        )}
      </summary>
      <label className="check small">
        <input type="checkbox" checked={prefs} onChange={(e) => setPrefs(e.target.checked)} disabled={running} />
        Count only rotas that meet every preference too
      </label>
      <div className="row-btns">
        {running ? (
          <>
            <span className="muted" aria-live="polite">
              <span className="spinner" /> Counting… {progress} so far
            </span>
            <button type="button" className="btn small" onClick={stop}>
              Stop
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn small" onClick={() => void start(5)}>
              Count (about 5 s)
            </button>
            <button type="button" className="btn ghost small" onClick={() => void start(30)}>
              Count longer (30 s)
            </button>
          </>
        )}
      </div>
      {res && !running && (
        <p className={res.key === key ? '' : 'muted'}>
          {res.error
            ? res.error
            : res.exact
              ? res.count === 0
                ? `No rota can ${what(res.prefs)}.`
                : `Exactly ${res.count} different rota${res.count === 1 ? '' : 's'} ${what(res.prefs)}.`
              : `At least ${res.count} different rotas ${what(res.prefs)}. There are more: counting stopped ${
                  res.stoppedBy === 'limit' ? `at ${res.count}` : 'when time ran out'
                }.`}
          {res.key !== key && ' (Rules have changed since: count again.)'}
        </p>
      )}
      <p className="muted small">
        Two rotas count as different if anyone is in a different place at any time. Counting lists them one by one, so with loose rules it
        gives a lower bound rather than the exact total.
      </p>
    </details>
  );
}
