import { useMemo, useState } from 'react';
import { placePlayer, swapCells } from '../model/edit';
import type { Setup } from '../model/io';
import { slotCount, windowsFor } from '../model/match';
import { emptyRota, timelines } from '../model/stats';
import type { Rota } from '../model/types';
import { hardBreaks, softBreaks, validate } from '../model/validate';
import { BreakList, ByTime, MinutesKeyView, RotationGraph, Shifts, SubsList, ViewTabs, type CellRef, type ViewKind } from './RotaViews';

interface Props {
  setup: Setup;
  setRota: (rota: Rota | null) => void;
  goOptions: () => void;
}

export function EditScreen({ setup, setRota, goOptions }: Props) {
  const { settings, constraints } = setup;
  const rota = setup.rota && setup.rota.length === slotCount(settings.match) ? setup.rota : null;
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [wholeWindow, setWholeWindow] = useState(true);
  const [history, setHistory] = useState<Rota[]>([]);
  const [view, setView] = useState<ViewKind>('graph');
  const [highlight, setHighlight] = useState<string | null>(null);
  const breaks = useMemo(() => (rota ? validate(rota, settings, constraints) : []), [rota, settings, constraints]);

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
            <button type="button" className="btn" onClick={() => setRota(emptyRota(settings))}>
              Empty grid
            </button>
          </div>
        </div>
      </section>
    );

  const windows = windowsFor(settings.match, settings.match.sub_points);
  const slotsFor = (s: number) => {
    if (!wholeWindow) return [s];
    const w = windows.find((w) => s >= w.from && s < w.to)!;
    return Array.from({ length: w.to - w.from }, (_, i) => w.from + i);
  };
  const commit = (next: Rota) => {
    setHistory((h) => [...h.slice(-30), rota]);
    setRota(next);
  };
  const tl = timelines(rota, settings);
  const name = (id: string) => settings.squad.find((p) => p.id === id)?.name ?? '?';
  const len = settings.match.slot_length_min;

  const onCell = (cell: CellRef) => {
    if (!selected) return setSelected(cell);
    if (selected.player === cell.player && selected.slot === cell.slot) return setSelected(null);
    if (selected.slot !== cell.slot) return setSelected(cell);
    commit(swapCells(rota, selected, cell, slotsFor(cell.slot)));
    setSelected(null);
  };
  const onDrop = (from: CellRef, to: CellRef) => {
    if (from.slot !== to.slot || from.player === to.player) return;
    commit(swapCells(rota, from, to, slotsFor(to.slot)));
    setSelected(null);
  };

  const hard = hardBreaks(breaks);
  const soft = softBreaks(breaks);
  const selSlots = selected ? slotsFor(selected.slot) : [];
  const selCode = selected ? (tl[selected.player]?.[selected.slot] ?? null) : null;

  return (
    <section className="screen">
      <header className="screen-head">
        <h1>Edit</h1>
        <p className="muted">Tap a cell, then another in the same column to swap. On a computer you can drag instead.</p>
      </header>

      <div className={`status-line ${hard.length ? 'hard' : soft.length ? 'soft' : 'good'}`} aria-live="polite">
        {hard.length
          ? `${hard.length} rule${hard.length === 1 ? '' : 's'} broken`
          : soft.length
            ? `All rules met · ${soft.length} preference${soft.length === 1 ? '' : 's'} missed`
            : 'All rules and preferences met'}
      </div>

      <label className="check small">
        <input type="checkbox" checked={wholeWindow} onChange={(e) => setWholeWindow(e.target.checked)} />
        Change the whole substitution window (not just one {len}-minute slot)
      </label>

      <ViewTabs value={view} onChange={setView} />
      {view === 'graph' && (
        <RotationGraph
          rota={rota}
          settings={settings}
          breaks={breaks}
          selected={selected}
          onCell={onCell}
          onDropCell={onDrop}
          highlight={highlight}
          onHighlight={setHighlight}
        />
      )}
      {view === 'graph' && <MinutesKeyView rota={rota} settings={settings} />}
      {view === 'time' && <ByTime rota={rota} settings={settings} highlight={highlight} onHighlight={setHighlight} />}
      {view === 'subs' && <SubsList rota={rota} settings={settings} highlight={highlight} onHighlight={setHighlight} />}
      {view === 'shifts' && <Shifts rota={rota} settings={settings} highlight={highlight} onHighlight={setHighlight} />}

      {selected && view === 'graph' && (
        <div className="picker" role="dialog" aria-label="Move player">
          <p>
            <b>{name(selected.player)}</b>, {selSlots[0] * len}–{(selSlots[selSlots.length - 1] + 1) * len} min ({selCode ?? 'off'}). Tap
            another cell in that column to swap, or put them in:
          </p>
          <div className="chips">
            {settings.positions.map((q) => (
              <button
                key={q.code}
                type="button"
                className={`chip ${selCode === q.code ? 'active' : ''}`}
                onClick={() => {
                  commit(placePlayer(rota, selected.player, q.code, selSlots));
                  setSelected(null);
                }}
              >
                {q.code}
              </button>
            ))}
            <button
              type="button"
              className="chip off-chip"
              onClick={() => {
                commit(placePlayer(rota, selected.player, null, selSlots));
                setSelected(null);
              }}
            >
              Bench
            </button>
            <button type="button" className="chip" onClick={() => setSelected(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="row-btns">
        <button
          type="button"
          className="btn small"
          disabled={!history.length}
          onClick={() => {
            setRota(history[history.length - 1]);
            setHistory((h) => h.slice(0, -1));
          }}
        >
          Undo
        </button>
        <button type="button" className="btn ghost small" onClick={goOptions}>
          Pick another option
        </button>
      </div>

      <h2 className="section-title">Checks</h2>
      <BreakList breaks={breaks} empty="Everything checks out." />
    </section>
  );
}
