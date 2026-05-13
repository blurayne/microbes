// Shared test fixtures for the visual specs.
//
// Both the rendertest artifact spec and the game-vs-shader-test
// pair-diff spec iterate the same 21-cell × 4-theme matrix. Keep
// this list in sync with `assets/core/state.js` CELL_TYPES + the
// eukaryote extended entry; add a row when a new specimen lands.

export const CELLS = [
  { key: 'neutrophil', cat: 'good' },
  { key: 'monocyte',   cat: 'good' },
  { key: 'mast',       cat: 'good' },
  { key: 'nk',         cat: 'good' },
  { key: 'macrophage', cat: 'good' },
  { key: 'dendritic',  cat: 'good' },
  { key: 'basophil',   cat: 'good' },
  { key: 'platelet',   cat: 'good' },
  { key: 'tcell',      cat: 'good' },
  { key: 'bcell',      cat: 'good' },
  { key: 'eosinophil', cat: 'good' },
  { key: 'rbc',        cat: 'good' },
  { key: 'virus',      cat: 'bad' },
  { key: 'germ',       cat: 'bad' },
  { key: 'bacterium',  cat: 'bad' },
  { key: 'amoebaP',    cat: 'bad' },
  { key: 'slime',      cat: 'bad' },
  { key: 'mite',       cat: 'bad' },
  { key: 'spore',      cat: 'bad' },
  { key: 'toxin',      cat: 'bad' },
  { key: 'eukaryote',  cat: 'extended' },
];

// shader-test has NO legacy theme — that's the in-game canvas2d-look
// fallback. So this list covers the 4 themes both pages can produce:
// microscope, cartoon, kurzgesagt, classic.
export const THEMES = ['microscope', 'cartoon', 'kurzgesagt', 'classic'];

// Numeric kind IDs used by shader-test's CELL_NAME_TO_INT (mirrored
// by `testKindFor()` in assets/core/cell-kinds.js). Exposed so the
// rendertest spec can build deterministic filenames without booting
// the game's module graph.
export const CELL_KIND = {
  eukaryote:  0, macrophage:  1, neutrophil:  2, nk:          3, bcell:      4,
  virus:      5, bacterium:   6, amoebaP:     7, spore:       8, monocyte:   9,
  mast:      10, dendritic:  11, basophil:   12, platelet:   13, tcell:     14,
  eosinophil: 15, rbc:       16, germ:       17, slime:      18, mite:      19,
  toxin:     20,
};
