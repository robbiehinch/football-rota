import { useMemo, useRef, useState } from 'react';
import { movedCells, placePlayer, swapCells } from '../model/edit';
import type { Setup } from '../model/io';
import { cellsChanged, lockKey, lockPins } from '../model/locks';
import { slotCount, windowsFor } from '../model/match';
import { emptyRota, timelines } from '../model/stats';
import type { Rota } from '../model/types';
import { hardBreaks, softBreaks, validate } from '../model/validate';
import { solve } from '../solver/client';
import { BreakList, ByTime, MinutesKeyView, RotationGraph, ScreenHead, Shifts, SubsList, ViewTabs, type CellRef, type ViewKind } from './RotaViews';

interface Props {
  setup: Setup;
  update: (fn: (s: Setup) => Setup) => void;
  goOptions: () => void;
  openRules?: { label: string; open: () => void };
}

interface Note {
  kind: 'ok' | 'problem';
  text: string;
  conflicts?: string[];
}

const AUTO_KEY = 'rota-builder:auto-rebalance';

export function EditScreen({ setup, update, goOptions, openRules }: Props) {
  const { settings, constraints } = setup;
  const rota = setup.rota && setup.rota.length === slotCount(settings.match) ? setup.rota : null;
  const locks = useMemo(() => setup.locks ?? [], [setup.locks]);
  const lockSet = useMemo(() => new Set(locks), [locks]);
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [wholeWindow, setWholeWindow] = useState(true);
  const [autoBalance, setAutoBalanceState] = useState(() => {
    try {
      return localStorage.getItem(AUTO_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const [history, setHistory] = useState<{ rota: Rota; locks: string[] }[]>([]);
  const [view, setView] = useState<ViewKind>('graph');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const runId = useRef(0);
  const breaks = useMemo(() => (rota ? validate(rota, settings, constraints) : []), [rota, settings, constraints]);

  const setAutoBalance = (on: boolean) => {
    setAutoBalanceState(on);
    try {
      localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  };

  if (!rota)
    return (
      <section className="screen">
        <header className="screen-head">
          <h1>Edit</h1>
        </header>
        <div className="card empty">
          <p>No rota yet. Pick one from Options, or start from an empty grid.</p>
          <div className="row-btns">
            <button type="button" className="btn primary" onClick={goOptions}>
              See options
            </button>
            <button type="button" className="btn" onClick={() => update((s) => ({ ...s, rota: emptyRota(settings), locks: [] }))}>
              Empty grid
            </button>
          </div>
        </div>
      </section>
    );

  const len = settings.match.slot_length_min;
  const windows = windowsFor(settings.match, settings.match.sub_points);
  const slotsFor = (s: number) => {
    if (!wholeWindow) return [s];
    const w = windows.find((w) => s >= w.from && s < w.to)!;
    return Array.from({ length: w.to - w.from }, (_, i) => w.from + i);
  };
  const name = (id: string) => settings.squad.find((p) => p.id === id)?.name ?? '?';

  /** Re-solve everything that isn't locked, staying as close as possible to `base`. */
  const rebalance = async (base: Rota, lk: string[]) => {
    const id = ++runId.current;
    setBusy(true);
    setNote(null);
    const pins = lockPins(base, lk, settings);
    const { result } = await solve(settings, [...constraints, ...pins], { count: 1, prefer: base, budget: 5 });
    if (id !== runId.current) return; // a newer edit superseded this one
    setBusy(false);
    if (result.status === 'ok' && result.options.length) {
      const out = result.options[0].rota;
      const n = cellsChanged(base, out);
      update((s) => (JSON.stringify(s.rota) === JSON.stringify(base) ? { ...s, rota: out } : s));
      setNote({
        kind: 'ok',
        text: n ? `Rebalanced: ${n} other cell${n === 1 ? '' : 's'} changed to fit the rules.` : 'Fits the rules: nothing else needed changing.',
      });
    } else if (result.status === 'infeasible')
      setNote({
        kind: 'problem',
        text: `Couldn't rebalance with these cells locked. ${result.message}`,
        conflicts: result.conflicts.map((c) => c.label),
      });
    else setNote({ kind: 'problem', text: result.status === 'error' ? result.message : 'No rota found.' });
  };

  /** Apply a manual change: lock the cells that moved, then rebalance the rest. */
  const commit = (next: Rota) => {
    const moved = movedCells(rota, next).map((c) => lockKey(c.slot, c.player));
    const nextLocks = [...new Set([...locks, ...moved])];
    setHistory((h) => [...h.slice(-30), { rota, locks }]);
    update((s) => ({ ...s, rota: next, locks: nextLocks }));
    setSelected(null);
    if (autoBalance) void rebalance(next, nextLocks);
    else setNote(null);
  };

  const onCell = (cell: CellRef) => {
    if (!selected) return setSelected(cell);
    if (selected.player === cell.player && selected.slot === cell.slot) return setSelected(null);
    if (selected.slot !== cell.slot) return setSelected(cell);
    commit(swapCells(rota, selected, cell, slotsFor(cell.slot)));
  };
  const onDrop = (from: CellRef, to: CellRef) => {
    if (from.slot !== to.slot || from.player === to.player) return;
    commit(swapCells(rota, from, to, slotsFor(to.slot)));
  };

  const tl = timelines(rota, settings);
  const hard = hardBreaks(breaks);
  const soft = softBreaks(breaks);
  const selSlots = selected ? slotsFor(selected.slot) : [];
  const selCode = selected ? (tl[selected.player]?.[selected.slot] ?? null) : null;
  const selLocked = selected ? selSlots.every((s) => lockSet.has(lockKey(s, selected.player))) : false;
  const toggleLock = () => {
    if (!selected) return;
    const keys = selSlots.map((s) => lockKey(s, selected.player));
    const nextLocks = selLocked ? locks.filter((k) => !keys.includes(k)) : [...new Set([...locks, ...keys])];
    update((s) => ({ ...s, locks: nextLocks }));
    setSelected(null);
  };

  return (
    <section className="screen">
      <ScreenHead title="Edit" openRules={openRules}>
        <p className="muted">
          Tap a cell, then another in the same column to swap (or drag on a computer). Moved cells get locked{' '}
          <span className="lock-inline" aria-hidden="true" /> and the rest of the rota rebalances to fit your rules.
        </p>
      </ScreenHead>

      <div className={`status-line ${busy ? 'busy' : hard.length ? 'hard' : soft.length ? 'soft' : 'good'}`} aria-live="polite">
        {busy ? (
          <>
            <span className="spinner" /> Rebalancing…
          </>
        ) : hard.length ? (
          `${hard.length} rule${hard.length === 1 ? '' : 's'} broken`
        ) : soft.length ? (
          `All rules met · ${soft.length} preference${soft.length === 1 ? '' : 's'} missed`
        ) : (
          'All rules and preferences met'
        )}
      </div>

      {note && (
        <div className={`notice ${note.kind === 'problem' ? 'hard' : 'good'}`} role={note.kind === 'problem' ? 'alert' : 'status'}>
          {note.text}
          {note.conflicts && note.conflicts.length > 0 && (
            <ul className="conflicts">
              {note.conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="edit-options">
        <label className="check small">
          <input type="checkbox" checked={autoBalance} onChange={(e) => setAutoBalance(e.target.checked)} />
          Rebalance automatically after each change
        </label>
        <label className="check small">
          <input type="checkbox" checked={wholeWindow} onChange={(e) => setWholeWindow(e.target.checked)} />
          Change the whole substitution window (not just one {len}-minute slot)
        </label>
      </div>

      <ViewTabs value={view} onChange={setView} />
      {view === 'graph' && (
        <>
          <RotationGraph
            rota={rota}
            settings={settings}
            breaks={breaks}
            selected={selected}
            locked={lockSet}
            onCell={onCell}
            onDropCell={onDrop}
            highlight={highlight}
            onHighlight={setHighlight}
          />
          <MinutesKeyView rota={rota} settings={settings} />
        </>
      )}
      {view === 'time' && <ByTime rota={rota} settings={settings} highlight={highlight} onHighlight={setHighlight} />}
      {view === 'subs' && <SubsList rota={rota} settings={settings} highlight={highlight} onHighlight={setHighlight} />}
      {view === 'shifts' && <Shifts rota={rota} settings={settings} highlight={highlight} onHighlight={setHighlight} />}

      {selected && view === 'graph' && (
        <div className="picker" role="dialog" aria-label="Move player">
          <p>
            <b>{name(selected.player)}</b>, {selSlots[0] * len}–{(selSlots[selSlots.length - 1] + 1) * len} min ({selCode ?? 'off'}). Tap
            another cell in that column to swap, or:
          </p>
          <div className="chips">
            {settings.positions.map((q) => (
              <button
                key={q.code}
                type="button"
                className={`chip ${selCode === q.code ? 'active' : ''}`}
                onClick={() => commit(placePlayer(rota, selected.player, q.code, selSlots))}
              >
                {q.code}
              </button>
            ))}
            <button type="button" className="chip off-chip" onClick={() => commit(placePlayer(rota, selected.player, null, selSlots))}>
              Bench
            </button>
          </div>
          <div className="chips picker-actions">
            <button type="button" className="chip" onClick={toggleLock}>
              {selLocked ? 'Unlock' : 'Lock here'}
            </button>
            <button type="button" className="chip" onClick={() => setSelected(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="row-btns">
        <button type="button" className="btn primary small" disabled={busy} onClick={() => void rebalance(rota, locks)}>
          Rebalance now
        </button>
        <button
          type="button"
          className="btn small"
          disabled={!history.length || busy}
          onClick={() => {
            const last = history[history.length - 1];
            runId.current++;
            update((s) => ({ ...s, rota: last.rota, locks: last.locks }));
            setHistory((h) => h.slice(0, -1));
            setNote(null);
          }}
        >
          Undo
        </button>
        <button type="button" className="btn ghost small" disabled={!locks.length} onClick={() => update((s) => ({ ...s, locks: [] }))}>
          Unlock all{locks.length ? ` (${locks.length})` : ''}
        </button>
      </div>

      <h2 className="section-title">Checks</h2>
      <BreakList breaks={breaks} empty="Everything checks out." />
    </section>
  );
}
