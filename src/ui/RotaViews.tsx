import { useMemo, useState } from 'react';
import { minutesColors, textOn } from '../model/colors';
import { substitutions } from '../model/subs';
import { ROLE_NAMES, slotCount } from '../model/match';
import { lineupWindows, playerStats } from '../model/stats';
import type { Break, Rota, Settings } from '../model/types';

import type { CellRef } from '../model/edit';
export type { CellRef };

interface GraphProps {
  rota: Rota;
  settings: Settings;
  highlight?: string | null;
  onHighlight?: (id: string | null) => void;
  breaks?: Break[];
  selected?: CellRef | null;
  onCell?: (cell: CellRef) => void;
  onDropCell?: (from: CellRef, to: CellRef) => void;
}

/** Players shown in the views: everyone available, plus anyone the rota uses. */
export function shownPlayers(rota: Rota, settings: Settings) {
  const used = new Set(rota.flatMap((s) => Object.values(s)).filter(Boolean));
  return settings.squad.filter((p) => p.available || used.has(p.id));
}

/** Rows = players, columns = time. Cells show the position code, coloured by group. */
export function RotationGraph({ rota, settings, highlight, onHighlight, breaks = [], selected, onCell, onDropCell }: GraphProps) {
  const m = settings.match;
  const n = slotCount(m);
  const stats = useMemo(() => playerStats(rota, settings), [rota, settings]);
  const colors = useMinutesColors(rota, settings);
  const players = shownPlayers(rota, settings);
  const perQuarter = m.quarter_length_min / m.slot_length_min;
  const subs = new Set(m.sub_points);

  // Mark cells named by breaks (hard = red, soft = amber).
  const marks = new Map<string, 'hard' | 'soft'>();
  for (const b of breaks) {
    if (!b.players?.length || !b.slots?.length) continue;
    for (const p of b.players)
      for (const s of b.slots) {
        const k = `${p}:${s}`;
        if (b.severity === 'hard' || !marks.has(k)) marks.set(k, b.severity);
      }
  }

  return (
    <div className="graph-scroll">
      <table className="graph" style={{ ['--cols' as string]: n }}>
        <thead>
          <tr>
            <th className="g-name" scope="col">
              <span className="sr-only">Player</span>
            </th>
            {Array.from({ length: n }, (_, s) => (
              <th
                key={s}
                scope="col"
                className={`g-time ${s % perQuarter === 0 && s ? 'q-start' : ''}`}
                title={`${s * m.slot_length_min}–${(s + 1) * m.slot_length_min} min`}
              >
                <span>{s * m.slot_length_min}</span>
                {s > 0 && subs.has(s * m.slot_length_min) && <i className="sub-dot" aria-label="sub point" />}
              </th>
            ))}
            <th className="g-total" scope="col">
              min
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const st = stats[p.id];
            const bg = colors.byPlayer[p.id];
            const dim = highlight && highlight !== p.id;
            return (
              <tr key={p.id} className={`${dim ? 'dim' : ''} ${highlight === p.id ? 'hl' : ''}`}>
                <th scope="row" className="g-name">
                  <button type="button" className="name-btn" onClick={() => onHighlight?.(highlight === p.id ? null : p.id)}>
                    <i className="dot" style={{ background: bg }} />
                    {p.name}
                  </button>
                </th>
                {Array.from({ length: n }, (_, s) => {
                  const code = st?.timeline[s] ?? null;
                  const mark = marks.get(`${p.id}:${s}`);
                  const isSel = selected?.player === p.id && selected.slot === s;
                  const cls = [
                    'cell',
                    code ? 'on' : 'off',
                    s % perQuarter === 0 && s ? 'q-start' : '',
                    mark ? `mark-${mark}` : '',
                    isSel ? 'selected' : '',
                    onCell ? 'editable' : '',
                  ].join(' ');
                  const style = code ? { background: bg, color: textOn(bg) } : undefined;
                  const label = `${p.name}, ${s * m.slot_length_min}–${(s + 1) * m.slot_length_min} min: ${code ?? 'off'}`;
                  return (
                    <td key={s} className={cls} style={style}>
                      {onCell ? (
                        <button
                          type="button"
                          aria-label={label}
                          aria-pressed={isSel}
                          onClick={() => onCell({ player: p.id, slot: s })}
                          draggable={!!onDropCell}
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ player: p.id, slot: s }))}
                          onDragOver={(e) => onDropCell && e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            try {
                              onDropCell?.(JSON.parse(e.dataTransfer.getData('text/plain')), { player: p.id, slot: s });
                            } catch {
                              /* ignore foreign drops */
                            }
                          }}
                        >
                          {code ?? 'off'}
                        </button>
                      ) : (
                        <span title={label}>{code ?? 'off'}</span>
                      )}
                    </td>
                  );
                })}
                <td className="g-total">{st?.total ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One row per substitution window: who's on (by position) and who's off. */
export function ByTime({ rota, settings, highlight, onHighlight }: Omit<GraphProps, 'breaks'>) {
  const name = (id: string | null) => (id ? (settings.squad.find((p) => p.id === id)?.name ?? '?') : '—');
  const colors = useMinutesColors(rota, settings);
  const color = (id: string | null) => (id ? colors.byPlayer[id] : 'transparent');
  return (
    <ol className="bytime">
      {lineupWindows(rota, settings).map((w) => (
        <li key={w.from}>
          <div className="bt-time">
            {w.start}–{w.end}
          </div>
          <div className="bt-body">
            <div className="bt-on">
              {settings.positions.map((q) => {
                const id = w.lineup[q.code] ?? null;
                return (
                  <button
                    type="button"
                    key={q.code}
                    className={`chip ${highlight && highlight !== id ? 'dim' : ''} ${highlight === id ? 'hl' : ''}`}
                    onClick={() => id && onHighlight?.(highlight === id ? null : id)}
                  >
                    <b>{q.code}</b>
                    <i className="dot" style={{ background: color(id) }} />
                    {name(id)}
                  </button>
                );
              })}
            </div>
            <div className="bt-off">
              <span className="off-label">OFF</span>
              {w.bench.length
                ? w.bench.map((id) => (
                    <button
                      type="button"
                      key={id}
                      className={`chip off-chip ${highlight && highlight !== id ? 'dim' : ''} ${highlight === id ? 'hl' : ''}`}
                      onClick={() => onHighlight?.(highlight === id ? null : id)}
                    >
                      {name(id)}
                    </button>
                  ))
                : ' nobody'}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A bar per player with total minutes; tap for the role breakdown. */
export function Shifts({ rota, settings, highlight, onHighlight }: Omit<GraphProps, 'breaks'>) {
  const stats = useMemo(() => playerStats(rota, settings), [rota, settings]);
  const colors = useMinutesColors(rota, settings);
  const [open, setOpen] = useState<string | null>(null);
  const m = settings.match;
  const total = m.quarters * m.quarter_length_min;
  const roles = [...new Set(settings.positions.map((q) => q.role))];
  return (
    <ul className="shifts">
      {shownPlayers(rota, settings).map((p) => {
        const st = stats[p.id];
        const bg = colors.byPlayer[p.id];
        const isOpen = open === p.id;
        return (
          <li key={p.id} className={`${highlight && highlight !== p.id ? 'dim' : ''} ${highlight === p.id ? 'hl' : ''}`}>
            <button
              type="button"
              className="shift-row"
              aria-expanded={isOpen}
              onClick={() => {
                setOpen(isOpen ? null : p.id);
                onHighlight?.(isOpen ? null : p.id);
              }}
            >
              <span className="shift-name">{p.name}</span>
              <span className="shift-track">
                <span className="shift-bar" style={{ width: `${((st?.total ?? 0) / total) * 100}%`, background: bg }} />
              </span>
              <span className="shift-label">
                {st?.slots ?? 0} × {m.slot_length_min}m = <b>{st?.total ?? 0}m</b>
              </span>
            </button>
            {isOpen && st && (
              <div className="shift-detail">
                <div>
                  {roles.map((r) => (
                    <span key={r} className="pill">
                      {ROLE_NAMES[r] ?? r} {st.byRole[r] ?? 0}m
                    </span>
                  ))}
                </div>
                <div className="muted small">
                  Positions:{' '}
                  {Object.entries(st.byPosition)
                    .map(([c, v]) => `${c} ${v}m`)
                    .join(', ') || 'none'}
                  {' · '}
                  {st.spells} spell{st.spells === 1 ? '' : 's'} on · longest on the bench {st.longestBench}m
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function BreakList({ breaks, empty }: { breaks: Break[]; empty?: string }) {
  if (!breaks.length) return empty ? <p className="ok-line">✓ {empty}</p> : null;
  const sorted = [...breaks].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'hard' ? -1 : 1));
  return (
    <ul className="breaks">
      {sorted.map((b, i) => (
        <li key={i} className={`break ${b.severity}`}>
          <span className="break-tag">{b.severity === 'hard' ? 'Rule broken' : 'Preference'}</span>
          {b.message}
        </li>
      ))}
    </ul>
  );
}

export type ViewKind = 'graph' | 'time' | 'subs' | 'shifts';

export function ViewTabs({ value, onChange }: { value: ViewKind; onChange: (v: ViewKind) => void }) {
  const tabs: [ViewKind, string][] = [
    ['graph', 'Rotation'],
    ['time', 'By time'],
    ['subs', 'Subs'],
    ['shifts', 'Shifts'],
  ];
  return (
    <div className="segmented" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function RotaViews(props: { rota: Rota; settings: Settings; breaks?: Break[]; initial?: ViewKind }) {
  const [view, setView] = useState<ViewKind>(props.initial ?? 'graph');
  const [highlight, setHighlight] = useState<string | null>(null);
  const common = { rota: props.rota, settings: props.settings, highlight, onHighlight: setHighlight };
  return (
    <div className="views">
      <ViewTabs value={view} onChange={setView} />
      {view === 'graph' && (
        <>
          <RotationGraph {...common} breaks={props.breaks} />
          <MinutesKeyView rota={props.rota} settings={props.settings} />
        </>
      )}
      {view === 'time' && <ByTime {...common} />}
      {view === 'subs' && <SubsList {...common} />}
      {view === 'shifts' && <Shifts {...common} />}
      {highlight && (
        <p className="muted small hl-note">
          Highlighting {props.settings.squad.find((p) => p.id === highlight)?.name}.{' '}
          <button type="button" className="link" onClick={() => setHighlight(null)}>
            Clear
          </button>
        </p>
      )}
    </div>
  );
}

/** Colours by total minutes, recomputed whenever the rota changes. */
export function useMinutesColors(rota: Rota, settings: Settings) {
  return useMemo(() => {
    const stats = playerStats(rota, settings);
    return minutesColors(Object.fromEntries(shownPlayers(rota, settings).map((p) => [p.id, stats[p.id]?.total ?? 0])));
  }, [rota, settings]);
}

/** "■ 25 min · ■ 20 min" key under the rotation graph. */
export function MinutesKeyView({ rota, settings }: { rota: Rota; settings: Settings }) {
  const { key } = useMinutesColors(rota, settings);
  if (!key.length) return null;
  return (
    <p className="minutes-key">
      {key.map((k) => (
        <span key={k.minutes}>
          <i className="swatch" style={{ background: k.color }} />
          {k.minutes} min
          <span className="muted"> ({k.players.length})</span>
        </span>
      ))}
      <span>
        <i className="swatch off-swatch" />
        bench
      </span>
    </p>
  );
}

/** Every change in order: who comes on for whom, who moves. Mid-quarter changes are flagged. */
export function SubsList({ rota, settings, highlight, onHighlight }: Omit<GraphProps, 'breaks'>) {
  const name = (id: string) => settings.squad.find((p) => p.id === id)?.name ?? '?';
  const colors = useMinutesColors(rota, settings);
  const events = substitutions(rota, settings);
  const P = ({ id }: { id: string }) => (
    <button
      type="button"
      className={`sub-name ${highlight && highlight !== id ? 'dim' : ''} ${highlight === id ? 'hl' : ''}`}
      onClick={() => onHighlight?.(highlight === id ? null : id)}
    >
      <i className="dot" style={{ background: colors.byPlayer[id] }} />
      {name(id)}
    </button>
  );
  const start = rota[0] ?? {};
  return (
    <ol className="subs">
      <li>
        <div className="sub-when">
          <b>0′</b>
          <span className="tag">Kick-off</span>
        </div>
        <div className="sub-items">
          {settings.positions.map((q) =>
            start[q.code] ? (
              <span key={q.code} className="sub-item">
                <b className="pos">{q.code}</b> <P id={start[q.code]!} />
              </span>
            ) : null,
          )}
        </div>
      </li>
      {events.map((e) => (
        <li key={e.minute} className={e.midQuarter ? 'mid' : ''}>
          <div className="sub-when">
            <b>{e.minute}′</b>
            <span className={`tag ${e.midQuarter ? 'tag-mid' : ''}`}>{e.midQuarter ? `Mid Q${e.quarter}` : `Start Q${e.quarter}`}</span>
          </div>
          <div className="sub-items">
            {e.swaps.map((x) => (
              <span key={x.on} className="sub-item">
                <span className="arrow on" aria-label="on">▲</span>
                <P id={x.on} /> on for
                <span className="arrow off" aria-label="off">▼</span>
                <P id={x.off} /> <b className="pos">{x.position}</b>
              </span>
            ))}
            {e.on.map((x) => (
              <span key={x.player} className="sub-item">
                <span className="arrow on" aria-label="on">▲</span>
                <P id={x.player} /> on <b className="pos">{x.position}</b>
              </span>
            ))}
            {e.off.map((id) => (
              <span key={id} className="sub-item">
                <span className="arrow off" aria-label="off">▼</span>
                <P id={id} /> off
              </span>
            ))}
            {e.moves.map((x) => (
              <span key={x.player} className="sub-item">
                <span className="arrow move" aria-label="moves">↔</span>
                <P id={x.player} /> {x.from} → {x.to}
              </span>
            ))}
          </div>
        </li>
      ))}
      {!events.length && <li className="muted">No changes during the match.</li>}
    </ol>
  );
}

