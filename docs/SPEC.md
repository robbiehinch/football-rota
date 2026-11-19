# Rota Builder — brief for a web front end

## What this is

A small web app for the coaches of a U8 five-a-side football team. It produces a substitution rota for one match: who plays which position in each 5-minute slot, and who is on the bench. Coaches choose the squad and a set of constraints (equal minutes, players together or apart, a balance of defence/attack/goal), and the app generates rotas that satisfy them. Coaches can then tweak the result by hand and share it in the coaches' WhatsApp group.

Three volunteer parent coaches will use it, mostly **on their phones**, usually shortly before a match. They aren't developers. It should therefore be mobile-first and quick, with plain-English labels.

The included `rota.json` holds the rota the coaches use now, as a worked example and test fixture (see "Reference rota" below).

---

## Domain model

### Match
- 4 quarters × 10 minutes = 40 minutes.
- Time is divided into **slots** of 5 minutes, so a match has 8 slots. Make the slot length and number of quarters configurable, but default to 5 minutes and 4.
- **Substitution points** are slot boundaries where changes are allowed. Coaches set which ones are open, for example:
  - every 5 minutes (all 7 boundaries), or
  - quarter breaks only (10, 20, 30), plus specific extra points (such as 5 and 35).

### Positions (5 on the pitch)
| Code | Name | Role |
|---|---|---|
| GK | Goalkeeper | GK |
| LD | Left defence | DEF |
| RD | Right defence | DEF |
| LA | Left attack | ATT |
| RA | Right attack | ATT |

Store positions as data (code, name, role, side), not hard-coded, so another formation can be added later.

### Players
Each player has:
- `name`
- `group`: a colour tag. The current chart uses **blue** and **yellow**. Treat these as free-form labels the coaches define; don't build in any meaning.
- `available`: whether the player is playing in this match (absences happen often)
- `allowed_positions`: by default every outfield position. GK is allowed only if ticked.
- `gk_only`: optional. The current rota has one player, Jake, who only ever plays in goal.

### Rota
A grid of slots × positions → player. Anyone not in a slot is on the bench for that slot. Derived per-player stats:
- total minutes
- minutes per role (GK, DEF, ATT) and per position
- number of separate spells on the pitch, and the longest continuous spell on the bench

---

## Constraints

