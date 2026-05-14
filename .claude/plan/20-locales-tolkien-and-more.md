# Plan 20 — Locales: Tolkien · Star Trek · historical

## Context

The language picker shipped with en/de/es/bar/hes/mainz/latin. The
user asked for six more — three Tolkien conlangs, one Star Trek
conlang, and two historical / reconstructed languages of European
descent — to extend the "language as theme" feel of the settings
panel beyond standard locales.

## Audit

Existing locale infrastructure is fine to extend:

- `assets/core/state.js · LOCALES` — flat dictionary, one entry
  per language code. Every locale falls through to `en` for any
  missing key (see `T()` in `assets/core/state.js`).
- `assets/app.js · ~L2222` — language picker is a hard-coded
  array of `[code, label]` tuples. Adding a code there + a block
  in `LOCALES` is the entire wiring.
- `test/state.test.js · "every locale defines required keys"` —
  asserts every locale has `settings_title`, `theme`, `reset_sim`,
  `adding`, `help_group_good`. New locales must include these.

## Approach

Add six new locale codes:

| code | name | source | depth |
| --- | --- | --- | --- |
| `qya` | Quenya | Tolkien High-Elven | moderate (~70 keys) |
| `sjn` | Sindarin | Tolkien Grey-Elven | moderate (~70 keys) |
| `mor` | Black Speech | Tolkien Mordor | sparse — canon is ~30 words |
| `tlh` | tlhIngan Hol | Klingon (Okrand) | full (~80 keys) |
| `pie` | Proto-Indo-European | reconstructed | moderate, asterisked roots |
| `gmh` | Mittelhochdeutsch | c. 1050–1350 attested | full (~85 keys) |

Each block opens with a leading comment that says exactly which
keys come from canonical sources vs. transparent coinages built
from attested stems. Any key not present silently falls through
to `en` — so we'd rather omit a key than fake it.

Picker labels in `assets/app.js` follow the existing pattern:
endonym first when possible, descriptive tag in parentheses.

## Critical files

- `assets/core/state.js` — six new entries appended to `LOCALES`
  after `latin`; leading comments describe the canon-vs-coinage
  split per language.
- `assets/app.js` (~L2222) — six new `[code, label]` rows added
  to the language picker.

## Verification

- `node --test` — the required-keys test must pass for all six.
- Renderer imports (`canvas2d`, `webgl2`, `webgpu`) — must still
  load (no module-time surprises from the new dictionary entries).
- Manual: cycle the language picker in the running app and
  confirm each new code applies; untranslated UI bits fall
  through cleanly to English.

## Branch

`claude/locales-tolkien-and-more`

## Follow-up (separate PR)

Plan 21 will externalize all non-`en` locale dictionaries to
`assets/i18n/*.json`, fetched on demand when the user picks a
non-default language. State.js stays as the en source + the
loader. See the user's "Proceed but split per PR" decision.
