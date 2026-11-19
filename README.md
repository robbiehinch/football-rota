# Rota Builder

A small, phone-first web app for the coaches of a U8 five-a-side team. It builds the
substitution rota for one match: who plays which position in each 5-minute slot and
who is on the bench. The full brief is in [docs/SPEC.md](docs/SPEC.md).

It is a static single-page app (TypeScript + React + Vite) with no backend. Everything,
including the solver, runs in the browser, and the setup is saved in `localStorage`.

## Using it

| Screen | What it does |
|---|---|
| **Squad** | Players, group colour, available today, GK allowed, GK only, allowed positions |
| **Match** | Quarters, quarter and slot length, substitution points, goalkeeper change points, and **who's in goal** for each block (or let the app choose) |
| **Rules** | The constraint list: quick-add buttons, an Edit button on every rule, *Must* (hard) or *Try to* (soft, Low/Medium/High), presets. Rules include goalkeeper plan, times on the pitch (number of spells) and max time on in a row |
| **Options** | Up to 5 distinct rotas, best first, each with Rotation / By time / Subs / Shifts views. Cells are coloured by each player's total minutes (with a key). The Subs view lists every change, who comes on for whom and who moves, and flags mid-quarter subs. *Shuffle* gives a different set. If nothing fits, it lists the rules that clash |
| **Edit** | Tap two cells in a column to swap (or drag on a computer); put a player in a position or on the bench; live red/amber checks; undo |
| **Share** | WhatsApp text (optionally with a SUBS line at each change), PNG of the rotation graph, print view with the substitutions, export/import the setup as JSON |

On first open the app loads the coaches' current rota ([`rota.json`](rota.json)) with the
**Coaches' current rules** preset.

## Development

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run build` writes a static site to `dist/` with relative paths, so it can be served
from any sub-path. Pushing to `main` deploys it to GitHub Pages via
`.github/workflows/pages.yml` (enable Pages → "GitHub Actions" in the repo settings).

## How it works

```
src/model/     pure domain code (no UI)
  types.ts        players, positions, match settings, constraints, rota
  match.ts        slots, windows, helpers
  stats.ts        per-player minutes, role/position totals, spells, bench spells
  constraints.ts  plain-English descriptions and presets
  validate.ts     validate(rota, settings, constraints) -> list of breaks
  io.ts           import/export in the rota.json shape
  edit.ts         swap / place helpers used by the Edit screen
  subs.ts         who comes on / goes off / moves at each change
  colors.ts       colour players by total minutes
src/solver/    pure solver module
  model.ts        builds the integer program (CPLEX LP text)
  solve.ts        generate(): options, ranking, shuffle, conflict explanation
  worker.ts       runs the solver in a Web Worker
src/share/     WhatsApp text and PNG export
src/ui/        React screens
```

**Solver.** An integer program solved by [HiGHS](https://highs.dev) compiled to
WebAssembly (`highs` on npm). The binary variables are `x[player][window][position]`,
where a *window* is a run of slots with no open substitution point. That builds the
"no changes between sub points" rule into the variables. Hard rules are constraints.
Soft rules get slack variables, weighted Low = 1, Medium = 3, High = 10 per unit
(per slot of minutes, per slot, or per occurrence). The weights match the
validator's score exactly, and a test checks this.

- **Several options:** after each solution a "no-good" cut forces the next one to
  differ in at least ~20% of cells (falling back to 2). Options are ranked by score.
- **Fast path:** it first tries with every preference treated as a must. Any rota
  found that way scores 0 and is optimal. It falls back to the weighted model only
  when that fails.
- **Deterministic:** the same input gives the same options. *Shuffle* adds tiny
  seeded noise to the objective, small enough never to trade away a preference.
- **No solution:** a deletion filter drops rules one at a time and keeps only those
  needed for the clash, giving a minimal conflicting set, e.g. *"Everyone's total
  minutes within 5 min of each other · Jake only plays in goal · Goalkeeper only
  changes at 10/20/30 min"*. Simple cases (too few players, nobody allowed in goal)
  get a direct message.
- **Time budget:** if a weighted solve is slow, generation stops after about
  8 seconds and returns the options it has found so far.

**Validator.** `validate()` is independent of the solver and works on the per-slot
grid, so it also checks hand edits. Every option the solver returns is re-validated,
and the tests compare the two.

## Acceptance tests

All in `src/**/*.test.ts` (`npm test`):

1. `rota.json` validated against *Coaches' current rules* has zero hard breaks (and zero soft ones).
2. With that preset, all 5 options pass validation and score as well as the reference rota.
   Pinning every cell of the reference reproduces it exactly, so it is in the solution space.
3. Marking each player unavailable in turn gives either valid 8-player rotas or a
   plain-English list of clashing rules.
4. Keep apart → never on together; adding play together for the same pair →
   "Milo and Martha never on the pitch together / Milo and Martha play together".
5. Shifts totals (minutes, by role, by position) match `summary_check` in `rota.json`.

## Notes on the "Coaches' current rules" preset

It reproduces the rules visible in the reference rota:

- Subs at 5/10/20/30/35, and the keeper changes at quarter breaks.
- Everyone within 5 min of each other.
- Only players ticked for GK go in goal, at least 10 min each.
- One role (defence/attack) per quarter.
- Outfield-only players get ≥10 min in defence and in attack. Players who also keep goal
  get ≥5 of each.
- Everyone plays in both halves.
- Preferences: nobody on the bench for more than 20 min; at most one position change per spell.

Player lists in the preset come from the squad's GK ticks, so the preset still works
after renaming or adding players.
