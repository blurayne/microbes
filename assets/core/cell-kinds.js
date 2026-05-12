// Game cell type → docs/shader-test.html "kind" id (0..20).
//
// The shader-test sandbox renders 21 distinct specimens; the game's
// disk shader can route per-cell-type to the matching test specimen
// when S.theme != 'legacy'. Phase 2 of the in-game theme port (see
// PLAN entry #14) consumes this map: webgl2.js + webgpu.js pack the
// id into the existing kindAsFloat per-instance attribute, the
// fragment shader reads it back via testKind() and dispatches to
// per-type SDFs.
//
// 'eukaryote' (test id 0) is the generic-cell fallback. Game cells
// that don't map cleanly (none today, but defensively) fall through
// to 0.
export const TEST_KIND = {
  // immune
  macrophage: 1,  neutrophil: 2,  nk: 3,         bcell: 4,
  monocyte: 9,    mast: 10,       dendritic: 11, basophil: 12,
  platelet: 13,   tcell: 14,      eosinophil: 15, rbc: 16,
  // pathogens
  virus: 5,       bacterium: 6,   amoebaP: 7,    spore: 8,
  germ: 17,       slime: 18,      mite: 19,      toxin: 20,
  // extended (S.extendedCells gates Add-dialog visibility)
  eukaryote: 0,
};

export function testKindFor(cellType) {
  return TEST_KIND[cellType] || 0;
}
