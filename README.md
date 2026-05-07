# Microbes

Standalone canvas simulation: biological cells that split into two when tapped, or randomly every ~10 seconds. Splits are rendered with a coarse-grid metaball algorithm so daughters visually pinch off from the parent. Retro look — thick black outlines, darker nucleus, warm "inside-of-a-vessel" background.

## Run

No build step. Serve the directory and open the page:

```sh
python3 -m http.server 8765
# then open http://localhost:8765/
```

## Settings

The gear button (bottom-right) opens a panel with:

- **Split mode** — `pushApart`, `bondDrift`, or `fixedGrid`
- **Max cells** (2–128)
- **Auto-split seconds**
- **Background flow speed**
- **Outline px**
- **Show metaball field** (debug overlay)
- **Reset simulation**

Settings persist in `localStorage`.

## Deploy

The `.github/workflows/pages.yml` workflow publishes the site to GitHub Pages on push.
