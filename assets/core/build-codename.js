// Deterministic codename generator for the build stamp. Each
// successful deploy run gets a stable two-word handle so "build
// #97 · ruby-flagellum" is visually distinct from "#98 · jade-
// codon", and a refresh check can confirm the new build loaded.
//
// Pure function of the run number — same N always produces the
// same codename, no clock / RNG dependency. ~32 × 32 = 1024
// unique combos before repeats; at one PR per day that's three
// years.

const ADJ = [
  'amber', 'azure', 'cobalt', 'coral', 'cyan', 'ember', 'ferric',
  'glacial', 'gold', 'indigo', 'ivory', 'jade', 'lapis', 'lilac',
  'magenta', 'mauve', 'neon', 'ochre', 'pearl', 'plum', 'prism',
  'ruby', 'saffron', 'scarlet', 'slate', 'teal', 'violet',
  'vermilion', 'viridian', 'wine', 'mint', 'cerise',
];

const NOUN = [
  'amoeba', 'axon', 'bacterium', 'basophil', 'blastula', 'capsid',
  'cilium', 'codon', 'conidia', 'cytokine', 'dendron', 'embryo',
  'enzyme', 'flagellum', 'genome', 'granuloma', 'helix', 'histone',
  'isotope', 'junction', 'keratin', 'lipid', 'lysis', 'mitosis',
  'nucleus', 'organelle', 'peptide', 'plasmid', 'prion', 'ribosome',
  'spore', 'stem',
];

export function buildCodename(run) {
  const n = Math.max(0, Number(run) | 0);
  // Multiply each axis by a co-prime to spread adjacent runs into
  // visually different codenames (otherwise build N + 1 would only
  // tick the adjective one slot over, looking like a typo).
  const a = ADJ[(n * 7) % ADJ.length];
  const noun = NOUN[((n * 13) >> 0) % NOUN.length];
  return `${a}-${noun}`;
}
