# Plan 17 — HUD rework: rename + move-to-debug + unified style + every-branch build stamp

## Context

The three top-left HUD toggles (Show FPS, Show build info, Show
object count) were tucked into Settings → Look despite being
debug aids. Their visual styles also diverged:

* `#build` — 11 px, opacity 0.55, background `#00000044`.
* `#fps` — 700 12 px (bold), opacity 0.85, background `#00000060`.
* "object count" rode along on the FPS line and counted
  cells + particles, contradicting its name.

User asked for: (1) rename + move to Debug, (2) unified pill
style — build's size, fps's colours, opacity midway, (3) wrap the
build line to two rows when the branch name is longer than 5
characters, (4) the build stamp should reflect the actual branch
for every workflow run (not just main).

## Approach

### 1. UI re-home + rename

Three checkboxes move from Settings → Look to Settings → Debug.
Labels:

* `Show FPS` → `Show FPS + renderer` (clarifies the renderer
  suffix is part of the same toggle).
* `Show build info` — unchanged.
* `Show object count` → `Show cell total`.

i18n keys: `show_object_count` → `show_cell_total`; renamed in
all 6 locales (en, de, es, bar, sat, la).

State field renamed `showObjectCount` → `showCellTotal`. Migration
shim in `loadSettings` copies the old persisted boolean across +
deletes the legacy key.

### 2. Cell total now means cells

`updateFPS` previously appended `${cells + parts} objs`. New
behaviour: `${cells} cells`. The label and the displayed number
now agree.

### 3. Multi-row build stamp

`renderBuildStamp()` checks `b.branch.length > 5`; if true, the
branch is hoisted to its own line (`<br>` in innerHTML, with
HTML-escaping for the few unsafe characters). Body class
`build-2line` is toggled so the CSS rule `body.show-build.build-2line
#fps.on { top: 50px }` slides the FPS pill down to clear the
two-row build pill.

### 4. Unified pill style

`#build` and `#fps` share the base rule now:

```css
#build, #fps {
  position: fixed; top: 10px; left: 12px; z-index: 9;
  font: 11px/1.3 ui-monospace, ...;
  color: var(--ink); opacity: 0.70;
  background: #00000060;
  text-shadow: 0 1px 2px #000a;
  padding: 3px 8px; border-radius: 6px;
  display: none;
}
```

`#fps` keeps `font-weight: 700` so the live counter reads
slightly heavier than the static build pill (it updates 4× per
second — bold helps the eye anchor it). Both share the 0.70
opacity and the FPS-style colours per the user spec.

### 5. Pages workflow split

`pages.yml` `on:` widens from `branches: [main]` to `branches:
['**']`. The `build` job (tests + docs + stamp +
upload-pages-artifact) runs on every branch push so every
artifact carries real branch/sha/run/date in `assets/build.js`.

The `deploy` job gates on `if: github.ref == 'refs/heads/main'`
— GitHub Pages can still only host the one site, but feature
branches now stamp correctly for visual tests + artifact
downloads.

`concurrency.group` becomes `pages-${{ github.ref }}` so a fast
main push during a feature-branch build doesn't cancel it.

## Critical files

* `index.html` — moved three `<label>`s from Look to Debug.
* `assets/core/state.js` — renamed field, i18n keys for 6
  locales, migration shim.
* `assets/app.js` — rename `S.showObjectCount` → `S.showCellTotal`,
  cells-only counter, multi-row build stamp, `build-2line` body
  class toggle.
* `assets/styles.css` — `#build` + `#fps` share a base rule, new
  `.build-2line` offset.
* `.github/workflows/pages.yml` — wildcard branch trigger,
  per-ref concurrency, deploy gated to main.

## Verification

* `node --test` — 35/35 green.
* `canvas2d`, `webgl2`, `webgpu` import OK.
* Manual:
  - Settings → Debug shows the three toggles in order.
  - Show FPS on (renderer suffix present), Show build info on:
    pills stack cleanly; same size, same colour, opacity 0.70 on
    both.
  - On a feature branch (`claude/hud-rework`, 17 chars > 5) the
    build pill wraps; FPS pill slides to top:50px.
  - Show cell total appends `· N cells` after the renderer, no
    particles.
  - localStorage with `showObjectCount: true` from before the
    rename: toggle starts ON after migration.

## Branch

`claude/hud-rework`.