Split them into **hard** rules (must hold, or there's no solution) and **soft** preferences (weighted, traded off in an objective). Each constraint is a row in a constraint list that coaches can add, edit, switch on or off, and remove. Each soft one has a weight: Low, Medium or High.

### Hard (built in)
1. Exactly one player in each position in every slot, and no player in two positions at once.
2. Only available players are used, and only in their `allowed_positions`.
3. Changes only happen at open substitution points. Outside them, whoever is on the pitch and where they play stays the same.
4. **GK fixed per block:** the goalkeeper only changes at chosen points (default: quarter breaks).

### Configurable (coaches choose hard or soft)
| Constraint | Example setting |
|---|---|
| Even playing time | Total minutes per player differ by at most N minutes (default 5) |
| Minimum / maximum minutes | Everyone plays at least 20 minutes; nobody more than 30 |
| Role balance | Each outfield player gets at least X minutes in DEF and at least X in ATT |
| GK share | Only listed players go in goal; GK time is split evenly among them |
| Role blocks | Outfield players hold one role for a whole quarter (a "10-minute DEF block / ATT block"), with exceptions at chosen 5-minute points |
| Position stability | Keep position changes during a spell on the pitch to a minimum |
| Max bench spell | Nobody sits out more than N minutes in a row |
| Start/finish | Everyone gets at least one spell in the first half and one in the second |
| Play together | Players A and B are on the pitch at the same time (option: on the same side or in the same unit) |
| Keep apart | Players A and B are never on the pitch at the same time (or never in the same unit) |
| Group mix | At least / at most N players from a group (such as blue) on the pitch in every slot |
| Pin | Fix a cell: e.g. Jake in GK 0–10, or Martha starts on the bench |

### Solving
- The problem is small: 8 slots × 5 positions × about 9 players. It can run entirely in the browser.
- Either use an integer-programming solver compiled to WebAssembly (e.g. `highs-js` or `glpk.js`) with binary variables `x[player][slot][position]`, or write a backtracking search with pruning. Choose whichever is simpler to keep correct; ILP will make soft constraints and weights easier.
- **Return several distinct solutions** (e.g. up to 5, ranked by score), not just one. The coaches' current rules allow hundreds of valid grids — about 324 grids fit the current totals and block rules — so options matter.
- **If there's no solution, explain why in plain words.** Report which constraints conflict (e.g. "can't give 9 players equal time with GK fixed for 10 minutes and Jake GK-only"). A simple approach is to drop constraints one at a time to find a minimal conflicting set.
- Results must be deterministic for the same input, plus a "shuffle" button for a different valid option.

---

## Screens

1. **Squad**: list of players with name, group colour, available toggle, GK allowed, GK-only. Add, rename, delete.
2. **Match settings**: quarters, slot length, open substitution points, GK change points.
3. **Constraints**: the list described above, with presets:
   - "Coaches' current rules" (reproduces the reference rota's rules)
   - "Equal time everyone"
4. **Results**: one card per generated option, each showing the three views from the coaches' current chart:
   - **Rotation graph**: rows = players, columns = time (0–40). Each cell is labelled with the position code, coloured by the player's group, with OFF cells greyed out. Quarter boundaries are marked.
   - **By time**: one row per substitution window (e.g. 0–5, 5–10, 10–20 …), listing who's on and who's OFF.
   - **Shifts**: a bar per player showing total minutes (e.g. "5 × 5m = 25m"), with role breakdown on tap.
   - Highlight a player across all views on tap.
   - Show any broken soft constraints on the card ("Alex sits 20 min in a row").
5. **Edit**: tap two cells to swap them, or drag a player into a slot. Validation updates live, showing hard-rule breaks in red and soft ones in amber.
6. **Share**:
   - copy as WhatsApp-formatted text (see below)
   - export the rotation graph as an image (PNG), sized for a phone screen
   - printable view for a clipboard on the touchline

### WhatsApp text format (example)
```
*Match rota* (40 min, subs at 5/10/20/30/35)
*0-5* GK Jake · LD George · RD Joseph · LA Martha · RA Cass
   OFF: Rufus, Albie, Milo, Alex
*5-10* GK Jake · LD George · RD Albie · LA Martha · RA Cass
   OFF: Joseph, Rufus, Milo, Alex
...
*Minutes:* Joseph 25 · Rufus 25 · Albie 25 · Cass 25 · Jake 20 · Milo 20 · George 20 · Martha 20 · Alex 20
```

---

## Technical

- Static single-page app with no backend: TypeScript, with React or Svelte, built with Vite. It should be deployable to GitHub Pages or similar.
- Save squad, settings and constraint sets in `localStorage`, and support export/import as JSON (same shape as `rota.json`) so coaches can pass a setup to each other.
- Keep the solver as a pure module separate from the UI, with unit tests.
- Validator: a pure function `validate(rota, settings, constraints)` → list of breaks. Both the solver tests and the Edit screen use it.
- Mobile-first layout. The rotation graph must be readable on a ~380px-wide screen (narrow columns, abbreviated labels, horizontal scroll as a fallback).

## Acceptance tests
1. Loading `rota.json` and validating it against the "Coaches' current rules" preset gives **zero hard breaks**.
2. With that preset, the solver returns the reference rota (or an equivalent) among its options, and every option it returns passes validation.
3. Marking one player unavailable still produces a valid rota for 8 players, or a clear explanation of why it can't.
4. A "keep apart" constraint on two players gives rotas where they never share a slot. Adding a contradictory "play together" for the same pair produces a plain-English conflict message.
5. The minutes and role totals in the Shifts view match the `summary_check` block in `rota.json`.

---

## Reference rota (current coaches' plan)

`rota.json` has the full data. Summary, one row per 5-minute slot:

| Min | GK | LD | RD | LA | RA | Bench |
|---|---|---|---|---|---|---|
| 0-5 | Jake | George | Joseph | Martha | Cass | Rufus, Albie, Milo, Alex |
| 5-10 | Jake | George | Albie | Martha | Cass | Joseph, Rufus, Milo, Alex |
| 10-15 | Joseph | Milo | Cass | Alex | Rufus | Jake, Albie, George, Martha |
| 15-20 | Joseph | Milo | Cass | Alex | Rufus | Jake, Albie, George, Martha |
| 20-25 | Rufus | Martha | Albie | George | Joseph | Jake, Cass, Milo, Alex |
| 25-30 | Rufus | Martha | Albie | George | Joseph | Jake, Cass, Milo, Alex |
| 30-35 | Jake | Cass | Alex | Milo | Albie | Joseph, Rufus, George, Martha |
| 35-40 | Jake | Alex | Rufus | Milo | Albie | Joseph, Cass, George, Martha |

Groups: **blue** = Joseph, Rufus, Albie, Cass. **Yellow** = Jake, Milo, George, Martha, Alex.

What the "Coaches' current rules" preset should encode, as seen in this rota:
- GK changes only at quarter breaks: Jake 0–10, Joseph 10–20, Rufus 20–30, Jake 30–40. Jake is GK-only.
- Substitution points: 5, 10, 20, 30, 35. No changes at 15 or 25.
- Outfield players hold a DEF or ATT role for a whole 10-minute quarter. The 5-minute exceptions:
  - at 5, Albie replaces Joseph at RD
  - at 35, Rufus comes on at RD, Alex moves RD → LD, and Cass goes off
- Every outfield player gets at least 10 minutes DEF and 10 minutes ATT. The exception is Joseph and Rufus, who also go in goal: they get 10 GK, 10 ATT and 5 DEF.
- Total minutes: blue 25, yellow 20. Either way, every player is within 5 minutes of everyone else.
