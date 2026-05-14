# Plan 21 — Externalize non-`en` locales to `assets/i18n/*.json`

## Context

Plan 20 (#265) shipped six new locales. The total inline dictionary
in `assets/core/state.js · LOCALES` has grown to ~1600 lines across
13 language blocks. None of the non-default locales are needed at
load time — only when the user picks one in the language picker —
yet every visit downloads + parses all of them.

The user's earlier decision (recorded in plan 20's "Follow-up"):
keep `en` as the inline, synchronous fallback; move every other
locale into `assets/i18n/<code>.json`, fetched on demand.

## Audit

State.js single source of truth today:

- `LOCALES` (line 664) — 13 entries (en + 12 others). Total ~1600
  lines after plan 20.
- `T(key, vars)` (line 2209) — pure-sync lookup: `LOCALES[S.lang]`
  → `LOCALES.en` → `key`. Hot path; called from `applyI18n` per
  matching DOM node and from `cellLabel` / `cellDesc`.
- `applyI18n()` (line 2222) — re-applies every `[data-i18n]` after
  language changes.

Other touch points:

- `assets/app.js` — language picker (~L2222 in plan 20 audit) wires
  the `<select>` change handler to `S.lang = newLang; applyI18n()`.
  Needs to await a fetch before re-applying.
- `test/state.test.js` — `every locale defines at least the core
  UI keys` iterates `Object.keys(LOCALES)`. After this PR the
  inline LOCALES only contains `en`; the test must instead read
  each `assets/i18n/<code>.json` from disk.
- `loadSettings` (in state.js) — reads `S.lang` from localStorage
  on init. If it's a non-`en` code, we must fetch that locale
  before the first `applyI18n` runs, or the first paint shows
  English. Acceptable for a one-frame flash; we will trigger the
  fetch eagerly when `loadSettings` finishes if `S.lang !== 'en'`.

No build step; vanilla ES modules + raw `fetch`. JSON files served
straight from `/assets/i18n/`.

## Approach

1. **Extract** every non-`en` block in `LOCALES` to
   `assets/i18n/<code>.json`. The leading `//` comment in each
   block (canon vs. coinage notes from plan 20) moves into a
   `"//"` sibling key inside the JSON — JSON has no comments,
   but a top-level `"//"` is the standard convention and the
   loader strips it.
2. **Shrink `state.js · LOCALES`** to a single `en: { ... }`
   block. Other code keeps referring to `LOCALES` as a mutable
   dictionary; the loader populates it.
3. **Add `ensureLocale(code)`** — async fetch+install. Idempotent:
   if `LOCALES[code]` already exists, resolves immediately. On
   fetch failure, logs and resolves to no-op (T() then falls
   through to `en`).
4. **Eager preload on init** — at the end of `loadSettings`, if
   `S.lang && S.lang !== 'en'`, fire `ensureLocale(S.lang)` and
   call `applyI18n()` in its `.then`. The first paint may briefly
   show `en` strings; that's a one-frame flash and matches the
   user's stated tolerance ("loaded on demand" implies async).
5. **Wire the language picker** — when the user picks a new lang,
   `await ensureLocale(code)` before assigning `S.lang` and
   re-applying. (Or set lang immediately and re-apply in `.then` —
   either works; pick the simpler one.)

## Critical files

- `assets/core/state.js` — shrink `LOCALES` to `en` only; add
  `ensureLocale()`; call it from `loadSettings` after the lang
  field is restored.
- `assets/i18n/en.json` — **not created**; `en` stays inline so
  `T()` is synchronously usable from the moment the module loads.
- `assets/i18n/<code>.json` × 12 — one file per non-`en` locale:
  `de, es, bar, hes, mainz, latin, qya, sjn, mor, tlh, pie, gmh`.
  Each contains the contents of the corresponding `LOCALES[code]`
  block plus a `"//"` provenance note.
- `assets/app.js` — language picker handler: await
  `ensureLocale(newLang)` (or chain via `.then`), then assign +
  applyI18n.
- `test/state.test.js` — replace the `Object.keys(LOCALES)` loop
  with a file-system scan of `assets/i18n/*.json` (Node test runs
  with `node --test`, so `fs.readdirSync` + `JSON.parse` are
  available). Verify each JSON parses and contains the required
  keys (`settings_title`, `theme`, `reset_sim`, `adding`,
  `help_group_good`).

## Verification

- `node --test` — updated locale-keys test passes for all 12 JSON
  files plus the inline `en`.
- Renderer imports — `node -e "import('./assets/render/{canvas2d,
  webgl2,webgpu}.js')"` still load (no module-time fetch surprises;
  fetch only fires when a user picks a non-`en` language).
- Manual smoke: open the site with `?lang=tlh` or pick "tlhIngan
  Hol" from the picker — the JSON downloads, the UI updates.
- Network panel sanity: a default visit (lang=en) makes zero
  `/assets/i18n/*.json` requests.

## Branch

`claude/externalize-locales`

## Notes

- Future PRs may externalize the per-renderer prompt strings the
  same way. Not in this PR's scope.
- Plan 20's "Follow-up" entry is what this plan answers; mark
  plan 20 done in PLAN.md alongside this plan's creation.
