// Per-pair targeting + damage rules for the cell-vs-cell interaction
// matrix. Rules are looked up by `(attacker.type, target.type)` and
// describe how an attacker behaves toward a target:
//
//   attractRadius — start tracking the target (steer toward it)
//   attackRadius  — once inside this distance, apply damagePerSec
//   damagePerSec  — HP per second drained from the target while
//                   inside attackRadius
//
// The sim's update loop (sim.js) consults `getRule(attackerType,
// targetType)` once per (attacker, candidate) pair while picking
// an alarm target, and again per frame while applying damage.
//
// **Default fallback** (if no explicit rule exists): hostile
// pairs (good→bad / bad→good per CELL_TYPES.category) get a
// generic rule of (attract: 200, attack: 50, dps: 4). Same-side
// pairs and 'idle' attackers get null (no engagement).
//
// Source: docs/ch04-konzept.md §4.3 + §10 damage matrix. The
// concrete values below are the plan's seed numbers; tune as we
// add Free Game playtesting.

import { CELL_TYPES } from './state.js';

// Generic group keys so rules can target a class of pathogens
// without listing each member type.
const PATHOGEN_TYPES = ['virus', 'germ', 'bacterium', 'amoebaP', 'mite', 'slime', 'spore', 'toxin'];
const BACTERIAL_TYPES = ['germ', 'bacterium'];
const FUNGAL_TYPES = ['slime', 'spore'];
const PARASITIC_TYPES = ['amoebaP', 'mite'];
const VIRAL_AND_PARASITIC_TYPES = ['virus', 'amoebaP'];

// Build the explicit attacker → target matrix. Keys are the attacker
// type. Values are arrays of (targetTypes, rule) pairs; first match
// wins inside `getRule`.
//
// Helper: a rule object has shape { attract, attack, dps }.
const r = (attract, attack, dps) => ({ attract, attack, dps });

const RULES = {
  // ---- Hero / good cells ----
  macrophage:  [{ types: PATHOGEN_TYPES,             rule: r(200, 60, 5) }],
  neutrophil:  [{ types: BACTERIAL_TYPES,            rule: r(220, 50, 6) },
                { types: FUNGAL_TYPES,               rule: r(200, 50, 4) }],
  monocyte:    [{ types: PATHOGEN_TYPES,             rule: r(200, 55, 4) }],
  nk:          [{ types: VIRAL_AND_PARASITIC_TYPES,  rule: r(220, 40, 10) }],
  basophil:    [{ types: PARASITIC_TYPES,            rule: r(240, 45, 9) },
                { types: ['mite'],                   rule: r(260, 50, 11) }],
  dendritic:   [{ types: PATHOGEN_TYPES,             rule: r(180, 50, 2) }],
  mast:        [{ types: PARASITIC_TYPES,            rule: r(220, 50, 6) }],
  tcell:       [{ types: ['virus'],                  rule: r(240, 45, 12) },
                { types: VIRAL_AND_PARASITIC_TYPES,  rule: r(220, 45, 8) }],
  // B-cells don't engage in melee — they shoot antibodies (Plan #3c).
  // Listed here with a long-range attract so they orient toward the
  // threat; attack/dps are zero so the matrix-driven damage loop
  // skips them. The antibody system reads `attractRadius` directly.
  bcell:       [{ types: PATHOGEN_TYPES,             rule: r(280,  0, 0) }],
  // Eosinophil isn't in CELL_TYPES today; if it lands later this
  // entry pre-wires it.
  eosinophil:  [{ types: PARASITIC_TYPES,            rule: r(240, 40, 12) }],

  // ---- Pathogens (mostly attack RBCs / hosts; today RBC isn't a
  //      cell type, so the rules below are a forward-looking shim
  //      that will activate once host cells exist). ----
  virus:       [{ types: ['rbc'],                    rule: r(80, 40, 0) }],
  amoebaP:     [{ types: ['rbc'],                    rule: r(120, 50, 6) }],
  mite:        [{ types: ['rbc'],                    rule: r(140, 50, 4) }],
  germ:        [],
  bacterium:   [],
  slime:       [],
  spore:       [],
  toxin:       [],
};

// Generic fallback for hostile pairs not explicitly listed above.
// Anyone whose CELL_TYPES.category mismatches the target's gets
// this gentle nudge to keep the live-sim feel close to the
// pre-rules behaviour.
const HOSTILE_FALLBACK = r(200, 50, 4);

/**
 * Resolve the rule for one (attackerType, targetType) pair.
 * Returns null when the attacker has nothing to do with the target
 * (same side, idle hostility, or no rule + no fallback applies).
 *
 * @param {string} attackerType
 * @param {string} targetType
 * @returns {{ attract: number, attack: number, dps: number } | null}
 */
export function getRule(attackerType, targetType) {
  if (!attackerType || !targetType) return null;
  if (attackerType === targetType) return null;
  const aDef = CELL_TYPES[attackerType];
  const tDef = CELL_TYPES[targetType];
  if (!aDef || !tDef) return null;
  // Same-side pairs never engage (good vs good, bad vs bad).
  if (aDef.category === tDef.category) return null;
  // Idle/flee hostility means the attacker doesn't initiate.
  const hostility = aDef.move && aDef.move.hostility;
  if (hostility === 'idle' || hostility === 'flee') return null;

  const entries = RULES[attackerType];
  if (entries) {
    for (const entry of entries) {
      if (entry.types.includes(targetType)) return entry.rule;
    }
  }
  return HOSTILE_FALLBACK;
}

/**
 * Return the longest attract radius the attacker has across any
 * potential target. Used by the sim's spatial-grid query so a single
 * radius covers every rule the attacker might fire on this frame.
 * Returns 0 when the attacker engages nothing.
 *
 * @param {string} attackerType
 * @returns {number}
 */
export function maxAttractRadius(attackerType) {
  const entries = RULES[attackerType];
  let best = 0;
  if (entries) {
    for (const entry of entries) {
      if (entry.rule.attract > best) best = entry.rule.attract;
    }
  }
  // Fallback ALARM_RADIUS-like value for hostile pairs without an
  // explicit rule. Keep in sync with HOSTILE_FALLBACK.attract.
  return Math.max(best, HOSTILE_FALLBACK.attract);
}

/**
 * Default HP for a cell type. Heroes (category 'good') start with
 * Infinity in Free Game so they can't be killed by the matrix-driven
 * damage loop — Plan #3d locks this as the invulnerable-player rule.
 * Pathogens get a finite HP that scales loosely with their size.
 *
 * @param {string} type
 * @returns {number}
 */
export function defaultHp(type) {
  const def = CELL_TYPES[type];
  if (!def) return 100;
  if (def.category === 'good') return Infinity;
  // Bigger pathogens take longer to kill. sizeMul defaults to 1.
  const size = def.sizeMul || 1;
  return Math.round(60 * size + 40);
}

/**
 * The hero type with the highest dps against this pathogen. Used by
 * the composition HUD to recommend "what to add" when a pathogen is
 * on-field. Returns null if no hero has a positive dps.
 *
 * @param {string} pathogenType
 * @returns {string | null}
 */
export function getBestCounter(pathogenType) {
  let best = null, bestDps = 0;
  for (const heroType of Object.keys(RULES)) {
    const def = CELL_TYPES[heroType];
    if (!def || def.category !== 'good') continue;
    const rule = getRule(heroType, pathogenType);
    if (!rule || rule.dps <= 0) continue;
    if (rule.dps > bestDps) { best = heroType; bestDps = rule.dps; }
  }
  return best;
}
