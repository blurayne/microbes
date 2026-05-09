# Plan #3 — Free Game implementation

## Context

User: "implement 'free game mode' as state in docs folder. implement
all cells and enemies. game starts in free game mode only. implement
all cells to cell and cell to enemy etc. behavior. their speed,
size etc add the ability to emit antibodies and destroy cells. add
a HUD (switchable on/off in settings) stating what type of good guys
we need in the current scene (and how many). in free game mode you
never get killed."

The Free Game design lives in `docs/ch04-konzept.md` §4.3. This plan
**ships the implementation** to match the doc. Big enough that it
should split into 3-4 sub-PRs.

## Approach (4 sub-PRs)

### PR 3a — Mode flag + boot logic

- Add `S.gameMode = 'free'` to `DEFAULTS`. Field can take
  `'free' | 'campaign' | 'survival'`; only `'free'` is wired.
- Boot path: `app.js` checks `S.gameMode` and skips any
  campaign-mode setup (HUD lifebar, win/lose, wave scheduling).
  Boots into Free Game with the simulator running.
- Drop / disable Campaign + Survival code paths until those modes
  are designed.
- Settings UI: dropdown `Game mode → Free / Campaign (soon) / Survival (soon)`,
  with the latter two disabled.

### PR 3b — Cell-vs-cell interaction matrix

- Each `CELL_TYPES[k]` entry already has `move`, `field`,
  `hostility`, `granules`. Today the sim's cell-to-cell logic is
  a generic radius-based nudge.
- New: per-pair targeting rules. For each ordered pair `(attacker,
  target)`, define:
  - `attractRadius` — start tracking
  - `attackRadius` — engage
  - `damagePerSec` — applied to target
- Tabulate the rules in `core/sim-rules.js` (new file). Examples:
  - Macrophage → any pathogen: attract 200, attack 60, dps 5
  - NK → virus / amoeba: attract 220, attack 40, dps 10
  - Eosinophil → amoeba / mite: attract 240, attack 40, dps 12
  - virus → RBC: attract 80, attack 40, dps 0 (infect = state
    change, not damage; future ramp)
- Sim update loop: per cell, find nearest target by rule, steer
  toward it, apply damage when in range. Death when HP ≤ 0.
- Per-type speed/size already in `move.patrolSpeed/attackSpeed`
  and `r`. Just use them.

### PR 3c — Antibody projectile + B-cell emit

- New entity `Antibody`: small projectile, has owner cell + target
  pathogen + lifetime.
- B-cells passively emit antibodies every N seconds when a target
  is in `field.contrast` range. Antibody travels in a straight line
  toward the target's last known position. On hit: target HP -= X.
- Renderer pass: small Y-shaped sprite (or just a coloured line)
  per antibody. Reuse the existing decoration line/tri pipelines.
- All four renderers; canvas2d as the simplest reference.

### PR 3d — Composition HUD + invulnerable player

- Composition HUD: corner widget listing cell types still needed
  to counter on-field pathogens. E.g. shows "+1 Eos · +2 NK".
  Source: §10 damage matrix filtered by what's currently spawned.
- Settings toggle `S.compositionHud` (default ON in Free Game).
  Position: top-right corner above the lifebars.
- Invulnerable player: `S.gameMode === 'free'` skips the win/lose
  check entirely.

## Critical files

- `assets/core/state.js` — `gameMode`, `compositionHud` defaults
  + i18n.
- `assets/core/sim.js` — interaction matrix lookup, antibody
  update loop.
- `assets/core/sim-rules.js` (new) — per-pair targeting table.
- `assets/app.js` — boot mode-gating, HUD render hooks, settings
  binds.
- `assets/render/canvas2d.js` / `webgl2.js` / `webgpu.js` — antibody
  draw passes.
- `index.html` — mode dropdown + HUD toggle + composition HUD div.
- `docs/ch04-konzept.md` — mark Free Game as implemented; cross-ref
  the merge PR #s.

## Verification

Per sub-PR:
1. `node --test` clean.
2. Free Game boots without scheduler/lifebar/win-lose chrome.
3. Spawning various combinations (e.g. macrophage + virus + B-cell):
   macrophage tracks virus, B-cell emits antibodies, antibodies
   destroy virus. Composition HUD reflects what's missing.
4. Killing all the player's cells does NOT trigger a Game Over
   screen (invulnerable player).
5. All four renderers tested.

## Branch

`claude/free-game-3a`, `…3b`, `…3c`, `…3d` (off main, sequential).
