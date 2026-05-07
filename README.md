# Microbes

Standalone canvas simulation: biological cells that split into two when tapped, or randomly every ~10 seconds. Splits are rendered with a coarse-grid metaball algorithm so daughters visually pinch off from the parent. Retro look — thick black outlines, darker nucleus, warm "inside-of-a-vessel" background.

## Live demo

Deployed to GitHub Pages: **<https://blurayne.github.io/microbes/>**

## Run locally

No build step. Serve the directory with any static HTTP server:

```sh
git clone https://github.com/blurayne/microbes.git
cd microbes
python3 -m http.server 8765
# then open http://localhost:8765/
```

Any other static server works too (`npx http-server`, `php -S`, etc.). Opening `index.html` directly via `file://` also works since there are no `fetch()` calls.

## How to use

- **Tap / click a cell** to make it split into two.
- Cells also auto-split on a per-cell timer (default ~10 s, with ±30% jitter).
- Click the **gear button** (bottom-right) to open settings.

## Settings

| Control | Effect |
| --- | --- |
| Split mode | `pushApart` — daughters fly apart with momentum and Brownian drift. `bondDrift` — daughters stay loosely connected for ~2 s before separating. `fixedGrid` — cells snap to a hex grid; daughters claim the nearest free slot. |
| Max cells | 2–128. New splits are blocked once the population reaches this cap. |
| Auto-split seconds | Mean interval between automatic splits per cell. |
| Background flow | Speed multiplier for the diffuse "blood vessel" lighting. |
| Outline px | Thickness of the black outline around cells. |
| Show metaball field | Debug overlay drawing the underlying blob radii and the hex grid. |
| Reset simulation | Clear all cells and seed one fresh cell at the centre. |

Settings persist in `localStorage` (`microbes.settings.v1`). Refresh-safe.

## Architecture

- `index.html` — canvas, gear button, sliding settings panel.
- `assets/main.js` — single self-contained module:
  - **Cells** with state machine (`NORMAL` ↔ `SPLITTING`) and per-cell auto-split timer.
  - **Movement** for the three split modes, with Brownian jitter, soft pairwise repulsion and a margin spring.
  - **Metaball pipeline** rendering at 1/2 resolution to an offscreen canvas: additive radial blobs → `filter: blur(8px) contrast(28)` → hard alpha mask. The mask is then blitted at 8 cardinal/diagonal offsets in black for the thick outline, tinted pink via `globalCompositeOperation = 'source-in'` for the cytoplasm fill, and re-tinted for an inner highlight.
  - **Nuclei** drawn as plum discs with a black outline and a small highlight; during a split the single nucleus interpolates into two along the split axis.
  - **Background** painted as 7 slow-moving radial gradients plus a top/bottom vignette pulse.
- `assets/styles.css` — full-window canvas, gear button, settings panel.

## Deployment

`.github/workflows/pages.yml` publishes the static site to the `github-pages` environment on every push to `main` (and to the active feature branch). To enable:

1. Repo → **Settings → Pages → Source = GitHub Actions**.
2. Push to `main` (or trigger **Run workflow** manually).
3. The deployed URL is published as the workflow's environment URL — typically <https://blurayne.github.io/microbes/>.
