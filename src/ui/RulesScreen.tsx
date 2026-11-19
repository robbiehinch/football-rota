import { useState, type ReactNode } from 'react';
import { describeConstraint, gkBlocks, KIND_HELP, KIND_LABELS, newConstraint, PRESETS, WEIGHT_LABELS } from '../model/constraints';
import type { Setup } from '../model/io';
import { canPlayGk, quarterBreaks, slotBoundaries, totalMinutes } from '../model/match';
import type { Constraint, ConstraintKind, Settings, Weight } from '../model/types';

interface Props {
  setup: Setup;
  update: (fn: (s: Setup) => Setup) => void;
  /** Side-panel version: no presets or "always on" list. */
  compact?: boolean;
}

const KINDS = Object.keys(KIND_LABELS) as ConstraintKind[];
const QUICK: ConstraintKind[] = ['gk_plan', 'spells', 'max_on', 'rotate', 'side_pref', 'apart', 'together', 'pin'];

/** One dropdown per goalkeeper block (each quarter by default). */
export function GkPlanEditor({ settings, keepers, onChange }: { settings: Settings; keepers: Record<string, string>; onChange: (k: Record<string, string>) => void }) {
  const keepersList = settings.squad.filter((p) => p.available && canPlayGk(p, settings.positions));
  return (
    <div className="gk-plan">
      {gkBlocks(settings.match).map((b) => {
        const value = keepers[String(b.start)] ?? '';
        const chosen = settings.squad.find((p) => p.id === value);
        const options = chosen && !keepersList.includes(chosen) ? [...keepersList, chosen] : keepersList;
        return (
          <label key={b.start} className="gk-row">
            <span className="gk-time">
              {b.start}–{b.end}′
            </span>
            <select value={value} onChange={(e) => onChange({ ...keepers, [String(b.start)]: e.target.value })}>
              <option value="">App chooses</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.available ? '' : ' (not playing)'}
                  {!canPlayGk(p, settings.positions) ? ' (not ticked GK)' : ''}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {!keepersList.length && <p className="warn-text small">Nobody available is ticked for GK on the Squad tab.</p>}
    </div>
  );
}

export function RulesScreen({ setup, update, compact }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<ConstraintKind | ''>('');
  const settings = setup.settings;

  const setC = (id: string, patch: Partial<Constraint>) =>
    update((s) => ({ ...s, constraints: s.constraints.map((c) => (c.id === id ? ({ ...c, ...patch } as Constraint) : c)) }));
  const remove = (id: string) => update((s) => ({ ...s, constraints: s.constraints.filter((c) => c.id !== id) }));

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id)!;
    if (setup.constraints.length && !confirm(`Replace your current rules with “${preset.name}”?`)) return;
    update((s) => {
      const built = preset.build(s.settings);
      return { ...s, constraints: built.constraints, settings: { ...s.settings, match: { ...s.settings.match, ...built.match } } };
    });
    setEditing(null);
  };

  const add = (kind: ConstraintKind) => {
    const existing = kind === 'gk_plan' || kind === 'side_pref' ? setup.constraints.find((c) => c.kind === kind) : undefined;
    if (existing) {
      setC(existing.id, { enabled: true });
      setEditing(existing.id);
      setAdding('');
      return;
    }
    const c = newConstraint(kind, settings);
    update((s) => ({ ...s, constraints: [...s.constraints, c] }));
    setEditing(c.id);
    setAdding('');
  };

  const addCard = (
    <>
      <div className="card">
        <h2>Add a rule</h2>
        <div className="chips">
          {QUICK.map((k) => (
            <button key={k} type="button" className="chip" onClick={() => add(k)}>
              + {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="add-row">
          <select value={adding} onChange={(e) => setAdding(e.target.value as ConstraintKind)} aria-label="Rule to add">
            <option value="">All rule types…</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!adding} onClick={() => adding && add(adding)}>
            Add
          </button>
        </div>
        {adding && <p className="muted small">{KIND_HELP[adding]}</p>}
        <p className="muted small">New rules open ready to edit. Tap any rule below to change it.</p>
      </div>
    </>
  );
  const ruleList = (
    <>
      <ul className="rules">
        {setup.constraints.map((c) => (
          <li key={c.id} className={`rule ${c.enabled ? '' : 'disabled'}`}>
            <div className="rule-head">
              <label className="switch" title="On / off">
                <input type="checkbox" checked={c.enabled} onChange={(e) => setC(c.id, { enabled: e.target.checked })} />
                <span className="sr-only">{KIND_LABELS[c.kind]} on</span>
                <i />
              </label>
              <button type="button" className="rule-text" onClick={() => setEditing(editing === c.id ? null : c.id)} aria-expanded={editing === c.id}>
                <span className="rule-kind">
                  {KIND_LABELS[c.kind]}
                  <span className={`badge ${c.mode}`}>{c.mode === 'hard' ? 'Must' : `Try to · ${WEIGHT_LABELS[c.weight]}`}</span>
                </span>
                <span className="rule-desc">{describeConstraint(c, settings)}</span>
              </button>
              {editing !== c.id && (
                <button type="button" className="btn ghost small edit-btn" onClick={() => setEditing(c.id)} aria-label={`Edit ${KIND_LABELS[c.kind]}`}>
                  Edit
                </button>
              )}
            </div>
            {editing === c.id && (
              <div className="rule-edit">
                <p className="muted small">{KIND_HELP[c.kind]}</p>
                <div className="segmented small">
                  <button type="button" className={c.mode === 'hard' ? 'active' : ''} onClick={() => setC(c.id, { mode: 'hard' })}>
                    Must
                  </button>
                  <button type="button" className={c.mode === 'soft' ? 'active' : ''} onClick={() => setC(c.id, { mode: 'soft' })}>
                    Try to
                  </button>
                </div>
                {c.mode === 'soft' && (
                  <div className="segmented small">
                    {(['low', 'medium', 'high'] as Weight[]).map((w) => (
                      <button key={w} type="button" className={c.weight === w ? 'active' : ''} onClick={() => setC(c.id, { weight: w })}>
                        {WEIGHT_LABELS[w]}
                      </button>
                    ))}
                  </div>
                )}
                <Editor c={c} settings={settings} set={(patch) => setC(c.id, patch)} />
                <div className="row-btns">
                  <button type="button" className="btn small" onClick={() => setEditing(null)}>
                    Done
                  </button>
                  <button type="button" className="btn danger ghost small" onClick={() => remove(c.id)}>
                    Remove rule
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );

  if (compact)
    return (
      <section className="rules-panel">
        <header className="panel-head">
          <h2>Rules</h2>
          <p className="muted small">
            <b>Must</b> always holds; <b>Try to</b> is a preference. Changes apply next time you generate or rebalance.
          </p>
        </header>
        {ruleList}
        {!setup.constraints.length && <p className="muted small">No rules yet.</p>}
        {addCard}
      </section>
    );

  return (
    <section className="screen">
      <header className="screen-head">
        <h1>Rules</h1>
        <p className="muted">
          <b>Must</b> rules always hold. <b>Try to</b> rules are preferences, traded off by weight.
        </p>
      </header>

      <div className="card presets">
        <h2>Start from a preset</h2>
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="preset" onClick={() => applyPreset(p.id)}>
            <b>{p.name}</b>
            <span className="muted small">{p.description}</span>
          </button>
        ))}
      </div>

      {addCard}

      <div className="card builtins">
        <h2>Always on</h2>
        <ul className="plain small">
          <li>One player in each position, nobody in two places.</li>
          <li>Only available players, in positions they're allowed to play.</li>
          <li>Changes only at substitution points ({settings.match.sub_points.join(', ') || 'none'} min).</li>
          <li>Goalkeeper only changes at {settings.match.gk_change_points.join(', ') || 'no point'} min.</li>
        </ul>
      </div>

      {ruleList}

      {!setup.constraints.length && <p className="muted">No rules yet. Pick a preset or add a rule above.</p>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function MinutesInput({ value, onChange, allowEmpty, step, max }: { value: number | null; onChange: (v: number | null) => void; allowEmpty?: boolean; step: number; max: number }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : +e.target.value)}>
      {allowEmpty && <option value="">No limit</option>}
      {Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step).map((v) => (
        <option key={v} value={v}>
          {v} min
        </option>
      ))}
    </select>
  );
}

function PlayerPicker({ settings, value, onChange, allLabel }: { settings: Settings; value: string[]; onChange: (ids: string[]) => void; allLabel: string }) {
  return (
    <div className="field">
      <span>Players {value.length === 0 && <em className="muted">({allLabel})</em>}</span>
      <div className="chips">
        {settings.squad.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`chip toggle ${value.includes(p.id) ? 'active' : ''} ${p.available ? '' : 'faded'}`}
            aria-pressed={value.includes(p.id)}
            onClick={() => onChange(value.includes(p.id) ? value.filter((x) => x !== p.id) : [...value, p.id])}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlayerSelect({ settings, value, onChange, label }: { settings: Settings; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {settings.squad.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.available ? '' : ' (not playing)'}
          </option>
        ))}
      </select>
    </Field>
  );
}

function CountInput({ value, onChange, max }: { value: number | null; onChange: (v: number | null) => void; max: number }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : +e.target.value)}>
      <option value="">No limit</option>
      {Array.from({ length: max + 1 }, (_, i) => (
        <option key={i} value={i}>
          {i}
        </option>
      ))}
    </select>
  );
}

function Editor({ c, settings, set }: { c: Constraint; settings: Settings; set: (patch: Partial<Constraint>) => void }) {
  const m = settings.match;
  const step = m.slot_length_min;
  const total = totalMinutes(m);
  const set2 = set as (patch: Record<string, unknown>) => void;
  switch (c.kind) {
    case 'even_time':
      return (
        <Field label="Totals differ by at most">
          <MinutesInput value={c.maxDiff} onChange={(v) => set2({ maxDiff: v ?? 0 })} step={step} max={total} />
        </Field>
      );
    case 'minutes':
      return (
        <>
          <div className="grid2">
            <Field label="At least">
              <MinutesInput value={c.min} allowEmpty onChange={(v) => set2({ min: v })} step={step} max={total} />
            </Field>
            <Field label="At most">
              <MinutesInput value={c.max} allowEmpty onChange={(v) => set2({ max: v })} step={step} max={total} />
            </Field>
          </div>
          <PlayerPicker settings={settings} value={c.players} onChange={(players) => set2({ players })} allLabel="none picked = everyone" />
        </>
      );
    case 'role_balance':
      return (
        <>
          <div className="grid2">
            <Field label="Defence at least">
              <MinutesInput value={c.minDef} onChange={(v) => set2({ minDef: v ?? 0 })} step={step} max={total} />
            </Field>
            <Field label="Attack at least">
              <MinutesInput value={c.minAtt} onChange={(v) => set2({ minAtt: v ?? 0 })} step={step} max={total} />
            </Field>
          </div>
          <PlayerPicker settings={settings} value={c.players} onChange={(players) => set2({ players })} allLabel="none picked = every outfield player" />
        </>
      );
    case 'gk_share':
      return (
        <>
          <PlayerPicker settings={settings} value={c.players} onChange={(players) => set2({ players })} allLabel="none picked = anyone ticked GK" />
          <div className="grid2">
            <Field label="Each at least">
              <MinutesInput value={c.minEach} allowEmpty onChange={(v) => set2({ minEach: v })} step={step} max={total} />
            </Field>
            <Field label="Goal time within">
              <MinutesInput value={c.evenWithin} allowEmpty onChange={(v) => set2({ evenWithin: v })} step={step} max={total} />
            </Field>
          </div>
        </>
      );
    case 'role_blocks': {
      const qb = quarterBreaks(m);
      const inner = slotBoundaries(m).filter((x) => !qb.includes(x));
      return (
        <div className="field">
          <span>Also allow role swaps at</span>
          <div className="chips">
            {inner.map((x) => (
              <button
                key={x}
                type="button"
                className={`chip toggle ${c.exceptions.includes(x) ? 'active' : ''}`}
                aria-pressed={c.exceptions.includes(x)}
                onClick={() => set2({ exceptions: c.exceptions.includes(x) ? c.exceptions.filter((v) => v !== x) : [...c.exceptions, x] })}
              >
                {x}′
              </button>
            ))}
            {!inner.length && <span className="muted small">No points inside quarters.</span>}
          </div>
        </div>
      );
    }
    case 'position_stability':
      return (
        <Field label="Position changes per player (while staying on)">
          <CountInput value={c.maxChanges} onChange={(v) => set2({ maxChanges: v ?? 0 })} max={6} />
        </Field>
      );
    case 'max_bench':
      return (
        <Field label="Longest time on the bench">
          <MinutesInput value={c.maxMinutes} onChange={(v) => set2({ maxMinutes: v ?? 0 })} step={step} max={total} />
        </Field>
      );
    case 'start_finish':
      return null;
    case 'together':
    case 'apart':
      return (
        <>
          <div className="grid2">
            <PlayerSelect settings={settings} label="Player" value={c.a} onChange={(a) => set2({ a })} />
            <PlayerSelect settings={settings} label="and" value={c.b} onChange={(b) => set2({ b })} />
          </div>
          <Field label="Option">
            <select value={c.scope} onChange={(e) => set2({ scope: e.target.value })}>
              {c.kind === 'together' ? (
                <>
                  <option value="pitch">On the pitch at the same time</option>
                  <option value="side">…and on the same side</option>
                  <option value="unit">…and in the same unit (defence / attack)</option>
                </>
              ) : (
                <>
                  <option value="pitch">Never on the pitch together</option>
                  <option value="unit">Never in the same unit</option>
                </>
              )}
            </select>
          </Field>
          {c.a === c.b && <p className="warn-text small">Pick two different players.</p>}
        </>
      );
    case 'group_mix': {
      const groups = [...new Set(settings.squad.map((p) => p.group).filter(Boolean))];
      return (
        <>
          <Field label="Group">
            <select value={c.group} onChange={(e) => set2({ group: e.target.value })}>
              {[...new Set([c.group, ...groups])].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid2">
            <Field label="At least">
              <CountInput value={c.min} onChange={(v) => set2({ min: v })} max={settings.positions.length} />
            </Field>
            <Field label="At most">
              <CountInput value={c.max} onChange={(v) => set2({ max: v })} max={settings.positions.length} />
            </Field>
          </div>
        </>
      );
    }
    case 'gk_plan':
      return (
        <>
          <GkPlanEditor settings={settings} keepers={c.keepers} onChange={(keepers) => set2({ keepers })} />
          <p className="muted small">Goalkeeper blocks come from the goalkeeper change points on the Match tab.</p>
        </>
      );
    case 'spells':
      return (
        <>
          <div className="grid2">
            <Field label="At least (times on)">
              <CountInput value={c.min} onChange={(v) => set2({ min: v })} max={slotBoundaries(m).length + 1} />
            </Field>
            <Field label="At most (times on)">
              <CountInput value={c.max} onChange={(v) => set2({ max: v })} max={slotBoundaries(m).length + 1} />
            </Field>
          </div>
          <PlayerPicker settings={settings} value={c.players} onChange={(players) => set2({ players })} allLabel="none picked = everyone" />
          <p className="muted small">A “time on” is one continuous spell on the pitch, however long.</p>
        </>
      );
    case 'max_on':
      return (
        <>
          <Field label="Longest time on the pitch in a row">
            <MinutesInput value={c.maxMinutes} onChange={(v) => set2({ maxMinutes: v ?? step })} step={step} max={total} />
          </Field>
          <PlayerPicker settings={settings} value={c.players} onChange={(players) => set2({ players })} allLabel="none picked = everyone" />
          <p className="muted small">Only possible if there are substitution points often enough (Match tab).</p>
        </>
      );
    case 'rotate':
      return (
        <>
          <PlayerPicker settings={settings} value={c.players} onChange={(players) => set2({ players })} allLabel="none picked = everyone" />
          <p className="muted small">
            Applies at every substitution point ({m.sub_points.join(', ') || 'none'} min). The goalkeeper is not moved. If “Position
            stability” is also on, the two pull against each other: switch that one off or give this a higher weight.
          </p>
        </>
      );
    case 'side_pref':
      return (
        <div className="side-list">
          {settings.squad
            .filter((p) => !p.gk_only)
            .map((p) => {
              const v = c.sides[p.id] ?? '';
              const pick = (side: '' | 'L' | 'R') => {
                const sides = { ...c.sides };
                if (side) sides[p.id] = side;
                else delete sides[p.id];
                set2({ sides });
              };
              return (
                <div key={p.id} className={`side-row ${p.available ? '' : 'faded'}`}>
                  <span className="side-name">{p.name}</span>
                  <div className="segmented small" role="group" aria-label={`${p.name} preferred side`}>
                    {(
                      [
                        ['L', 'Left'],
                        ['', 'Either'],
                        ['R', 'Right'],
                      ] as const
                    ).map(([k, label]) => (
                      <button key={label} type="button" className={v === k ? 'active' : ''} aria-pressed={v === k} onClick={() => pick(k)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      );
    case 'pin': {
      const points = [0, ...slotBoundaries(m), total];
      return (
        <>
          <PlayerSelect settings={settings} label="Player" value={c.player} onChange={(player) => set2({ player })} />
          <Field label="Where">
            <select value={c.position} onChange={(e) => set2({ position: e.target.value })}>
              {settings.positions.map((q) => (
                <option key={q.code} value={q.code}>
                  {q.code} – {q.name}
                </option>
              ))}
              <option value="ON">On the pitch (any position)</option>
              <option value="BENCH">On the bench</option>
            </select>
          </Field>
          <div className="grid2">
            <Field label="From">
              <select value={c.from} onChange={(e) => set2({ from: +e.target.value, to: Math.max(+e.target.value + step, c.to) })}>
                {points.slice(0, -1).map((x) => (
                  <option key={x} value={x}>
                    {x} min
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To">
              <select value={c.to} onChange={(e) => set2({ to: +e.target.value })}>
                {points.filter((x) => x > c.from).map((x) => (
                  <option key={x} value={x}>
                    {x} min
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>
      );
    }
  }
}
