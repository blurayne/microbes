# 08 — Shader test doc + multi-cell dropdown

## Context

User dropped an HTML file (a self-contained "cytologica" cell
shader sandbox: one WGSL fragment + one GLSL ES 3.00 fragment,
runtime renderer pick, side-by-side source view) and asked for it
to ship as `docs/shader-test.html`, linked from the docs index,
with a dropdown letting users browse the common immune-cell and
pathogen types — not just the single generic eukaryote the
upload demoed.

## Audit

- Upload at
  `/root/.claude/uploads/d2577694-6141-4013-9895-54b2e8714af3/92dc978c-cell_shader.html`
  — 1230 lines, self-contained, no external assets beyond Google
  Fonts.
- The shader pipeline (UBO `Uniforms` + uniform locations on the
  GLSL side) was already small and easy to extend with one more
  scalar field (`cellType`) without padding gymnastics — the
  WGSL struct already padded out to 32 bytes (8 floats) with
  only 6 fields used.
- The project's `CELL_TYPES` table (`state.js:834-1069`) holds 6
  immune cells + 8 pathogens = 14 types. Designing 14 distinct
  shader bodies in one PR is unrealistic; a representative 9-type
  set covers the common ones the user listed.
- mkdocs already serves raw `.html` files from `docs/` (asset
  passthrough) — no nav config change strictly required, just a
  link from `index.md`.

## Approach

### Shader refactor

A single `cellType` uniform (`f32`, `int(round(...))` to enum)
selects between **9 specimens**:

| # | Name | Membrane | Nucleus | Specials |
|---|---|---|---|---|
| 0 | eukaryote (default) | round + gentle wobble | round + nucleolus | 8 mitochondria, 14 vesicles |
| 1 | macrophage | irregular larger blob | kidney-shaped | 22 lysosome vesicles |
| 2 | neutrophil | smooth small blob | 3-lobed (signature multi-lobe) | 30 fine granules |
| 3 | nk-cell | smooth small | dominant large nucleus | 6 large bright cytotoxic granules, blue tint |
| 4 | b-cell | smooth medium | round | rough-ER stripe pattern in cytoplasm |
| 5 | virus | hex capsid + spike rim | none | hex-lattice capsid pattern, indigo core |
| 6 | bacterium | rod (capsule SDF) | none | wiggling flagellum tail, green |
| 7 | amoeba | irregular blob with longer pseudopod arms | eccentric, off-centre | dark food-vacuole vesicles |
| 8 | spore | small disc | none | double-wall ring, amber, dormant |

Three pure helpers per language do the per-type lookup:
`membraneFor(uv, kind, t)`, `cytoColor(kind)`,
`nucleusSdf(uv, kind, t)`. Special features (B-cell rough-ER,
virus capsid pattern, bacterium flagellum, spore double-wall)
are tiny inline branches in `main`.

The WGSL and GLSL paths stay byte-equivalent in math (the
project's "one shader, two targets" identity).

### UI

A `<select id="celltype">` is added at the top of the existing
controls panel (above zoom/activity/organelles). Styled with
the same monospaced palette as the other ctrls. Wired to a new
`params.cellType` value; both renderer paths read it on each
frame.

UBO layout: still 8 floats (32 bytes) — `cellType` slots into
`cpuBuf[6]`, `[7]` remains alignment padding. WebGL2 path adds
a `u_cellType` uniform location lookup + `uniform1f` upload.

### Docs link

`docs/index.md` gets a new "◆ Live-Demo" block above the
chapter TOC, linking to `shader-test.html`. The link is a
relative path so it works under both the local mkdocs dev server
and the deployed `docs/_book/` build.

## Critical files

- `docs/shader-test.html` (new — copied from the upload, then
  shaders + UI + JS extended for the dropdown).
- `docs/index.md` — added a Live-Demo block + link.

## Verification

- `node --test` clean (the shader-test page is not imported by
  any sim/render module — pure docs asset).
- Brace counts balanced in both shader blocks.
- `cellType` uniform threaded through both backends (WGSL
  struct, GLSL `uniform`, JS UBO write, JS `uniform1f`).
- **Manual** (browser): open `docs/shader-test.html`. Default
  view = eukaryote. Switch the specimen dropdown — each option
  produces a visually distinct cell. WebGPU badge shows when
  `navigator.gpu` exists; otherwise WebGL2 fallback badge
  appears in the warn colour.

## Branch

`claude/shader-test-doc` (off main).
