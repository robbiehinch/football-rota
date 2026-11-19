import { useState } from 'react';
import { newConstraint, referencedPlayers } from '../model/constraints';
import type { Setup } from '../model/io';
import { gkCodes, uid } from '../model/match';
import type { Player } from '../model/types';

interface Props {
  setup: Setup;
  update: (fn: (s: Setup) => Setup) => void;
}

export function SquadScreen({ setup, update }: Props) {
  const { squad, positions } = setup.settings;
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const gk = gkCodes(positions);
  const outfield = positions.filter((q) => q.role !== 'GK').map((q) => q.code);

  const setPlayer = (id: string, patch: Partial<Player>) =>
    update((s) => ({ ...s, settings: { ...s.settings, squad: s.settings.squad.map((p) => (p.id === id ? { ...p, ...patch } : p)) } }));

  /** Set a preferred side; the first time, also switch on the "Preferred side" rule (as a preference). */
  const setSide = (p: Player, side: 'L' | 'R' | undefined) =>
    update((s) => {
      const squad = s.settings.squad.map((x) => {
        if (x.id !== p.id) return x;
        const next = { ...x };
        if (side) next.side = side;
        else delete next.side;
        return next;
      });
      let constraints = s.constraints;
      if (side) {
        const rule = constraints.find((c) => c.kind === 'side_pref');
        if (!rule) constraints = [...constraints, newConstraint('side_pref', s.settings)];
        else if (!rule.enabled) constraints = constraints.map((c) => (c === rule ? { ...c, enabled: true } : c));
      }
      return { ...s, constraints, settings: { ...s.settings, squad } };
    });
  const sideRule = setup.constraints.find((c) => c.kind === 'side_pref' && c.enabled);

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const p: Player = { id: uid('p'), name, group: '', available: true, allowed_positions: outfield };
    update((s) => ({ ...s, settings: { ...s.settings, squad: [...s.settings.squad, p] } }));
    setNewName('');
  };

  const remove = (p: Player) => {
    if (!confirm(`Remove ${p.name} from the squad? Rules that mention only ${p.name} are removed too.`)) return;
    update((s) => ({
      ...s,
      settings: { ...s.settings, squad: s.settings.squad.filter((x) => x.id !== p.id) },
      constraints: s.constraints
        .filter((c) => !(['together', 'apart', 'pin'].includes(c.kind) && referencedPlayers(c).includes(p.id)))
        .map((c) => ('players' in c ? { ...c, players: c.players.filter((id) => id !== p.id) } : c))
        .map((c) =>
          c.kind === 'gk_plan' ? { ...c, keepers: Object.fromEntries(Object.entries(c.keepers).map(([k, v]) => [k, v === p.id ? '' : v])) } : c,
        ),
      rota: s.rota?.map((slot) => Object.fromEntries(Object.entries(slot).map(([k, v]) => [k, v === p.id ? null : v]))) ?? null,
    }));
  };

  const togglePos = (p: Player, code: string) => {
    const has = p.allowed_positions.includes(code);
    setPlayer(p.id, { allowed_positions: has ? p.allowed_positions.filter((c) => c !== code) : [...p.allowed_positions, code] });
  };

  const avail = squad.filter((p) => p.available).length;

  return (
    <section className="screen">
      <header className="screen-head">
        <h1>Squad</h1>
        <p className="muted">
          {squad.length} players · <b>{avail} available</b> for this match
        </p>
      </header>

      <ul className="squad">
        {squad.map((p) => {
          const canGk = p.gk_only || gk.some((c) => p.allowed_positions.includes(c));
          return (
            <li key={p.id} className={`squad-row ${p.available ? '' : 'unavailable'}`}>
              <div className="squad-main">
                <label className="switch" title="Available for this match">
                  <input type="checkbox" checked={p.available} onChange={(e) => setPlayer(p.id, { available: e.target.checked })} />
                  <span className="sr-only">{p.name} available</span>
                  <i />
                </label>
                <input
                  className="name-input"
                  value={p.name}
                  aria-label="Name"
                  onChange={(e) => setPlayer(p.id, { name: e.target.value })}
                />
                <label className={`tick ${canGk ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={canGk}
                    onChange={(e) =>
                      setPlayer(p.id, {
                        allowed_positions: e.target.checked
                          ? [...new Set([...gk, ...p.allowed_positions])]
                          : p.allowed_positions.filter((c) => !gk.includes(c)),
                        gk_only: e.target.checked ? p.gk_only : false,
                      })
                    }
                  />
                  GK
                </label>
                <button type="button" className="icon-btn" aria-expanded={open === p.id} aria-label={`More for ${p.name}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {open === p.id ? '▴' : '▾'}
                </button>
              </div>
              <div className="squad-sub">
                {!p.gk_only && (
                  <>
                    <span className="side-label">Side</span>
                    <span className="side-pick" role="group" aria-label={`${p.name} preferred side`}>
                      {(
                        [
                          ['L', 'L', 'Left'],
                          [undefined, 'Either', 'Either side'],
                          ['R', 'R', 'Right'],
                        ] as const
                      ).map(([v, label, title]) => (
                        <button
                          key={label}
                          type="button"
                          title={title}
                          aria-label={title}
                          className={p.side === v ? 'active' : ''}
                          aria-pressed={p.side === v}
                          onClick={() => setSide(p, v)}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  </>
                )}
                {p.gk_only && <span className="pill">GK only</span>}
                {!p.available && <span className="pill warn">Not playing</span>}
              </div>
              {open === p.id && (
                <div className="squad-more">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!p.gk_only}
                      onChange={(e) =>
                        setPlayer(p.id, {
                          gk_only: e.target.checked,
                          allowed_positions: e.target.checked ? [...new Set([...gk, ...p.allowed_positions])] : p.allowed_positions,
                        })
                      }
                    />
                    Only plays in goal
                  </label>
                  {!p.gk_only && (
                    <div className="field">
                      <span>Can play</span>
                      <div className="chips">
                        {positions.map((q) => (
                          <button
                            key={q.code}
                            type="button"
                            className={`chip toggle ${p.allowed_positions.includes(q.code) ? 'active' : ''}`}
                            aria-pressed={p.allowed_positions.includes(q.code)}
                            onClick={() => togglePos(p, q.code)}
                            title={q.name}
                          >
                            {q.code}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <button type="button" className="btn danger small" onClick={() => remove(p)}>
                    Remove {p.name}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input placeholder="New player's name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New player's name" />
        <button className="btn" type="submit" disabled={!newName.trim()}>
          Add
        </button>
      </form>
      <div className="card squad-help">
        <p className="small">
          <b>GK</b>: can go in goal. How goal time is shared is the <b>Goal time</b> rule on the Rules tab.
        </p>
        <p className="small">
          <b>Side</b>: L or R to prefer the left or right of the pitch.{' '}
          {sideRule
            ? `Used by the Preferred side rule (${sideRule.mode === 'hard' ? 'Must' : 'Try to'}); change how strict on the Rules tab.`
            : 'Setting one switches on the Preferred side rule (as a preference).'}
        </p>
        <p className="small">Tap ▾ to choose which positions a player can play, or to remove them.</p>
      </div>
    </section>
  );
}
