import type { Setup } from '../model/io';
import { quarterBreaks, slotBoundaries, slotCount, totalMinutes } from '../model/match';
import type { MatchSettings } from '../model/types';

interface Props {
  setup: Setup;
  update: (fn: (s: Setup) => Setup) => void;
}

function divisors(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1).filter((d) => n % d === 0 && d >= 2);
}

export function MatchScreen({ setup, update }: Props) {
  const m = setup.settings.match;
  const bounds = slotBoundaries(m);
  const qb = quarterBreaks(m);

  const setMatch = (patch: Partial<MatchSettings>) =>
    update((s) => {
      const next = { ...s.settings.match, ...patch };
      if (next.quarter_length_min % next.slot_length_min) next.slot_length_min = divisors(next.quarter_length_min).at(-1) ?? next.quarter_length_min;
      const b = slotBoundaries(next);
      const q = quarterBreaks(next);
      const shapeChanged = slotCount(next) !== slotCount(s.settings.match) || next.slot_length_min !== s.settings.match.slot_length_min;
      next.sub_points = patch.sub_points ?? (shapeChanged ? [...q] : next.sub_points.filter((x) => b.includes(x)));
      next.gk_change_points = patch.gk_change_points ?? (shapeChanged ? [...q] : next.gk_change_points.filter((x) => b.includes(x)));
      return { ...s, settings: { ...s.settings, match: next }, rota: shapeChanged ? null : s.rota };
    });

  const toggle = (key: 'sub_points' | 'gk_change_points', x: number) => {
    const cur = m[key];
    setMatch({ [key]: cur.includes(x) ? cur.filter((v) => v !== x) : [...cur, x].sort((a, b) => a - b) });
  };

  return (
    <section className="screen">
      <header className="screen-head">
        <h1>Match</h1>
        <p className="muted">
          {totalMinutes(m)} minutes · {slotCount(m)} slots of {m.slot_length_min} min
        </p>
      </header>

      <div className="card">
        <div className="grid3">
          <label className="field">
            <span>Quarters</span>
            <input type="number" min={1} max={8} value={m.quarters} onChange={(e) => setMatch({ quarters: Math.max(1, Math.min(8, +e.target.value || 1)) })} />
          </label>
          <label className="field">
            <span>Quarter (min)</span>
            <input
              type="number"
              min={2}
              max={45}
              value={m.quarter_length_min}
              onChange={(e) => setMatch({ quarter_length_min: Math.max(2, Math.min(45, +e.target.value || 2)) })}
            />
          </label>
          <label className="field">
            <span>Slot (min)</span>
            <select value={m.slot_length_min} onChange={(e) => setMatch({ slot_length_min: +e.target.value })}>
              {divisors(m.quarter_length_min).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Substitution points</h2>
        <p className="muted small">Minutes where changes are allowed. Between them, nobody comes on, goes off or moves.</p>
        <div className="chips">
          {bounds.map((x) => (
            <button
              key={x}
              type="button"
              className={`chip toggle ${m.sub_points.includes(x) ? 'active' : ''} ${qb.includes(x) ? 'qb' : ''}`}
              aria-pressed={m.sub_points.includes(x)}
              onClick={() => toggle('sub_points', x)}
            >
              {x}′
            </button>
          ))}
        </div>
        <div className="row-btns">
          <button type="button" className="btn ghost small" onClick={() => setMatch({ sub_points: [...bounds] })}>
            Every slot
          </button>
          <button type="button" className="btn ghost small" onClick={() => setMatch({ sub_points: [...qb] })}>
            Quarter breaks only
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Goalkeeper changes</h2>
        <p className="muted small">The keeper only changes at these points (they must also be substitution points).</p>
        <div className="chips">
          {bounds.map((x) => (
            <button
              key={x}
              type="button"
              className={`chip toggle ${m.gk_change_points.includes(x) ? 'active' : ''} ${qb.includes(x) ? 'qb' : ''}`}
              aria-pressed={m.gk_change_points.includes(x)}
              disabled={!m.sub_points.includes(x)}
              onClick={() => toggle('gk_change_points', x)}
            >
              {x}′
            </button>
          ))}
        </div>
        <div className="row-btns">
          <button type="button" className="btn ghost small" onClick={() => setMatch({ gk_change_points: qb.filter((x) => m.sub_points.includes(x)) })}>
            Quarter breaks
          </button>
        </div>
      </div>
      <p className="muted small">Bold outlines mark quarter breaks. Changing the match length clears the current rota.</p>
    </section>
  );
}
