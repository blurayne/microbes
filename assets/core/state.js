// Microbes — shared state, registries, constants, i18n.
//
// Pure data + helpers. Touches `localStorage` and `navigator` only behind
// `typeof` guards so this module is safely importable from Node for tests.
// `applyI18n` is the only DOM touch; it no-ops when `document` is missing.

export const SETTINGS_KEY = 'microbes.settings.v2';
export const SETTINGS_KEY_V1 = 'microbes.settings.v1';

export const ALL_CELL_KEYS = [
  'neutrophil', 'monocyte', 'mast', 'nk', 'macrophage', 'dendritic',
  'basophil', 'platelet', 'tcell', 'bcell', 'eosinophil', 'rbc',
  'virus', 'germ', 'bacterium', 'amoebaP', 'slime', 'mite', 'spore', 'toxin',
];

// User-curated defaults baked in 2026-05-14 from the shipping
// session config (see commit message for the source JSON the user
// pasted). Captures the look + feel the user has settled on:
// bloodflow bg, glass + microscope + duotone post-pin chain on by
// default, FPS / build-info / cell-total pills on, cartoon faces,
// extended cells visible, anchored nav arrows. Migration shim in
// loadSettings still merges DEFAULTS with whatever's in
// localStorage — users with persisted prefs keep them; only fresh
// installs and re-imports of a "blank" blob land on these values.
export const DEFAULTS = {
  splitMode: 'pushApart',
  autoSplitSeconds: 28,
  maxCells: 1024,           // population cap. UI number input in Settings → Population; clamps to [32, 4096], invalid input resets to maxCells default. Reached cap = spawnAtWorld/beginSplit recycle the oldest cell (#136); see TODO.md for future ideas.
  bgFlowSpeed: 0.45,
  bgScale: 1.75,            // multiplies the world-space size of every background pattern feature (RBC tiles, fbm noise, voronoi cells, rings, grid). Camera zoom is untouched, so cells stay the same size while the bg pattern grows or shrinks. Slider in Settings → Look, range 0.05..20× (the floor matches the shader's `max(u_bgScale, 0.05)` clamp; the 20× ceiling gives enough headroom to shrink features below the obvious-default size).
  // Per-source resolution multiplier for tissue (image-tiled) bgs
  // in Canvas2D. The browser's hardware-accelerated path keeps the
  // decoded image as a GPU-backed CanvasPattern; downsampling to
  // scale * (width × height) before createPattern gives the GPU
  // less work per frame at the cost of softer tile edges. 1.0
  // keeps the original look; 0.5 / 0.25 progressively faster.
  // WebGL2 / WebGPU paths sample mipmapped textures directly and
  // ignore this slider — the visible label says "(Canvas2D)" so
  // the user knows it's renderer-specific.
  tissueScale: 1.0,
  // Visible tile width in world units for the tissue bg pattern
  // (the existing constant from canvas2d.js, surfaced here so
  // tissueScale's docs make sense). Not user-tunable; just
  // referenced in the doc.
  outlinePx: 7,
  lineThickness: 0.9,        // global multiplier on antibody stroke width (canvas2d) + every cell outline / decoration / nucleus / face line in canvas2d + cell-border shader uniform (webgl2 / webgpu) + GPU decoration thickness (spikes / tendrils / flagella / cilia / drips / legs / fuzz / Y-receptors emit screen-space-thick quads via _pushLine). 1.0 keeps the previous look. Clamped 0.3..10.0 in loadSettings. GPU antibody Y's stay at 1 device-px because the antibody pipeline still uses line-list topology — that's a separate pipeline from decorations.
  faceScale: 0.6,           // multiplier on cartoon face size — scales eye radius, pupil radius, eye horizontal spread, and mouth width uniformly across all renderers. Clamped 0.2..2.2 in loadSettings.
  showDebugField: false,
  // Visual style for the cell rendering itself. Was the lone "theme"
  // setting until late 2026; renamed when the colour palette below was
  // introduced as a separate "Interface color" setting.
  theme: 'legacy',
  // Colour palette tinting outlines + UI panel accent (was DEFAULTS.theme).
  // Renamed to interfaceColor to free up "theme" for the cell-shader theme.
  interfaceColor: 'amber',
  activeTypes: ALL_CELL_KEYS.slice(),
  splitOnTap: false,
  addDialogView: 'grid',    // 'grid' | 'list' — initial view when the add/cell-info dialog opens. Toggle button in the header swaps modes; ? FAB forces 'list', + FAB respects this setting.
  randomSplit: false,
  metaSplit: true,          // metaball merge between the two halves while SPLITTING
  metaRtMode: 'bbox',       // 'bbox' | 'fullCanvas' | 'sharedMax' — RT sizing strategy for the per-pair metaball pass. Honoured by webgl2 / webgpu alike.
  metaOutlineMode: 'edge',  // 'edge' | 'sdf' | 'polygon' — outline style for the merged blob during SPLITTING. 'edge' (default) traces the blurred-mask 0.5 contour, so the rim follows the actual rendered blob shape exactly. 'sdf' strokes each half polygon (2 overlapping rims). 'polygon' is a sharp polygon-union rim, no blur.
  // Game mode. The live simulator IS Free Game today — campaign +
  // survival are designed (docs/ch04-konzept.md §4.3) as RESTRICTIONS
  // overlaid on the same physics, not separate code paths. So this
  // field declares the schema; only 'free' is wired today.
  gameMode: 'free',
  // Composition HUD: top-right widget listing heroes still needed to
  // counter the on-field pathogens. ON by default in Free Game so
  // the player learns the matrix; toggle hides it for purists.
  compositionHud: true,
  cellTypeOverlay: false,   // eye-toggle: per-cell ring + text label identifying the cell type. HTML overlay above the canvas; renderer-agnostic.
  causticsOverlay: false,   // water-turbulence post-process applied on top of the rendered background. WebGL2 + WebGPU only; Canvas2D is a no-op.
  liquidRipples: false,     // bg post-process: each on-screen cell radiates concentric ripples that distort the background — reads as cells moving through liquid. WebGL2 + WebGPU only; Canvas2D is a no-op.
  glassMembrane: true,      // overlay post-process: lensing refraction in a thin band just outside each cell, making the membrane read as glass that bends the scene behind it. WebGL2 + WebGPU only; Canvas2D is a no-op.
  glassStrength: 3.0,       // multiplier on the glass-membrane refraction strength. Slider in Settings → Overlays, range 0.1..3.0.
  glassSize: 0.4,           // multiplier on the lens-band half-width. Shader uses half = 0.15 * glassSize, so size=0.5 → band 0.925..1.075·r (the new max), size=0.4 (default) → 0.94..1.06·r — a tight rim that reads as glass without smearing into the cell. Range 0..0.5.
  glassInset: 0.03,         // fraction of the silhouette radius the lens band sits inward from the cell edge — 0 = flush with the silhouette, 0.05 = 5 % inward (the new max). Keeps the band visibly "inside" the rim without smearing toward the centre. Range 0..0.05.
  glassChroma: true,        // optional chromatic-split toggle on top of the always-on lensing — when true, the three RGB channels sample the scene at slightly different displacements so the rim shows a prism-edge colour fringe.
  // Bump-feedback: when two cells collide, both flash and squash
  // briefly along the impact normal. Visual only — the elastic
  // bounce physics runs regardless. Squash is rendered by webgl2 +
  // webgpu cell shaders; canvas2d shows the flash only.
  bumpFeedback: true,
  bumpFeedbackIntensity: 0.4,
  // Bump envelope shape (seconds). bumpAttack is the smoothstep
  // ramp-up — higher = squash eases in slower. bumpDuration is
  // the total visible time (attack + linear fade). User-curated
  // defaults: quick snap into the squash (30 ms attack) + long
  // slow fade (4 s) reads more "organic membrane" than the
  // original 150 ms exponential.
  bumpAttack: 0.03,
  bumpDuration: 4.0,
  // Cardiovascular vessel network. When enabled the rectangular
  // playfield is replaced by a union-of-capsules vessel mask: cells
  // are confined inside the bloodstream and a soft RBC particle
  // field flows along the centerlines. See assets/core/vessels.js
  // for layout factories + SDF helpers. All four parameters are
  // hot-mutable; the sim rebuilds vessel geometry whenever any of
  // them changes (or on viewport resize).
  vesselsEnabled: true,                   // master toggle — false reverts to the rect-bound playfield
  vesselsLayout: 'branching',             // one of: 'branching' | 'tube' | 'heart'
  vesselsRadius: 1.0,                     // multiplier on baked-in capsule radii. Range 0.5..2.0.
  vesselsFlowSpeed: 1.0,                  // RBC particle advance × base 80 world units / sec. Range 0..3.
  vesselsRbcDensity: 1.0,                 // multiplier on per-capsule RBC count. Range 0..2.
  // Caustics tint — modulates the green/teal cast added on top of
  // the rendered scene. User-curated warm-cast defaults; lower
  // values toward 0 fade toward neutral white.
  causticTintR: 1.6,
  causticTintG: 2.0,
  causticTintB: 2.0,
  // Fullscreen overlay effects (all post-bg, post-cells). Ported from
  // docs/shader-test.html's microscope chrome — toggleable + tunable.
  staticNoise: true,             // film-grain per-pixel hash noise
  staticNoiseIntensity: 0.34,
  staticNoiseBlend: 'additive',  // 'normal' | 'multiply' | 'additive'
  vignette: true,                // viewport-radial blue tint at corners (microscope)
  vignetteIntensity: 0.66,
  vignetteBlend: 'normal',
  crosshair: true,               // small cyan + at viewport centre
  // Unified overlay draw order. Every overlay (FX blends + FBO
  // passes + the HTML cell-type overlay) is a single entry in
  // this array. The 'scene' entry is a fixed pin marking where
  // the cell pass runs: overlays *above* the pin run after cells
  // (full-scene post-process); overlays *below* the pin run
  // before cells (bg-only post-process). The pin can't be
  // dragged or removed; the migration shim in loadSettings
  // collapses the old fxOrder + rippleScope into this array.
  // Renderers read overlayFxOrder() / overlayKindRunsAfterScene()
  // helpers — they don't touch the array directly.
  overlayOrder: [
    // User-curated overlay stack: glass + ripples + microscope
    // blur + duotone in the chain above the scene pin; caustics
    // and the cell-type HTML overlay below the pin (bg-only
    // scope). Crosshair / vignette / noise are FX blends that
    // composite after the chain. Order is top-of-list runs LAST
    // (= visually on top).
    'crosshair',   // viewport centre crosshair (S.crosshair)
    'vignette',    // microscope corner-tint (S.vignette)
    'duotone',     // duotone color grade (S.makeItReal)
    'noise',       // film-grain (S.staticNoise)
    'microscope',  // variable-radius blur (S.microscopeBlur)
    'ripples',     // liquid ripples (S.liquidRipples)
    'glass',       // glass-membrane lensing (S.glassMembrane)
    'scene',       // ← fixed scene pin (cells render here)
                   //   drag an overlay below this line to make it run BEFORE cells (bg-only)
    'caustics',    // water-turbulence tint (S.causticsOverlay) — bg-only scope
    'celltype',    // HTML cell-type label overlay (S.cellTypeOverlay) — bg-only scope
  ],
  // Microscope distortion: scene-wide variable-radius blur. Sharp
  // center (focus zone) with progressively blurrier edges. Knobs:
  // focus = sharp-zone radius as fraction of min(W,H)/2; strength =
  // peak edge blur as fraction of min(W,H); falloff = transition
  // hardness (0 soft, 1 abrupt). WebGL2 + WebGPU only.
  microscopeBlur: true,
  microscopeFocus: 0.43,
  microscopeBlurStrength: 0.05,
  microscopeFalloff: 0.03,
  // "Make it real" microscope-photo color grade: maps scene luminance
  // along a duotone gradient between hue1 (shadows) and hue2 (highlights),
  // with a saturation knob. Hues are 0..1 around the wheel (0 red, 0.33
  // green, 0.5 cyan, 0.67 blue). Defaults dial in the green→cyan look
  // of the reference microbe-microscopy reference. WebGL2 + WebGPU only.
  makeItReal: true,
  makeItRealHue1: 0.38,
  makeItRealHue2: 0.64,
  makeItRealSaturation: 0.32,
  // Liquid-ripples knobs. All three are visible in the settings panel
  // only while S.liquidRipples is on. They feed straight into the
  // ripple shader's per-cell uniforms (see _rippleCollectCells + UBO).
  rippleDensity: 2.7,       // how many ripple rings each cell radiates. Higher → tighter wavelength, more visible rings close to the body. Multiplier on the baseline 1 / 0.7.
  rippleReach: 0.3,         // how far the ripples extend outward. Lower → ripples stay close to the cell. Multiplier on the falloff distance.
  rippleStrength: 0.4,      // peak UV displacement amplitude. Multiplier on the baseline ~6 px.
  pinchRotation: false,     // two-finger twist rotates the camera. Off by default — most users find it surprising. When off, sim.camera.rotation stays at 0 and the gesture only pinch-zooms + pans.
  showFPS: true,
  showCellTotal: true,      // append live cell count to the FPS line (renamed from showObjectCount in PR-after-#233 — now counts cells only, no particles)
  settingsAccordion: true,  // when opening a `<details class="settings-section">` in the Settings dialog, automatically collapse the others. Acts like a single-pane accordion. Toggleable via the matching checkbox; on by default per user spec.
  navMode: 'anchored',      // off-screen-cell arrow layout. 'none' = hidden; 'fixed' = 4 fixed-edge aggregate arrows (the original look); 'anchored' = per-cell arrows sliding along the screen edge, 1D-greedy clustered when crowded; 'circular' = arrows on a ring just outside the microscope focus circle, pointing outward toward each off-screen cell. The standalone `navArrows` bool was retired in favour of `'none'` here (migration shim in loadSettings).
  extendedCells: true,      // opt-in cells flagged `extended: true` in CELL_TYPES (e.g. eukaryote). User-curated default: visible in Add dialog + help list.
  showRenderer: true,       // append actual renderer info to the FPS line
  showBuildInfo: true,      // top-left build stamp (branch · sha · #run · time)
  friction: 0.65,
  bounce: 0.23,
  throwStrength: 2.25,
  wobbleAmp: 0.08,
  speedMul: 1.0,
  cartoon: true,
  lang: 'en',                               // 'en' | 'de' | 'es' | 'bar' | 'latin'
  allowBadGuys: true,
  cellSizeMul: 1.7,
  membraneIntensity: 0.7,
  cellBorderThickness: 3.5,    // multiplier on the disk-shader outline band; webgl2 / webgpu only
  background: 'bloodflow',
  // Background layer stack. Empty array → renderers fall back to
  // a single layer derived from S.background (the legacy single-bg
  // path). PR B will surface a UI that populates this array. See
  // .claude/plan/10-bg-layer-stack.md.
  // User-curated default: single bloodflow layer with the
  // vermilion palette so a fresh install matches the look the
  // user has settled on.
  bgLayers: [{
    id: 'l_bloodflow_vermilion_default',
    opacity: 1,
    blend: 'normal',
    enabled: true,
    label: 'Bloodflow (vermilion)',
    kind: 'bloodflow',
    topColor: '#6b0f14',
    botColor: '#2e080d',
    vignette: 0,
  }],
  renderScale: 1.0,
  upscaleMode: 'pixel',
  scanlinesAlpha: 0,        // 0..1 strength of the CRT scanlines overlay; 0 = off (replaces the old scanlines: bool toggle)
  useHighlight: true,                       // selection ring uses theme accent when on
  // Audio. Explicit `musicEnabled` toggle drives playback — default OFF
  // so the page loads silent and the user opts in via Settings → Audio.
  // Volume stays independent so flipping the toggle back on remembers
  // whatever level the user set. SFX volume unaffected by either knob.
  // Volumes are 0..1 floats.
  musicEnabled: false,
  musicVolume: 0.4,
  sfxVolume: 0.75,
  renderer: 'webgl2',       // 'canvas2d' | 'webgl2' | 'webgpu' — user-curated default: WebGL2 (WebGPU regressed on some devices; users can flip back via Settings → Performance).
  // Virus shader 3D mode (off by default; toggle ships separately).
  virusShader3D: false,
};

// Interface-colour accents — a SEPARATE small table from the
// scene-render THEMES (which drive the background). The user
// flagged the dropdown duplication in #114 ("why do we have the
// same names from background and interface color?"); splitting
// the two truly-distinct concepts.
const KNOWN_INTERFACE_COLOR_KEYS = [
  'pink', 'red', 'amber', 'yellow', 'green',
  'cyan', 'blue', 'violet', 'mono',
];

// Cell-shader themes — the new S.theme setting. 'legacy' renders
// today's geometry unchanged; the other four port the corresponding
// docs/shader-test.html compose-pass styles into the disk shader.
export const KNOWN_THEME_KEYS = [
  'legacy', 'microscope', 'cartoon', 'kurzgesagt', 'classic',
];

// Background scene-render keys — entries in the THEMES table that
// drive the bg shader. Used by both S.background validation and by
// the legacy interface-colour migration (any saved interfaceColor
// that's a bg key gets re-pointed to a sensible accent below).
export const KNOWN_BACKGROUND_KEYS = [
  'bloodstream', 'bloodflow', 'cellShadow',
  'cartoonNight', 'spectrum', 'lymphNode',
  'lung', 'aurora', 'underwater',
  'lavaFire', 'reactor',
  'mitochondria', 'neuron', 'bile',
  'tissue',
];

// Map old THEMES keys → new accent keys for the interfaceColor
// migration (when a saved settings blob still references the
// old conflated table).
const LEGACY_INTERFACE_COLOR_MIGRATION = {
  bloodstream: 'red',  bloodflow: 'red',     cellShadow: 'red',
  cartoonNight: 'cyan', spectrum: 'violet',  lymphNode: 'violet',
  lung: 'pink',         lavaFire: 'amber',   reactor: 'green',
  aurora: 'green',      underwater: 'cyan',
  mitochondria: 'amber',
  neuron: 'cyan',       bile: 'green',
  tissue: 'red',
  // Removed scenes — fold to a sensible accent.
  dracula: 'violet',
};

const VALID_RENDER_SCALES = [1, 0.5, 0.25, 0.125];

// Currently only 'free' is wired. 'campaign' and 'survival' are
// reserved for future modes (see docs/ch04-konzept.md §4.3); the
// settings dropdown shows them as disabled "(soon)" entries.
const KNOWN_GAME_MODES = ['free'];

// Overlay-stack kinds. Order in this list is incidental; the
// authoritative draw order is the per-user S.overlayOrder array.
// 'scene' is the fixed cell-pass pin — exactly one entry per array.
const OVERLAY_FX_KINDS    = ['noise', 'vignette', 'crosshair'];
const OVERLAY_SCENE_PIN   = 'scene';
const KNOWN_OVERLAY_KINDS = [
  'duotone', 'noise', 'vignette', 'crosshair',
  'microscope', 'caustics', 'celltype',
  'ripples', 'glass',
  OVERLAY_SCENE_PIN,
];

// Validate / normalise an overlayOrder array in-place style: takes
// the raw user value (or undefined) plus optional legacy fxOrder +
// rippleScope and returns a clean array containing every known
// overlay kind exactly once, with the scene pin present exactly
// once. Unknown entries are dropped; duplicates collapse to the
// first occurrence; missing kinds are appended at their default
// position relative to the pin.
function normaliseOverlayOrder(rawOrder, legacyFxOrder, legacyRippleScope) {
  const defaults = DEFAULTS.overlayOrder;
  let order = Array.isArray(rawOrder) ? rawOrder.slice() : null;

  if (!order) {
    // No saved overlayOrder — synthesise from defaults + legacy fields.
    order = defaults.slice();
    if (Array.isArray(legacyFxOrder)) {
      // Splice the FX-subset positions to follow the legacy order.
      const fxSet = new Set(OVERLAY_FX_KINDS);
      const slots = [];
      order.forEach((k, i) => { if (fxSet.has(k)) slots.push(i); });
      legacyFxOrder.forEach((k, j) => {
        if (OVERLAY_FX_KINDS.includes(k) && slots[j] !== undefined) {
          order[slots[j]] = k;
        }
      });
    }
    if (legacyRippleScope === 'bg') {
      // Move 'ripples' from above the pin (default) to below.
      const ri = order.indexOf('ripples');
      const si = order.indexOf(OVERLAY_SCENE_PIN);
      if (ri >= 0 && si >= 0 && ri < si) {
        order.splice(ri, 1);
        const newPinIdx = order.indexOf(OVERLAY_SCENE_PIN);
        order.splice(newPinIdx + 1, 0, 'ripples');
      }
    }
  }

  // Drop unknown kinds.
  order = order.filter(k => KNOWN_OVERLAY_KINDS.includes(k));

  // Collapse duplicates (first occurrence wins).
  const seen = new Set();
  order = order.filter(k => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Append any missing kinds at their default position relative to
  // the scene pin (above if they're above in DEFAULTS, below if below).
  const presentSet = new Set(order);
  const defPinIdx = defaults.indexOf(OVERLAY_SCENE_PIN);
  for (const k of KNOWN_OVERLAY_KINDS) {
    if (presentSet.has(k)) continue;
    if (k === OVERLAY_SCENE_PIN) continue; // handled below
    const defIdx = defaults.indexOf(k);
    if (defIdx < defPinIdx) {
      // Default position is above the pin — insert at the top of
      // the above-pin section (preserves "post-process" semantics).
      const pinIdx = order.indexOf(OVERLAY_SCENE_PIN);
      if (pinIdx >= 0) order.splice(pinIdx, 0, k);
      else order.unshift(k);
    } else {
      order.push(k);
    }
    presentSet.add(k);
  }

  // Scene pin must appear exactly once.
  if (!presentSet.has(OVERLAY_SCENE_PIN)) {
    // No pin in user order — insert at the same position as in DEFAULTS.
    let insertAt = defPinIdx;
    if (insertAt > order.length) insertAt = order.length;
    order.splice(insertAt, 0, OVERLAY_SCENE_PIN);
  }

  return order;
}

export const OVERLAY_KIND_LIST  = KNOWN_OVERLAY_KINDS;
export const OVERLAY_FX_LIST    = OVERLAY_FX_KINDS;
export const OVERLAY_SCENE_KEY  = OVERLAY_SCENE_PIN;
// Exported for unit tests only; production code goes through
// loadSettings(). Underscore prefix marks "internal-but-visible".
export const _normaliseOverlayOrder = normaliseOverlayOrder;

export function loadSettings() {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    let raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      const v1 = localStorage.getItem(SETTINGS_KEY_V1);
      if (v1) {
        try { localStorage.removeItem(SETTINGS_KEY_V1); } catch {}
        return { ...DEFAULTS, ...JSON.parse(v1) };
      }
      return { ...DEFAULTS };
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.activeTypes) || parsed.activeTypes.length === 0
        || parsed.activeTypes.some(k => !ALL_CELL_KEYS.includes(k))) {
      parsed.activeTypes = [...DEFAULTS.activeTypes];
    }
    if (parsed.splitMode === 'fixedGrid') parsed.splitMode = 'bondDrift';
    // 2026 rename: showObjectCount → showCellTotal. The display
    // also dropped particles from the count, so migrating the
    // old value preserves the toggle state but the displayed
    // number will now be cells-only.
    if (typeof parsed.showObjectCount === 'boolean' && typeof parsed.showCellTotal !== 'boolean') {
      parsed.showCellTotal = parsed.showObjectCount;
    }
    delete parsed.showObjectCount;
    // 2026 rename: S.theme used to hold the colour-palette key
    // (bloodstream, aurora, …). Now S.theme holds the cell-shader
    // theme (legacy/microscope/…) and S.interfaceColor holds the
    // palette. If a saved settings blob still has a palette key in
    // .theme, migrate it to .interfaceColor and reset .theme to
    // 'legacy' so existing users see no visual change.
    if (parsed.theme && KNOWN_INTERFACE_COLOR_KEYS.includes(parsed.theme)) {
      if (!parsed.interfaceColor) parsed.interfaceColor = parsed.theme;
      parsed.theme = 'legacy';
    }
    if (parsed.theme && !KNOWN_THEME_KEYS.includes(parsed.theme)) parsed.theme = DEFAULTS.theme;
    // Legacy interfaceColor migration: pre-PR-#115 the dropdown
    // pointed at the same THEMES table the bg uses. Re-map any
    // surviving theme-key value to a sensible accent.
    if (parsed.interfaceColor && !KNOWN_INTERFACE_COLOR_KEYS.includes(parsed.interfaceColor)) {
      parsed.interfaceColor =
        LEGACY_INTERFACE_COLOR_MIGRATION[parsed.interfaceColor] || DEFAULTS.interfaceColor;
    }
    if (parsed.gameMode && !KNOWN_GAME_MODES.includes(parsed.gameMode)) parsed.gameMode = DEFAULTS.gameMode;
    const validBackgrounds = ['solid', ...KNOWN_BACKGROUND_KEYS];
    if (!parsed.background || !validBackgrounds.includes(parsed.background)) {
      parsed.background = DEFAULTS.background;
    }
    // Removed in late 2026 along with the cell-blending UI.
    delete parsed.blendMode;
    // 2026: scanlines bool toggle → scanlinesAlpha slider (0..1).
    // Legacy true → 0.32 (the old hardcoded alpha); false → 0.
    if (typeof parsed.scanlines === 'boolean') {
      if (typeof parsed.scanlinesAlpha !== 'number') {
        parsed.scanlinesAlpha = parsed.scanlines ? 0.32 : 0;
      }
      delete parsed.scanlines;
    }
    if (typeof parsed.scanlinesAlpha === 'number') {
      parsed.scanlinesAlpha = Math.max(0, Math.min(1, parsed.scanlinesAlpha));
    }
    if (!VALID_RENDER_SCALES.includes(parsed.renderScale)) parsed.renderScale = 1;
    const validRenderers = ['canvas2d', 'webgl2', 'webgpu'];
    // Migrate legacy renderer values (pixi / pixi-webgpu / pixi-webgl2) to
    // the new default. Pixi support was removed in favour of native WebGPU.
    if (!validRenderers.includes(parsed.renderer)) parsed.renderer = DEFAULTS.renderer;
    // Migrate the legacy `navArrows` bool + `navMode: 'floating'` to
    // the unified 4-way `navMode` selector. `navArrows === false`
    // collapses to `'none'`; the old `'floating'` value renames to
    // `'fixed'`. Then drop the dead key.
    if (parsed.navArrows === false) parsed.navMode = 'none';
    if (parsed.navMode === 'floating') parsed.navMode = 'fixed';
    delete parsed.navArrows;
    const validNavModes = ['none', 'fixed', 'anchored', 'circular'];
    if (!validNavModes.includes(parsed.navMode)) parsed.navMode = DEFAULTS.navMode;
    const validMetaRtModes = ['bbox', 'fullCanvas', 'sharedMax'];
    if (!validMetaRtModes.includes(parsed.metaRtMode)) parsed.metaRtMode = DEFAULTS.metaRtMode;
    const validMetaOutlineModes = ['edge', 'sdf', 'polygon'];
    if (!validMetaOutlineModes.includes(parsed.metaOutlineMode)) parsed.metaOutlineMode = DEFAULTS.metaOutlineMode;
    const validAddDialogViews = ['grid', 'list'];
    if (!validAddDialogViews.includes(parsed.addDialogView)) parsed.addDialogView = DEFAULTS.addDialogView;
    const validBlendModes = ['normal', 'multiply', 'additive'];
    if (!validBlendModes.includes(parsed.staticNoiseBlend)) parsed.staticNoiseBlend = DEFAULTS.staticNoiseBlend;
    if (!validBlendModes.includes(parsed.vignetteBlend))    parsed.vignetteBlend    = DEFAULTS.vignetteBlend;
    // Overlay stack: collapse legacy fxOrder + rippleScope into the
    // unified overlayOrder array. The shim runs every load — old
    // values are read once, then both legacy fields are deleted from
    // the parsed blob so they no longer round-trip through saveSettings.
    parsed.overlayOrder = normaliseOverlayOrder(
      parsed.overlayOrder,
      parsed.fxOrder,
      parsed.rippleScope,
    );
    delete parsed.fxOrder;
    delete parsed.rippleScope;
    // Microscope post-FX + duotone sliders. Focus + hues + saturation
    // live on [0, 1]; blur strength + falloff have tighter ceilings
    // (0.5 / 0.35) tuned in late 2026 — the prior [0, 1] range made
    // values past 0.1 produce visibly bad bokeh. Old saved settings
    // that exceeded the new ceiling get clamped down on load.
    const clampTo = (v, fallback, max = 1) => {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      return Math.max(0, Math.min(max, n));
    };
    parsed.microscopeFocus         = clampTo(parsed.microscopeFocus,         DEFAULTS.microscopeFocus);
    parsed.microscopeBlurStrength  = clampTo(parsed.microscopeBlurStrength,  DEFAULTS.microscopeBlurStrength, 0.5);
    parsed.microscopeFalloff       = clampTo(parsed.microscopeFalloff,       DEFAULTS.microscopeFalloff,      0.35);
    parsed.makeItRealHue1          = clampTo(parsed.makeItRealHue1,          DEFAULTS.makeItRealHue1);
    parsed.makeItRealHue2          = clampTo(parsed.makeItRealHue2,          DEFAULTS.makeItRealHue2);
    parsed.makeItRealSaturation    = clampTo(parsed.makeItRealSaturation,    DEFAULTS.makeItRealSaturation);
    // One-time migration after PR #147 shipped broken: force all
    // overlay toggles OFF on first load so users who toggled them on
    // before this fix don't see a stale (now-different) effect. They
    // can re-enable from Settings → Overlays. Flag is set once; later
    // sessions persist whatever the user actually chose.
    if (!parsed._microscopeFxResetV1) {
      parsed.microscopeBlur   = false;
      parsed.makeItReal       = false;
      parsed.causticsOverlay  = false;
      parsed.liquidRipples    = false;
      parsed.staticNoise      = false;
      parsed.vignette         = false;
      parsed.crosshair        = false;
      parsed._microscopeFxResetV1 = true;
    }
    // One-shot reset for the new glass-membrane overlay so existing
    // users boot with it off (matches the historical pattern above).
    if (!parsed._glassOverlayV1) {
      parsed.glassMembrane = false;
      parsed.glassChroma = false;
      parsed._glassOverlayV1 = true;
    }
    // bgLayers: array of { kind, opacity, blend, enabled, ...params }.
    // Missing / malformed → empty; renderers fall back to S.background.
    if (!Array.isArray(parsed.bgLayers)) {
      parsed.bgLayers = [];
    } else {
      parsed.bgLayers = parsed.bgLayers.filter(l => l && typeof l === 'object' && typeof l.kind === 'string')
        .map(l => ({
          ...l,
          opacity: (typeof l.opacity === 'number') ? Math.max(0, Math.min(1, l.opacity)) : 1,
          blend:   validBlendModes.includes(l.blend) ? l.blend : 'normal',
          enabled: l.enabled !== false,
        }));
    }
    // maxCells: invalid (non-number / NaN / Infinity) → 512; otherwise
    // clamp to [32, 4096]. Bounds match the Settings number input.
    if (typeof parsed.maxCells !== 'number' || !Number.isFinite(parsed.maxCells)) {
      parsed.maxCells = 512;
    }
    parsed.maxCells = Math.max(32, Math.min(4096, Math.round(parsed.maxCells)));
    // 2026-05: user explicitly asked for the split outline to follow
    // the actual rendered metaball shape. 'edge' mode traces the
    // blurred-mask 0.5 contour, which IS the rendered blob silhouette
    // exactly. 'sdf' was the previous default but draws two separate
    // half-polygon strokes that cross through the bond — not the
    // rendered shape. Bump any saved 'sdf' value to 'edge'.
    if (parsed.metaOutlineMode === 'sdf') parsed.metaOutlineMode = 'edge';
    if (typeof parsed.cellBorderThickness !== 'number' || !Number.isFinite(parsed.cellBorderThickness)) {
      parsed.cellBorderThickness = DEFAULTS.cellBorderThickness;
    }
    parsed.cellBorderThickness = Math.max(0.5, Math.min(5.0, parsed.cellBorderThickness));
    if (typeof parsed.lineThickness !== 'number' || !Number.isFinite(parsed.lineThickness)) {
      parsed.lineThickness = DEFAULTS.lineThickness;
    }
    parsed.lineThickness = Math.max(0.3, Math.min(10.0, parsed.lineThickness));
    if (typeof parsed.bgScale !== 'number' || !Number.isFinite(parsed.bgScale)) {
      parsed.bgScale = DEFAULTS.bgScale;
    }
    parsed.bgScale = Math.max(0.05, Math.min(20, parsed.bgScale));
    if (typeof parsed.tissueScale !== 'number' || !Number.isFinite(parsed.tissueScale)) {
      parsed.tissueScale = DEFAULTS.tissueScale;
    }
    parsed.tissueScale = Math.max(0.1, Math.min(1.0, parsed.tissueScale));
    if (typeof parsed.faceScale !== 'number' || !Number.isFinite(parsed.faceScale)) {
      parsed.faceScale = DEFAULTS.faceScale;
    }
    parsed.faceScale = Math.max(0.2, Math.min(2.2, parsed.faceScale));
    if (typeof parsed.glassStrength !== 'number' || !Number.isFinite(parsed.glassStrength)) {
      parsed.glassStrength = DEFAULTS.glassStrength;
    }
    parsed.glassStrength = Math.max(0.1, Math.min(3.0, parsed.glassStrength));
    if (typeof parsed.glassSize !== 'number' || !Number.isFinite(parsed.glassSize)) {
      parsed.glassSize = DEFAULTS.glassSize;
    }
    parsed.glassSize = Math.max(0.0, Math.min(0.5, parsed.glassSize));
    if (typeof parsed.glassInset !== 'number' || !Number.isFinite(parsed.glassInset)) {
      parsed.glassInset = DEFAULTS.glassInset;
    }
    parsed.glassInset = Math.max(0.0, Math.min(0.05, parsed.glassInset));
    parsed.glassMembrane = !!parsed.glassMembrane;
    parsed.glassChroma = !!parsed.glassChroma;
    if (typeof parsed.bumpFeedbackIntensity !== 'number' || !Number.isFinite(parsed.bumpFeedbackIntensity)) {
      parsed.bumpFeedbackIntensity = DEFAULTS.bumpFeedbackIntensity;
    }
    parsed.bumpFeedbackIntensity = Math.max(0, Math.min(3, parsed.bumpFeedbackIntensity));
    parsed.bumpFeedback = parsed.bumpFeedback !== false;
    if (typeof parsed.bumpAttack !== 'number' || !Number.isFinite(parsed.bumpAttack)) {
      parsed.bumpAttack = DEFAULTS.bumpAttack;
    }
    parsed.bumpAttack = Math.max(0.001, Math.min(1.0, parsed.bumpAttack));
    if (typeof parsed.bumpDuration !== 'number' || !Number.isFinite(parsed.bumpDuration)) {
      parsed.bumpDuration = DEFAULTS.bumpDuration;
    }
    parsed.bumpDuration = Math.max(0.1, Math.min(5.0, parsed.bumpDuration));
    // Cardiovascular vessels — boolean coerce + enum validate + slider clamps.
    parsed.vesselsEnabled = parsed.vesselsEnabled !== false;
    if (parsed.vesselsLayout !== 'branching'
        && parsed.vesselsLayout !== 'tube'
        && parsed.vesselsLayout !== 'heart') {
      parsed.vesselsLayout = DEFAULTS.vesselsLayout;
    }
    if (typeof parsed.vesselsRadius !== 'number' || !Number.isFinite(parsed.vesselsRadius)) {
      parsed.vesselsRadius = DEFAULTS.vesselsRadius;
    }
    parsed.vesselsRadius = Math.max(0.5, Math.min(2.0, parsed.vesselsRadius));
    if (typeof parsed.vesselsFlowSpeed !== 'number' || !Number.isFinite(parsed.vesselsFlowSpeed)) {
      parsed.vesselsFlowSpeed = DEFAULTS.vesselsFlowSpeed;
    }
    parsed.vesselsFlowSpeed = Math.max(0, Math.min(3, parsed.vesselsFlowSpeed));
    if (typeof parsed.vesselsRbcDensity !== 'number' || !Number.isFinite(parsed.vesselsRbcDensity)) {
      parsed.vesselsRbcDensity = DEFAULTS.vesselsRbcDensity;
    }
    parsed.vesselsRbcDensity = Math.max(0, Math.min(2, parsed.vesselsRbcDensity));
    // Migrate legacy locale code 'brbn' (Barbarian) to 'bar' (Bavarian).
    if (parsed.lang === 'brbn') parsed.lang = 'bar';
    // Rheinhessisch was renamed to Mainzerisch (Mainz city dialect).
    if (parsed.lang === 'rhe') parsed.lang = 'mainz';
    // Removed background: dracula → fall back to bloodstream so existing
    // savefiles don't get an empty BG dropdown.
    if (parsed.background === 'dracula') parsed.background = 'bloodstream';
    // Migrate legacy `highlightColor` field to the new `useHighlight` toggle.
    if (typeof parsed.useHighlight !== 'boolean') {
      parsed.useHighlight = (typeof parsed.highlightColor === 'string')
        ? parsed.highlightColor.toLowerCase() !== '#ffffff'
        : true;
    }
    delete parsed.highlightColor;
    return { ...DEFAULTS, ...parsed };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch {}
}

export const S = loadSettings();

// ---------- Overlay-stack helpers ----------
// Renderers + UI talk to S.overlayOrder through these helpers
// instead of indexing the array directly. Keeps the "scene pin
// is at most one entry" invariant out of every call site.

// Returns the FX-blend subset of overlayOrder in user order
// (e.g. ['vignette','noise','crosshair']). Used by renderers
// that still iterate just the cheap-blend FX trio.
export function overlayFxOrder() {
  const order = Array.isArray(S.overlayOrder) ? S.overlayOrder : [];
  return order.filter(k => OVERLAY_FX_KINDS.includes(k));
}

// Replace the FX-kind positions inside S.overlayOrder with the
// supplied permutation, preserving every non-FX entry's slot.
// Used by the legacy fxOrder UI in app.js so reorders survive
// until PR B replaces the UI entirely.
export function setOverlayFxOrder(newFxOrder) {
  if (!Array.isArray(newFxOrder)) return;
  const order = S.overlayOrder;
  if (!Array.isArray(order)) return;
  const slots = [];
  order.forEach((k, i) => { if (OVERLAY_FX_KINDS.includes(k)) slots.push(i); });
  newFxOrder.forEach((k, j) => {
    if (OVERLAY_FX_KINDS.includes(k) && slots[j] !== undefined) {
      order[slots[j]] = k;
    }
  });
}

// True iff `kind` is positioned above the scene pin in
// overlayOrder — i.e. runs as a full-scene post-process after
// the cell pass. Returns false when the kind appears below the
// pin (bg-only) or isn't present at all.
export function overlayKindRunsAfterScene(kind) {
  const order = Array.isArray(S.overlayOrder) ? S.overlayOrder : [];
  const ki = order.indexOf(kind);
  const si = order.indexOf(OVERLAY_SCENE_PIN);
  if (ki < 0 || si < 0) return false;
  return ki < si;
}

// Move the entry `kind` to the requested side of the scene pin.
// `side` is 'after' (above pin = full-scene) or 'before'
// (below pin = bg-only). No-op if `kind` is the pin itself.
export function setOverlayKindSide(kind, side) {
  if (kind === OVERLAY_SCENE_PIN) return;
  const order = S.overlayOrder;
  if (!Array.isArray(order)) return;
  const ki = order.indexOf(kind);
  if (ki < 0) return;
  const wantsAfter = side === 'after';
  const currentlyAfter = overlayKindRunsAfterScene(kind);
  if (wantsAfter === currentlyAfter) return;
  order.splice(ki, 1);
  const pin = order.indexOf(OVERLAY_SCENE_PIN);
  if (wantsAfter) order.splice(pin, 0, kind);                // just above
  else            order.splice(pin + 1, 0, kind);            // just below
}

// First-run language auto-detect; only fires when no preference was saved.
if (!S._langSet) {
  const nav = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en';
  if (nav.startsWith('de')) S.lang = 'de';
  else if (nav.startsWith('es')) S.lang = 'es';
  else S.lang = 'en';
  S._langSet = true;
  saveSettings();
}

// ---------- i18n ----------
export const LOCALES = {
  en: {
    settings_title: 'Settings', settings_accordion: 'Accordion',
    bg_solid: 'Solid color',
    bg_bloodstream: 'Bloodstream (crimson)',
    bg_bloodflow: 'Bloodflow (vermilion)',
    bg_cellShadow: 'Cell Shadow (red)',
    bg_cartoonNight: 'Cosmic Soup (navy)',
    bg_spectrum: 'Spectrum (rainbow)',
    bg_lymphNode: 'Lymph Node (violet)',
    bg_lung: 'Lung (smoke)',
    bg_aurora: 'Aurora (green/violet)',
    bg_underwater: 'Underwater (caustic)',
    bg_lavaFire: 'Magma (orange)',
    bg_reactor: 'Reactor (acid green)',
    bg_mitochondria: 'Mitochondria (amber)',
    bg_neuron: 'Neuron (electric blue)',
    bg_bile: 'Bile (chartreuse)',
    bg_tissue: 'Tissue (texture)',
    ic_pink: 'Pink', ic_red: 'Red', ic_amber: 'Amber', ic_yellow: 'Yellow',
    ic_green: 'Green', ic_cyan: 'Cyan', ic_blue: 'Blue', ic_violet: 'Violet', ic_mono: 'Mono',
    theme: 'Theme', interface_color: 'Interface color', background: 'Background', gameplay: 'Gameplay',
    theme_legacy: 'Legacy (default)', theme_microscope: 'Microscope',
    theme_cartoon: 'Cartoon', theme_kurzgesagt: 'Kurzgesagt', theme_classic: 'Classic',
    splitting: 'Splitting', population: 'Population',
    physics: 'Physics', look: 'Look',
    performance: 'Performance', language: 'Language',
    allow_pathogens: 'Allow pathogens',
    pinch_rotation: 'Two-finger rotation',
    fullscreen: 'Fullscreen',
    shader_test_link: 'Shader test',
    game_mode: 'Game mode',
    mode_free: 'Free Game',
    mode_campaign_soon: 'Campaign (soon)',
    mode_survival_soon: 'Survival (soon)',
    composition_hud: 'Composition HUD',
    caustics_overlay: 'Caustics overlay',
    liquid_ripples: 'Liquid ripples',
    ripple_density: 'Wave density',
    ripple_reach: 'Wave reach',
    ripple_strength: 'Wave strength',
    caustic_tint_r: 'Tint R',
    caustic_tint_g: 'Tint G',
    caustic_tint_b: 'Tint B',
    microscope_blur: 'Microscope blur',
    microscope_focus: 'Focus radius',
    microscope_blur_strength: 'Blur strength',
    microscope_falloff: 'Falloff',
    make_it_real: 'Electron Microscope (Duotone)',
    make_it_real_hue1: 'Shadow hue',
    make_it_real_hue2: 'Highlight hue',
    make_it_real_saturation: 'Saturation',
    bg_load_preset: 'Load preset',
    bg_layers: 'Layers',
    bg_add_layer: '+ Add layer',
    bg_layer_kind: 'Kind',
    bg_layer_opacity: 'Opacity',
    bg_layer_blend: 'Blend',
    bg_layer_delete: 'Delete layer',
    bg_layer_enabled: 'Enabled',
    bg_layer_drag: 'Drag to reorder',
    blend_normal: 'Normal',
    blend_multiply: 'Multiply',
    blend_additive: 'Additive',
    bg_layer_base: 'Base',
    bg_layer_top: 'Top color',
    bg_layer_bot: 'Bottom color',
    bg_layer_spot_color: 'Spot color',
    bg_layer_ring_color: 'Ring color',
    bg_layer_grid_color: 'Grid color',
    bg_layer_grid_step: 'Grid step',
    bg_layer_spot_count: 'Spot count',
    bg_layer_vignette: 'Vignette',
    bg_layer_seed_count: 'Random spots',
    bg_layer_reseed_sec: 'Randomisation (s)',
    bg_layer_sim_speed: 'Time (steps/frame)',
    fx_order_title: 'Overlay order',
    overlay_order_title: 'Stack (top runs last)',
    overlay_pin_scene: '— scene (cells render here) —',
    overlay_kind_duotone:    'Electron Microscope (Duotone)',
    overlay_kind_noise:      'Static noise',
    overlay_kind_vignette:   'Vignette',
    overlay_kind_crosshair:  'Crosshair',
    overlay_kind_microscope: 'Microscope blur',
    overlay_kind_caustics:   'Caustics',
    overlay_kind_celltype:   'Cell-type labels',
    overlay_kind_ripples:    'Liquid ripples',
    overlay_kind_glass:      'Glass membrane',
    glass_strength:          'Refraction strength',
    glass_size:              'Lens band size',
    glass_inset:             'Lens band inset',
    glass_chroma:            'Chromatic split',
    bump_feedback:           'Bump feedback',
    bump_feedback_intensity: 'Bump intensity',
    bump_attack:             'Bump attack',
    bump_duration:           'Bump duration',
    vessels_section:           'Blood vessels',
    vessels_enabled:           'Confine cells to vessels',
    vessels_layout:            'Vessel layout',
    vessels_layout_branching:  'Branching network',
    vessels_layout_tube:       'Single tube',
    vessels_layout_heart:      'Stylised heart',
    vessels_radius:            'Vessel width',
    vessels_flow_speed:        'Bloodflow speed',
    vessels_rbc_density:       'RBC density',
    fx_kind_noise: 'Static noise',
    fx_kind_vignette: 'Vignette',
    fx_kind_crosshair: 'Crosshair',
    fx_move_up: 'Move up',
    fx_move_down: 'Move down',
    fx_drag_reorder: 'Drag to reorder',
    cell_type_overlay: 'Show cell types',
    counters_needed: 'Counters needed',
    counters_covered: 'Fully covered',
    no_pathogens: 'No pathogens',
    audio: 'Audio',
    music_enabled: 'Music',
    now_playing: 'Now playing:',
    music_volume: 'Music volume',
    sfx_volume: 'Sound effects volume',
    next_track: 'Next track',
    random_split: 'Random splitting', meta_split: 'Metaball split',
    meta_rt_mode: 'Metaball RT mode',
    meta_rt_bbox: 'Per-pair bbox (default)',
    meta_rt_full: 'Full-canvas pool',
    meta_rt_shared: 'Shared (largest pair)',
    meta_outline_hint_edge: ' — traces the blurred-mask 0.5 contour, matches the rendered blob exactly.',
    meta_outline_hint_sdf: ' — strokes each half-polygon, two outlines crossing through the bond.',
    meta_outline_hint_polygon: ' — polygon-union rim, sharp / no blur.',
    auto_split: 'Auto-split (s)',
    friction: 'Friction', bounce: 'Bounce', throw_strength: 'Throw strength',
    wobble: 'Wobble', bg_flow: 'Background flow', bg_scale: 'Background scaling', tissue_scale: 'Tissue quality (Canvas2D)', outline_px: 'Outline px', face_size: 'Face size',
    membrane: 'Membrane', cell_size: 'Cell size', use_highlight: 'Use highlight colour',
    line_thickness: 'Line thickness',
    mode_target: 'Target mode', mode_target_tip: 'Tap to select / send selected cells',
    mode_split: 'Split mode', mode_split_tip: 'Tap a cell to split it',
    mode_kill: 'Kill mode', mode_kill_tip: 'Tap a cell to make it explode',
    cartoon_mode: 'Cartoon mode (faces)', show_fps: 'Show FPS + renderer', show_renderer: 'Show renderer', show_build_info: 'Show build info', show_cell_total: 'Show cell total', nav_arrows: 'Off-screen arrows',
    extended_cells: 'Show extended (non-game) cells',
    nav_mode: 'Arrow mode',
    nav_mode_none: 'None',
    nav_mode_fixed: 'Fixed (4 edges)',
    nav_mode_anchored: 'Anchored (slide along edge)',
    nav_mode_circular: 'Anchored (circular)',
    copy_build: 'Copy build SHA', toast_build_copied: 'Build SHA copied to clipboard', toast_build_copy_failed: 'Copy failed', build_stamp_copy_hint: 'Click to copy full build SHA', github: 'GitHub',
    screenshot_btn: 'Screenshot', toast_screenshot_saved: 'Screenshot saved', toast_screenshot_failed: 'Screenshot failed',
    copy_settings:  'Copy settings',  toast_settings_copied:  'Settings copied to clipboard',
    save_settings:  'Save settings',  toast_settings_saved:   'Settings saved to file',
    apply_settings: 'Apply settings', apply_settings_title:   'Apply settings',
    apply_settings_hint:    'Paste the JSON from Copy/Save settings and click Apply. The page reloads to pick up the new state.',
    apply_settings_confirm: 'Apply',
    toast_settings_applied: 'Settings applied — reloading',
    toast_settings_dump_failed:  'Settings dump failed',
    toast_settings_apply_failed: 'Apply failed — paste was not valid JSON',
    cancel: 'Cancel',
    show_field: 'Show metaball field', render_scale: 'Render scale',
    upscale: 'Upscale', scanlines: 'Scanlines (CRT)',
    renderer_engine: 'Renderer',
    renderer_canvas: 'Canvas2D',
    renderer_webgl: 'WebGL2',
    renderer_webgpu: 'WebGPU',
    reset_sim: 'Reset simulation',
    about: 'About', links: 'Links', about_credits: 'Credits', about_licences: 'Third-party licences', about_licences_note: 'Three shader assets carry the Shadertoy default CC BY-NC-SA 3.0 licence (NonCommercial + ShareAlike). They would need replacing if this project ships under a permissive licence.', about_permissive: 'Permissive ports', about_desc: 'A 2D microbe sim — phagocytes, lymphocytes, and the pathogens they hunt.', about_project_licence: 'Project licence', about_project_licence_note: 'Microbes is released under the GNU General Public License v3.0. Full text in the LICENSE file at the repo root.', about_soundtracks: 'Soundtracks', about_soundtracks_note: 'Soundtracks ship with the project and are covered by the GPL v3 licence above. SFX are covered by the same terms.',
    help_title: 'Cells of the immune system',
    add_cell: 'Add a cell', add_pathogen: 'Add a pathogen',
    add_title: 'Add', add_tab_cells: 'Cells', add_tab_pathogens: 'Pathogens', add_tab_theme: 'Theme',
    spawn_banner_friends: 'Allies', spawn_banner_prey: 'Prey', spawn_banner_foes: 'Foes', spawn_banner_close: 'Got it',
    view_grid: 'Grid view', view_list: 'List view',
    max_cells: 'Max cells',
    max_cells_hint: 'At the cap, new spawns + splits silently recycle the oldest cell.',
    overlays_section: 'Overlays',
    static_noise: 'Static noise',
    static_noise_intensity: 'Noise intensity',
    vignette: 'Vignette',
    vignette_intensity: 'Vignette intensity',
    crosshair: 'Crosshair',
    overlay_blend_label: 'Blend',
    overlay_blend_normal: 'Normal',
    overlay_blend_multiply: 'Multiply',
    overlay_blend_additive: 'Additive',
    palette_to_help: 'Learn what each cell does →',
    palette_bad_to_help: 'Learn what each pathogen does →',
    debug: 'Debug', clear: 'Clear', copy: 'Copy',
    pause: 'Pause', paused: 'PAUSE',
    paused_hint: 'Tap space or anywhere to continue',
    nav_settings: 'Settings', nav_help: 'Help', nav_add_cell: 'Add a cell',
    nav_add_pathogen: 'Add a pathogen', nav_reload: 'Hard reload',
    adding: 'Adding: {name}',
    fps_line: '{fps} fps · cells {n}',
    help_group_good: 'Immune system & body',
    blend_none: 'None', blend_overlay: 'Overlay (default)', blend_multiply: 'Multiply',
    blend_darken: 'Darken', blend_lighter: 'Add (Lighter)', blend_screen: 'Screen',
    blend_softlight: 'Soft light', blend_hardlight: 'Hard light',
    blend_burn: 'Color burn', blend_dodge: 'Color dodge',
    upscale_blur: 'Blur (smooth)', upscale_pixel: 'Pixel (crisp)',
    pgroup_virus: 'Viruses', pgroup_bacteria: 'Bacteria',
    pgroup_parasite: 'Parasites', pgroup_fungus: 'Fungi', pgroup_toxin: 'Toxins',
    cell_neutrophil_label: 'Neutrophil',
    cell_neutrophil_desc: 'First responder; engulfs bacteria via phagocytosis. The most abundant white blood cell.',
    cell_monocyte_label: 'Monocyte',
    cell_monocyte_desc: 'Circulating sentinel that matures into macrophages or dendritic cells once it enters tissue.',
    cell_mast_label: 'Mast Cell',
    cell_mast_desc: 'Tissue-resident sentinel; releases histamine to trigger inflammation and allergic responses.',
    cell_nk_label: 'Natural Killer',
    cell_nk_desc: 'Patrols for virus-infected and tumour cells; kills on contact without prior sensitisation.',
    cell_macrophage_label: 'Macrophage',
    cell_macrophage_desc: '"Big eater" — long-lived phagocyte that engulfs pathogens and presents antigens to T cells.',
    cell_dendritic_label: 'Dendritic Cell',
    cell_dendritic_desc: 'Antigen-presenting courier; samples invaders and shows them to T cells in lymph nodes.',
    cell_basophil_label: 'Basophil',
    cell_basophil_desc: 'Circulating granulocyte; releases histamine and heparin to reinforce inflammation.',
    cell_platelet_label: 'Platelet',
    cell_platelet_desc: 'Tiny cell fragment that clots blood at injuries and helps recruit immune cells.',
    cell_tcell_label: 'T Cell',
    cell_tcell_desc: 'Adaptive killer / coordinator; recognises specific antigens and kills infected cells.',
    cell_bcell_label: 'B Cell',
    cell_bcell_desc: 'Adaptive antibody factory; secretes antibodies tagged to specific pathogens.',
    cell_eosinophil_label: 'Eosinophil',
    cell_eosinophil_desc: 'Anti-parasite specialist; key in allergic responses, releases toxic granule contents.',
    cell_rbc_label: 'Red Blood Cell',
    cell_rbc_desc: 'Erythrocyte; biconcave disc full of haemoglobin that carries oxygen around the body.',
    cell_virus_label: 'Virus',
    cell_virus_desc: 'Spike-protein invader; hijacks cells to replicate inside them.',
    cell_germ_label: 'Germ',
    cell_germ_desc: 'Generic bumpy microbe — opportunistic infector.',
    cell_bacterium_label: 'Bacterium',
    cell_bacterium_desc: 'Rod-shaped bacterium swimming with a whipping flagellum.',
    cell_amoebaP_label: 'Amoeba (parasite)',
    cell_amoebaP_desc: 'Amoeboid parasite that crawls and engulfs tissue.',
    cell_slime_label: 'Slime',
    cell_slime_desc: 'Slimy biofilm globule; drips toxic ooze.',
    cell_mite_label: 'Mite',
    cell_mite_desc: 'Tiny scuttling bug; lots of little legs.',
    cell_spore_label: 'Spore',
    cell_spore_desc: 'Fungal spore — drifts on currents and seeds new growth.',
    cell_toxin_label: 'Toxin',
    cell_toxin_desc: 'Jagged toxin crystal that drifts and burns on contact.',
  },
};

export function T(key, vars) {
  const dict = LOCALES[S.lang] || LOCALES.en;
  let s = dict[key];
  if (s == null) s = LOCALES.en[key];
  if (s == null) s = key;
  if (vars) {
    for (const k in vars) {
      s = s.split('{' + k + '}').join(vars[k]);
    }
  }
  return s;
}

export function applyI18n() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = T(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const spec = el.getAttribute('data-i18n-attr');
    for (const pair of spec.split(',')) {
      const [attr, key] = pair.split('=').map(s => s && s.trim());
      if (attr && key) el.setAttribute(attr, T(key));
    }
  });
}

// Every valid language code the picker offers. `en` is the inline
// fallback (always in LOCALES); the rest live in assets/i18n/*.json
// and are fetched on demand via ensureLocale().
export const KNOWN_LOCALE_CODES = new Set([
  'en', 'de', 'es', 'bar', 'hes', 'mainz', 'latin',
  'gmh', 'pie', 'qya', 'sjn', 'mor', 'tlh',
]);

const _localeFetches = Object.create(null);

// Fetch + install a locale dictionary into LOCALES. Idempotent:
// returns the in-flight (or resolved) promise on repeat calls.
// Swallows network / parse failures so a missing file just leaves
// T() falling through to the inline `en` strings.
export function ensureLocale(code) {
  if (!code || code === 'en') return Promise.resolve();
  if (!KNOWN_LOCALE_CODES.has(code)) return Promise.resolve();
  if (LOCALES[code]) return Promise.resolve();
  if (_localeFetches[code]) return _localeFetches[code];
  if (typeof fetch === 'undefined') return Promise.resolve();
  // Resolve relative to this module so the locale files load from
  // assets/i18n/ regardless of which page imports state.js.
  const url = new URL('../i18n/' + code + '.json', import.meta.url);
  const p = fetch(url)
    .then(r => r.ok ? r.json() : null)
    .then(dict => {
      if (dict && typeof dict === 'object') {
        // Strip the optional provenance note so T('//') never
        // returns the canon-vs-coinage comment.
        delete dict['//'];
        LOCALES[code] = dict;
      }
    })
    .catch(err => {
      console.warn('[i18n] failed to load locale', code, err);
    });
  _localeFetches[code] = p;
  return p;
}

// Kicked off at module load so the first applyI18n() in app.js
// races with the network rather than blocking on it. Consumers
// that want the localized first paint can `await localeReady`.
export const localeReady = ensureLocale(S.lang);

export function cellLabel(typeKey) {
  return T('cell_' + typeKey + '_label')
    || (CELL_TYPES[typeKey] && CELL_TYPES[typeKey].label)
    || typeKey;
}

export function cellDesc(typeKey) {
  return T('cell_' + typeKey + '_desc')
    || (CELL_TYPES[typeKey] && CELL_TYPES[typeKey].description)
    || '';
}

// ---------- Themes ----------
//
// Trimmed in late 2026 from 26 entries → 8 (+ the 'solid' synthetic
// background appended in BACKGROUNDS below). The four "physiological"
// entries (lung / aurora / underwater / lavaFire) drive new procedural
// shaders in webgl2.js / webgpu.js (kind values 4..7); canvas2d falls
// back to flat / gradient base colours for those.
export const THEMES = {
  // Labels follow the "Name (colour)" convention so the user can
  // pick by both the in-app accent name and the dominant tone.
  bloodstream: {
    label: 'Bloodstream (crimson)',
    bg: { kind: 'gradient', topColor: '#5b101a', botColor: '#1d0306', spotColor: 'rgba(255,90,100,0.18)', spotCount: 6, vignette: 0, rbcSilhouettes: true },
    outline: { color: '#1c0306', defaultPx: 4 },
    ui: { panelAccent: '#ff6b6b' },
  },
  bloodflow: {
    label: 'Bloodflow (vermilion)',
    // topColor/botColor match the previous hard-coded shader ramp
    // (0.42,0.06,0.08) and (0.18,0.03,0.05) so the default look is
    // preserved now that the bloodflow shader actually reads them.
    bg: { kind: 'bloodflow', topColor: '#6b0f14', botColor: '#2e080d', vignette: 0 },
    outline: { color: '#1c0306', defaultPx: 4 },
    ui: { panelAccent: '#d63333' },
  },
  cellShadow: {
    label: 'Cell Shadow (red)',
    // base #c83245 matches the previously hard-coded voronoi colour
    // (vec3(200/255, 50/255, 69/255)) so the picker drives the look.
    bg: { kind: 'cell-shadow', base: '#c83245', vignette: 0 },
    outline: { color: '#1c0306', defaultPx: 4 },
    ui: { panelAccent: '#c83246' },
  },
  cartoonNight: {
    label: 'Cosmic Soup (navy)',
    bg: { kind: 'flat', base: '#0c1a3a', spotColors: ['#ff7ab8','#ffb84d','#5fe3d2','#ff5d6e'], spotCount: 6, vignette: 0 },
    outline: { color: '#04081a', defaultPx: 5 },
    ui: { panelAccent: '#5fe3d2' },
  },
  spectrum: {
    label: 'Spectrum (rainbow)',
    bg: { kind: 'flat', base: '#000000', spotColors: ['#ff003c','#ff8a00','#ffd600','#3ecf6c','#3da6ff','#a855f7'], spotCount: 6, vignette: 0 },
    outline: { color: '#000000', defaultPx: 4 },
    ui: { panelAccent: '#a855f7' },
  },
  lymphNode: {
    label: 'Lymph Node (violet)',
    bg: { kind: 'gradient', topColor: '#2a0e3a', botColor: '#0a0410', spotColor: 'rgba(160,120,200,0.15)', spotCount: 5, vignette: 0 },
    outline: { color: '#0a0410', defaultPx: 4 },
    ui: { panelAccent: '#bd93e2' },
  },
  lung: {
    label: 'Lung (smoke)',
    // topColor/botColor match the previously hard-coded hot/cool ramp
    // (0.510,0.204,0.016) / (0.529,0.808,0.980) so the default smoke
    // look is preserved now that the lung shader reads u_top / u_bot.
    bg: { kind: 'lung', base: '#1a1118', topColor: '#823404', botColor: '#87cefa', spotCount: 0, vignette: 0 },
    outline: { color: '#02080f', defaultPx: 4 },
    ui: { panelAccent: '#ff9aa8' },
  },
  aurora: {
    label: 'Aurora (green/violet)',
    // topColor/botColor mix into the ribbon hue — defaults match the
    // previously hard-coded green (0.24,0.95,0.52) and violet
    // (0.55,0.35,0.95). base is the night-sky tint below the ribbons.
    bg: { kind: 'aurora', base: '#050a18', topColor: '#3df285', botColor: '#8c59f2', vignette: 0 },
    outline: { color: '#020410', defaultPx: 4 },
    ui: { panelAccent: '#3df285' },
  },
  underwater: {
    label: 'Underwater (caustic)',
    // botColor is the deep wash, topColor is the bright caustic peak —
    // defaults match the previously hard-coded deep (0.04,0.16,0.30)
    // and bright (0.60,0.95,1.00).
    bg: { kind: 'underwater', base: '#020a18', topColor: '#99f2ff', botColor: '#0a2950', vignette: 0 },
    outline: { color: '#020a18', defaultPx: 4 },
    ui: { panelAccent: '#99f2ff' },
  },
  lavaFire: {
    label: 'Magma (orange)',
    // base/bot/top/peak ramp now reads u_base/u_bot/u_top in the lava
    // shader. Defaults match the previous hard-coded stops
    // (0.05,0.01,0.00)/(0.50,0.03,0.01)/(1.00,0.45,0.05) so the look
    // is preserved out of the box; peak is derived as clamp(top*2).
    bg: { kind: 'lava', base: '#0d0300', topColor: '#ff730d', botColor: '#800803', spotCount: 0, vignette: 0 },
    outline: { color: '#1a0606', defaultPx: 4 },
    ui: { panelAccent: '#ff5a00' },
  },
  // ── New palettes (2026) — common themes the project lacked.
  mitochondria: {
    // Warm amber on deep brown — mitochondrial inner-membrane palette.
    label: 'Mitochondria (amber)',
    bg: { kind: 'gradient', topColor: '#3a1c0a', botColor: '#100602', spotColor: 'rgba(255,160,60,0.20)', spotCount: 6, vignette: 0 },
    outline: { color: '#1c0a02', defaultPx: 4 },
    ui: { panelAccent: '#ffa040' },
  },
  neuron: {
    // Electric blue on near-black — synapse / action-potential feel.
    label: 'Neuron (electric blue)',
    bg: { kind: 'gradient', topColor: '#0a1830', botColor: '#020610', spotColor: 'rgba(80,180,255,0.22)', spotCount: 5, vignette: 0 },
    outline: { color: '#020610', defaultPx: 3 },
    ui: { panelAccent: '#50b4ff' },
  },
  bile: {
    // Chartreuse on deep olive — bile / gallbladder palette.
    label: 'Bile (chartreuse)',
    bg: { kind: 'gradient', topColor: '#1c2810', botColor: '#080c04', spotColor: 'rgba(180,220,80,0.18)', spotCount: 4, vignette: 0 },
    outline: { color: '#080c04', defaultPx: 4 },
    ui: { panelAccent: '#b4dc50' },
  },
  // Gray-Scott reaction-diffusion. The renderer maintains two
  // half-resolution ping-pong textures, runs N step iterations per
  // visible frame, and refreshes a few uniform-random B-concentration
  // seed discs every ~10 s. WebGL2 + WebGPU implement; canvas2d falls
  // back to the base colour. See .claude/plan/04-reactor-bg.md.
  reactor: {
    label: 'Reactor (acid green)',
    // seedCount  — random discs placed per reseed event (1..8).
    // reseedSec  — seconds between random reseeds ("Randomisation").
    // simSpeed   — Gray-Scott step iterations per frame ("Time"; 0 = paused).
    // base/botColor/topColor — dark→mid→hot ramp on B-concentration.
    //   Defaults match the previous hard-coded stops
    //   (0.02,0.06,0.04)/(0.10,0.40,0.20)/(0.49,1.00,0.54) so the
    //   acid-green look is preserved now that the kind-8 display
    //   shader reads u_base/u_bot/u_top.
    bg: { kind: 'reactor', base: '#051010', botColor: '#1a6633', topColor: '#7dff8a', vignette: 0, seedCount: 6, reseedSec: 10, simSpeed: 5 },
    outline: { color: '#0a1816', defaultPx: 4 },
    ui: { panelAccent: '#7eff8a' },
  },
  // Tissue (texture) — first image-sampled bg in the codebase. The
  // shader path samples a tiled `tissue.jpg` via fract(worldUv) so
  // the pattern is seamless at any bgScale. Canvas2D uses
  // ctx.createPattern. Outline + accent picked to match the warm
  // ochre tones of the texture so existing chrome reads.
  tissue: {
    label: 'Tissue (texture)',
    bg: { kind: 'tissue', base: '#3a1820', textureUrl: 'assets/textures/tissue.jpg', spotCount: 0, vignette: 0 },
    outline: { color: '#1a0a0e', defaultPx: 4 },
    ui: { panelAccent: '#d97a85' },
  },
};

// Interface-accent palette — small standalone table separate from
// the scene-render THEMES table. Each entry only carries what the
// UI consumes: a label (for the dropdown), the accent colour (CSS
// --accent), and a contrast colour (--accent-ink) for icons /
// text on the accent background.
export const INTERFACE_ACCENTS = {
  pink:   { label: 'Pink',   accent: '#ff7a93', accentInk: '#2a0b14' },
  red:    { label: 'Red',    accent: '#ff5a5a', accentInk: '#2a0606' },
  amber:  { label: 'Amber',  accent: '#ffa040', accentInk: '#2a1606' },
  yellow: { label: 'Yellow', accent: '#ffd166', accentInk: '#2a2406' },
  green:  { label: 'Green',  accent: '#7eff8a', accentInk: '#062a0d' },
  cyan:   { label: 'Cyan',   accent: '#5fe3d2', accentInk: '#062a26' },
  blue:   { label: 'Blue',   accent: '#5ab8ff', accentInk: '#06162a' },
  violet: { label: 'Violet', accent: '#bd93f9', accentInk: '#180a2a' },
  mono:   { label: 'Mono',   accent: '#e8e8e8', accentInk: '#1a1a1a' },
};

// Returns the active interface-accent — { label, accent, accentInk }.
// Falls back to pink if S.interfaceColor is stale or unknown (the
// loadSettings migration shim should already have remapped legacy
// theme-key values, this is the runtime safety net).
export function currentInterfaceColor() {
  return INTERFACE_ACCENTS[S.interfaceColor] || INTERFACE_ACCENTS.pink;
}

// Backwards-compat alias for callers that read the palette via the
// old name. They still get the scene-render THEME (not the accent)
// so existing background-related callers don't break.
export function currentTheme() {
  return THEMES[S.background] || THEMES.bloodstream;
}

// Effective highlight colour for selection visuals. When the user toggle is
// off we drop to plain white (callers can read this as "no tint").
export function currentHighlightColor() {
  if (!S.useHighlight) return '#ffffff';
  const t = currentTheme();
  return (t && t.ui && t.ui.panelAccent) || '#ffffff';
}

// Map a hex colour to a coarse human-readable bucket via HSL hue. Handles
// pastels and dark tones correctly: very low saturation falls to gray /
// white / black; otherwise the hue maps onto a 12-name colour wheel.
// Used by the theme dropdown so users can scan by hue ("Petri Dish
// (amber)") instead of by hex code.
export function colorNameFor(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return '';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 510;             // 0..1
  let sat = 0;
  if (max !== min) {
    sat = (lightness < 0.5)
      ? (max - min) / (max + min)
      : (max - min) / (510 - max - min);
  }
  if (sat < 0.10) {
    if (lightness < 0.18) return 'black';
    if (lightness > 0.82) return 'white';
    return 'gray';
  }
  let hue = 0;
  const c = max - min;
  if (max === r) hue = ((g - b) / c) % 6;
  else if (max === g) hue = (b - r) / c + 2;
  else hue = (r - g) / c + 4;
  hue = (hue * 60 + 360) % 360;
  // Hue → name; tightly tuned to the existing theme accents.
  if (hue <  15) return 'red';
  if (hue <  30) return lightness > 0.65 ? 'peach' : 'orange';
  if (hue <  45) return lightness < 0.45 ? 'brown' : 'amber';
  if (hue <  65) return 'yellow';
  if (hue <  85) return 'lime';
  if (hue < 165) return 'green';
  if (hue < 185) return 'teal';
  if (hue < 205) return 'cyan';
  if (hue < 235) return 'blue';
  if (hue < 265) return 'indigo';
  if (hue < 295) return 'violet';
  if (hue < 325) return 'magenta';
  return 'pink';
}

// ---------- Backgrounds ----------
// Decoupled from themes — any theme palette/outline can be paired with any
// background scene. Built by lifting each theme's `bg` block plus a "solid"
// fallback that paints a flat fill with no spots / decor.
export const BACKGROUNDS = (() => {
  const out = {
    solid: { label: 'Solid color', kind: 'flat', base: '#0a0612', spotCount: 0, vignette: 0 },
  };
  for (const [k, t] of Object.entries(THEMES)) {
    if (t.bg) out[k] = Object.assign({ label: t.label }, t.bg);
  }
  return out;
})();

export function currentBackground() {
  return BACKGROUNDS[S.background] || BACKGROUNDS[S.interfaceColor] || BACKGROUNDS.solid;
}

// Layer stack the renderers iterate. If S.bgLayers is non-empty,
// each entry is a fully-formed bg blob plus { opacity, blend,
// enabled }. If empty, fall back to a single-layer stack derived
// from the legacy S.background preset key — preserves N=1 parity
// with the single-bg pipeline. See .claude/plan/10-bg-layer-stack.md.
export function currentBgLayers() {
  if (Array.isArray(S.bgLayers) && S.bgLayers.length > 0) {
    return S.bgLayers.filter(l => l.enabled !== false);
  }
  const bg = currentBackground();
  return [{ ...bg, opacity: 1, blend: 'normal', enabled: true }];
}

// Wrap a preset key into the single-layer bgLayers shape the
// renderers iterate. The multi-layer UI (plan #10 PR B) was
// reverted — the bg now selects exactly one shader at a time,
// but renderers still iterate currentBgLayers() so the array
// shape is preserved as a 1-element array.
let _bgLayerIdSeq = 1;
export function makeBgLayerId() {
  return 'l_' + Date.now().toString(36) + '_' + (_bgLayerIdSeq++);
}
export function bgLayerFromPreset(key) {
  const bg = BACKGROUNDS[key] || BACKGROUNDS.solid;
  return {
    id: makeBgLayerId(),
    opacity: 1,
    blend: 'normal',
    enabled: true,
    ...bg,
  };
}
export function bgLayersFromPreset(key) {
  return [bgLayerFromPreset(key)];
}

// ---------- Cell types ----------
export const DEFAULT_MOVE = {
  patrolSpeed: 50, attackSpeed: 110, patrolAccel: 90, alarmAccel: 240,
  weight: 1.0, friction: 1.0, hostility: 'idle',
};
export const ALARM_RADIUS = 240;

export const CELL_TYPES = {
  neutrophil: {
    label: 'Neutrophil', category: 'good', sizeMul: 1.00,
    body: { kind: 'lobed', aspect: 1.0 },
    nucleus: { kind: 'multilobed' },
    decoration: { kind: 'none' },
    granules: 28,
    splitFactor: 1.0, brownianMul: 1.0,
    move: { patrolSpeed: 60, attackSpeed: 150, patrolAccel: 110, alarmAccel: 320, weight: 1.0, friction: 0.9, hostility: 'attack' },
    field: { blur: 8,  contrast: 16, wobbleMul: 1.2 },
    colors: { cytoTop: '#ffd28a', cytoBot: '#e58a26', nucleus: '#5a2a05', nucleusHi: '#fff0c8', accent: '#9c4513' },
    description: 'First responder; engulfs bacteria via phagocytosis. The most abundant white blood cell.',
  },
  monocyte: {
    label: 'Monocyte', category: 'good', sizeMul: 1.10,
    body: { kind: 'rippled', aspect: 1.0 },
    nucleus: { kind: 'kidney' },
    decoration: { kind: 'none' },
    granules: 6,
    splitFactor: 1.0, brownianMul: 1.0,
    move: { patrolSpeed: 50, attackSpeed: 110, patrolAccel: 90,  alarmAccel: 230, weight: 1.0, friction: 1.0, hostility: 'attack' },
    field: { blur: 6,  contrast: 20, wobbleMul: 0.8 },
    colors: { cytoTop: '#cadcfb', cytoBot: '#6d8df0', nucleus: '#1d1c5a', nucleusHi: '#dee8ff', accent: '#2b4d8e' },
    description: 'Circulating sentinel that matures into macrophages or dendritic cells once it enters tissue.',
  },
  mast: {
    label: 'Mast cell', category: 'good', sizeMul: 1.15,
    body: { kind: 'oblong', aspect: 1.4 },
    nucleus: { kind: 'round' },
    decoration: { kind: 'none' },
    granules: 60,
    splitFactor: 1.2, brownianMul: 0.7,
    move: { patrolSpeed: 28, attackSpeed: 60,  patrolAccel: 50,  alarmAccel: 130, weight: 1.5, friction: 1.2, hostility: 'idle' },
    field: { blur: 5,  contrast: 22, wobbleMul: 0.5 },
    colors: { cytoTop: '#c9efd5', cytoBot: '#54a877', nucleus: '#0f4a2e', nucleusHi: '#e6fff0', accent: '#1f6b3f' },
    description: 'Tissue-resident sentinel; releases histamine to trigger inflammation and allergic responses.',
  },
  nk: {
    label: 'NK cell', category: 'good', sizeMul: 0.85,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'round' },
    decoration: { kind: 'bigSpikes' },
    granules: 8,
    splitFactor: 1.1, brownianMul: 1.1,
    move: { patrolSpeed: 70, attackSpeed: 170, patrolAccel: 140, alarmAccel: 360, weight: 0.9, friction: 0.85, hostility: 'attack' },
    field: { blur: 5,  contrast: 24, wobbleMul: 1.1 },
    colors: { cytoTop: '#cfd0f7', cytoBot: '#7172c6', nucleus: '#291b5e', nucleusHi: '#eaeaff', accent: '#3f3f8c' },
    description: 'Patrols for virus-infected and tumour cells; kills on contact without prior sensitisation.',
  },
  macrophage: {
    label: 'Macrophage', category: 'good', sizeMul: 1.45,
    body: { kind: 'pseudopod', aspect: 1.0 },
    nucleus: { kind: 'kidney' },
    decoration: { kind: 'none' },
    granules: 12,
    splitFactor: 1.4, brownianMul: 0.6,
    move: { patrolSpeed: 40, attackSpeed: 90,  patrolAccel: 70,  alarmAccel: 180, weight: 1.7, friction: 1.1, hostility: 'attack' },
    field: { blur: 10, contrast: 14, wobbleMul: 1.5 },
    colors: { cytoTop: '#fbc6de', cytoBot: '#d36699', nucleus: '#3a1029', nucleusHi: '#ffe0ee', accent: '#872a59' },
    description: '"Big eater" — long-lived phagocyte that engulfs pathogens and presents antigens to T cells.',
  },
  dendritic: {
    label: 'Dendritic cell', category: 'good', sizeMul: 1.25,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'round-small' },
    decoration: { kind: 'tendrils' },
    granules: 0,
    splitFactor: 1.3, brownianMul: 0.8,
    move: { patrolSpeed: 50, attackSpeed: 110, patrolAccel: 100, alarmAccel: 240, weight: 1.0, friction: 0.95, hostility: 'attack' },
    field: { blur: 8,  contrast: 18, wobbleMul: 0.9 },
    colors: { cytoTop: '#bcdcf6', cytoBot: '#4d8fcf', nucleus: '#102544', nucleusHi: '#dff0ff', accent: '#1d3d68' },
    description: 'Antigen-presenting courier; samples invaders and shows them to T cells in lymph nodes.',
  },
  basophil: {
    label: 'Basophil', category: 'good', sizeMul: 0.85,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'bilobed' },
    decoration: { kind: 'none' },
    granules: 22,
    splitFactor: 1.0, brownianMul: 1.0,
    move: { patrolSpeed: 45, attackSpeed: 95,  patrolAccel: 80,  alarmAccel: 200, weight: 1.0, friction: 1.0, hostility: 'idle' },
    field: { blur: 5,  contrast: 22, wobbleMul: 0.6 },
    colors: { cytoTop: '#fbcfdc', cytoBot: '#d97aa1', nucleus: '#410d2e', nucleusHi: '#ffe1ec', accent: '#4a0d31' },
    description: 'Circulating granulocyte; releases histamine and heparin to reinforce inflammation.',
  },
  platelet: {
    label: 'Platelet', category: 'good', sizeMul: 0.50,
    body: { kind: 'star', aspect: 1.0 },
    nucleus: { kind: 'none' },
    decoration: { kind: 'none' },
    granules: 4,
    splitFactor: 0.9, brownianMul: 1.6,
    move: { patrolSpeed: 80, attackSpeed: 190, patrolAccel: 160, alarmAccel: 400, weight: 0.6, friction: 0.85, hostility: 'idle' },
    field: { blur: 3,  contrast: 30, wobbleMul: 0.4 },
    colors: { cytoTop: '#ffe27c', cytoBot: '#d7a614', nucleus: '#4d2f02', nucleusHi: '#fff5c4', accent: '#8a5e0a' },
    description: 'Tiny cell fragment that clots blood at injuries and helps recruit immune cells.',
  },
  tcell: {
    label: 'T-cell', category: 'good', sizeMul: 0.75,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'round' },
    decoration: { kind: 'yReceptorsFew' },
    granules: 0,
    splitFactor: 1.2, brownianMul: 0.9,
    move: { patrolSpeed: 70, attackSpeed: 160, patrolAccel: 130, alarmAccel: 340, weight: 0.95, friction: 0.9, hostility: 'attack' },
    field: { blur: 4,  contrast: 26, wobbleMul: 0.5 },
    colors: { cytoTop: '#d6cdf8', cytoBot: '#8d7be0', nucleus: '#2a134d', nucleusHi: '#efeaff', accent: '#4d2c8c' },
    description: 'Adaptive killer / coordinator; recognises specific antigens and kills infected cells.',
  },
  bcell: {
    label: 'B-cell', category: 'good', sizeMul: 0.75,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'round' },
    decoration: { kind: 'yReceptorsMany' },
    granules: 0,
    splitFactor: 1.2, brownianMul: 0.9,
    move: { patrolSpeed: 55, attackSpeed: 120, patrolAccel: 100, alarmAccel: 260, weight: 1.0, friction: 1.0, hostility: 'attack' },
    field: { blur: 4,  contrast: 26, wobbleMul: 0.5 },
    colors: { cytoTop: '#fcc9cc', cytoBot: '#df8189', nucleus: '#4a1014', nucleusHi: '#ffe1e3', accent: '#8a323a' },
    description: 'Adaptive antibody factory; secretes antibodies tagged to specific pathogens.',
  },
  eosinophil: {
    label: 'Eosinophil', category: 'good', sizeMul: 0.95,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'bilobed' },
    decoration: { kind: 'none' },
    granules: 18,
    splitFactor: 1.0, brownianMul: 1.0,
    move: { patrolSpeed: 60, attackSpeed: 130, patrolAccel: 110, alarmAccel: 280, weight: 0.95, friction: 0.95, hostility: 'attack' },
    field: { blur: 5,  contrast: 22, wobbleMul: 0.6 },
    colors: { cytoTop: '#fcc8a3', cytoBot: '#e0855a', nucleus: '#4d1d09', nucleusHi: '#ffe2cd', accent: '#8c3d18' },
    description: 'Anti-parasite specialist; key in allergic responses, releases toxic granule contents.',
  },
  rbc: {
    // Real erythrocytes are biconcave, anucleate, and slightly elliptic
    // when seen face-on. body.kind:'oblong' + aspect:1.10 gives the
    // ellipse; nucleus.kind:'none' is biologically correct (mature RBCs
    // lack a nucleus); bodyHollow:true tells both renderers to darken
    // the cell's centre in the cytoplasm pass — gives the donut-hole
    // read characteristic of a fresh red blood cell viewed from above.
    label: 'Red Blood Cell', category: 'good', sizeMul: 0.55,
    body: { kind: 'oblong', aspect: 1.10 },
    nucleus: { kind: 'none' },
    bodyHollow: true,
    decoration: { kind: 'none' },
    granules: 0,
    splitFactor: 1.6, brownianMul: 0.9,
    move: { patrolSpeed: 35, attackSpeed: 65, patrolAccel: 55, alarmAccel: 80, weight: 0.7, friction: 1.0, hostility: 'idle' },
    field: { blur: 5, contrast: 22, wobbleMul: 0.35 },
    colors: { cytoTop: '#ff6b6b', cytoBot: '#a01818', nucleus: '#5a0a0a', nucleusHi: '#ffd2d2', accent: '#c43030' },
    description: 'Erythrocyte; biconcave disc full of haemoglobin that carries oxygen around the body.',
  },
  virus: {
    label: 'Virus', category: 'bad', subcategory: 'virus', sizeMul: 0.30,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'round-small' },
    decoration: { kind: 'spikesPulsing' },
    granules: 0,
    splitFactor: 1.0, brownianMul: 1.0,
    move: { patrolSpeed: 70, attackSpeed: 160, patrolAccel: 130, alarmAccel: 320, weight: 0.8, friction: 0.85, hostility: 'attack' },
    field: { blur: 5,  contrast: 24, wobbleMul: 0.5 },
    colors: { cytoTop: '#e9b8ff', cytoBot: '#9c2dbe', nucleus: '#3a0552', nucleusHi: '#ffd6f7', accent: '#ff3aaa' },
    description: 'Spike-protein invader; hijacks cells to replicate inside them.',
  },
  germ: {
    label: 'Germ', category: 'bad', subcategory: 'bacteria', sizeMul: 0.55,
    body: { kind: 'lobed', aspect: 1.0 },
    nucleus: { kind: 'round' },
    decoration: { kind: 'none' },
    granules: 14,
    splitFactor: 1.0, brownianMul: 1.0,
    move: { patrolSpeed: 45, attackSpeed: 100, patrolAccel: 80,  alarmAccel: 200, weight: 1.0, friction: 1.0, hostility: 'idle' },
    field: { blur: 7,  contrast: 18, wobbleMul: 1.0 },
    colors: { cytoTop: '#c4ec88', cytoBot: '#5fa030', nucleus: '#234008', nucleusHi: '#e5ffc8', accent: '#7ab53a' },
    description: 'Generic bumpy microbe — opportunistic infector.',
  },
  bacterium: {
    label: 'Bacterium', category: 'bad', subcategory: 'bacteria', sizeMul: 0.55,
    body: { kind: 'oblong', aspect: 1.8 },
    nucleus: { kind: 'round-small' },
    decoration: { kind: 'flagellum' },
    granules: 8,
    splitFactor: 0.9, brownianMul: 1.0,
    move: { patrolSpeed: 75, attackSpeed: 170, patrolAccel: 140, alarmAccel: 340, weight: 0.9, friction: 0.85, hostility: 'attack' },
    field: { blur: 5,  contrast: 22, wobbleMul: 0.7 },
    colors: { cytoTop: '#a8e6f5', cytoBot: '#3aa0c7', nucleus: '#06324a', nucleusHi: '#dff8ff', accent: '#0c5e85' },
    description: 'Rod-shaped bacterium swimming with a whipping flagellum.',
  },
  amoebaP: {
    label: 'Amoeba (✗)', category: 'bad', subcategory: 'parasite', sizeMul: 1.25,
    body: { kind: 'pseudopod', aspect: 1.0 },
    nucleus: { kind: 'kidney' },
    decoration: { kind: 'tentaclesWiggling' },
    granules: 6,
    splitFactor: 1.4, brownianMul: 0.6,
    move: { patrolSpeed: 35, attackSpeed: 75,  patrolAccel: 60,  alarmAccel: 150, weight: 1.6, friction: 1.1, hostility: 'attack' },
    field: { blur: 9,  contrast: 16, wobbleMul: 1.4 },
    colors: { cytoTop: '#dabaff', cytoBot: '#7e3df0', nucleus: '#260a4a', nucleusHi: '#f1d8ff', accent: '#a065ff' },
    description: 'Amoeboid parasite that crawls and engulfs tissue.',
  },
  slime: {
    label: 'Slime', category: 'bad', subcategory: 'fungus', sizeMul: 1.30,
    body: { kind: 'lobed', aspect: 1.0 },
    nucleus: { kind: 'none' },
    decoration: { kind: 'drips' },
    granules: 8,
    splitFactor: 1.5, brownianMul: 0.5,
    move: { patrolSpeed: 30, attackSpeed: 65,  patrolAccel: 50,  alarmAccel: 130, weight: 1.6, friction: 1.15, hostility: 'attack' },
    field: { blur: 9,  contrast: 16, wobbleMul: 1.3 },
    colors: { cytoTop: '#e4ff8d', cytoBot: '#7ab323', nucleus: '#1d3a05', nucleusHi: '#f6ffd0', accent: '#9fd83b' },
    description: 'Slimy biofilm globule; drips toxic ooze.',
  },
  mite: {
    label: 'Mite', category: 'bad', subcategory: 'parasite', sizeMul: 1.60,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'round' },
    decoration: { kind: 'legs' },
    granules: 4,
    splitFactor: 1.0, brownianMul: 1.4,
    move: { patrolSpeed: 90, attackSpeed: 200, patrolAccel: 180, alarmAccel: 420, weight: 0.7, friction: 0.85, hostility: 'attack' },
    field: { blur: 4,  contrast: 26, wobbleMul: 0.4 },
    colors: { cytoTop: '#ffd49a', cytoBot: '#cc6a14', nucleus: '#4a1c02', nucleusHi: '#ffe9c2', accent: '#8a3d05' },
    description: 'Tiny scuttling bug; lots of little legs.',
  },
  spore: {
    label: 'Spore', category: 'bad', subcategory: 'fungus', sizeMul: 0.55,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'round-small' },
    decoration: { kind: 'fuzz' },
    granules: 22,
    splitFactor: 1.2, brownianMul: 1.2,
    move: { patrolSpeed: 50, attackSpeed: 110, patrolAccel: 90,  alarmAccel: 220, weight: 0.9, friction: 0.95, hostility: 'idle' },
    field: { blur: 6,  contrast: 20, wobbleMul: 0.6 },
    colors: { cytoTop: '#fff097', cytoBot: '#caa221', nucleus: '#3d2900', nucleusHi: '#fff5c5', accent: '#aa7704' },
    description: 'Fungal spore — drifts on currents and seeds new growth.',
  },
  toxin: {
    label: 'Toxin', category: 'bad', subcategory: 'toxin', sizeMul: 0.25,
    body: { kind: 'star', aspect: 1.0 },
    nucleus: { kind: 'none' },
    decoration: { kind: 'none' },
    granules: 0,
    splitFactor: 0.7, brownianMul: 1.4,
    move: { patrolSpeed: 30, attackSpeed: 80,  patrolAccel: 60,  alarmAccel: 150, weight: 1.4, friction: 1.2, hostility: 'idle' },
    field: { blur: 3,  contrast: 30, wobbleMul: 0.3 },
    colors: { cytoTop: '#bdf3ff', cytoBot: '#ff5cb1', nucleus: '#3a0533', nucleusHi: '#fff', accent: '#3aa0c7' },
    description: 'Jagged toxin crystal that drifts and burns on contact.',
  },
  // Extended (non-game) cell — added to the game so the shader-test
  // kind 0 ("eukaryote · generic") has a host visual in the live
  // renderer. Gated by S.extendedCells (added in #189); the Add
  // dialog hides it unless the user opts in. Foes match its
  // shader-test grouping (anything that would attack a generic body
  // cell — viruses infect, bacteria/slime erode). Drift AI = no
  // pursuit, no attack — a passive specimen used for visual tests
  // + cell-zoo demos.
  // Colours come straight from shader-test cytoColor(0) = (0.78,
  // 0.55, 0.66) ≈ #c78ca8, a warm rosy-mauve. cytoTop/cytoBot
  // bracket that hue so the radial gradient on canvas2d still
  // reads cleanly.
  eukaryote: {
    label: 'Eukaryote', category: 'good', extended: true, sizeMul: 1.15,
    body: { kind: 'round', aspect: 1.0 },
    nucleus: { kind: 'round' },
    decoration: { kind: 'none' },
    granules: 8,
    splitFactor: 1.0, brownianMul: 1.0,
    move: { patrolSpeed: 30, attackSpeed: 30, patrolAccel: 60, alarmAccel: 60, weight: 1.0, friction: 1.1, hostility: 'idle' },
    field: { blur: 6, contrast: 18, wobbleMul: 0.6 },
    colors: { cytoTop: '#e6b8c8', cytoBot: '#a06b80', nucleus: '#4a2638', nucleusHi: '#f8dde6', accent: '#7a3e58' },
    description: 'Generic eukaryotic body cell — a passive specimen carried over from shader-test (kind 0) for visual-port tests. Phagocytes leave it alone; viruses, bacteria and slime moulds will erode it.',
  },
};

export function cellColors(cell) {
  return (cell && cell._colors)
    || (CELL_TYPES[cell && cell.type] || CELL_TYPES.neutrophil).colors;
}

export function pickRandomActiveType() {
  // Extended cells (eukaryote etc.) are NEVER picked by the random-
  // spawn fallback so they don't show up in normal Free-Game play.
  // They're surfaced only via the Add dialog when S.extendedCells is
  // on, or via the cell-zoo / URL-param visual-test flow.
  const list = (Array.isArray(S.activeTypes) && S.activeTypes.length)
    ? S.activeTypes.filter(k => CELL_TYPES[k] && !CELL_TYPES[k].extended)
    : Object.keys(CELL_TYPES).filter(k => !CELL_TYPES[k].extended);
  return list[Math.floor(Math.random() * list.length)] || 'neutrophil';
}

// Pre-bake fully-transparent cytoBot per type so the cytoplasm pass doesn't
// run hexToRgba(cc.cytoBot, 0) every frame for every cell.
for (const k of Object.keys(CELL_TYPES)) {
  const c = CELL_TYPES[k].colors;
  c.cytoBotTransp = hexToRgbaUncached(c.cytoBot, 0);
}

export const PATHOGEN_GROUPS = [
  { key: 'virus',    label: 'Viruses',   icon: '🦠', members: ['virus'] },
  { key: 'bacteria', label: 'Bacteria',  icon: '🧫', members: ['germ', 'bacterium'] },
  { key: 'parasite', label: 'Parasites', icon: '🪱', members: ['amoebaP', 'mite'] },
  { key: 'fungus',   label: 'Fungi',     icon: '🍄', members: ['slime', 'spore'] },
  { key: 'toxin',    label: 'Toxins',    icon: '☠️',  members: ['toxin'] },
];

// ---------- Constants ----------
export const SPLIT_DURATION = 0.9;   // 2× faster than the original 1.8 s
export const BOND_DURATION = 2.0;
export const CELL_RADIUS = 52;
export const NUCLEUS_RATIO = 0.30;
export const BROWNIAN = 18;
export const REPULSION = 180;
export const MARGIN = 80;
export const MARGIN_SPRING = 5;
export const DOWNSAMPLE = 0.5;
export const WOBBLE_VERTS = 32;
export const MIN_SCALE = 0.125;     // 2× more zoom-out range vs. the original 0.25
export const MAX_SCALE = 4;
export const DRAG_THRESHOLD = 6;
export const HASH_CELL = 120;

// Pre-computed vertex angles for the polygon body (32 verts + closing point).
export const THETA_TABLE = (() => {
  const t = new Float32Array(WOBBLE_VERTS + 1);
  for (let i = 0; i <= WOBBLE_VERTS; i++) t[i] = (i / WOBBLE_VERTS) * Math.PI * 2;
  return t;
})();

// Cartoon face configuration per cell type. The shape determines eye / pupil
// sizes (as a fraction of cell.r), eye Y offset, and which mouth style to draw.
export const FACE = {
  default:    { eyes: 2, eyeR: 0.18, eyeY: -0.10, pupilR: 0.07, mouth: 'smile' },
  macrophage: { eyes: 2, eyeR: 0.18, eyeY: -0.06, pupilR: 0.07, mouth: 'smile' },
  nk:         { eyes: 2, eyeR: 0.16, eyeY: -0.10, pupilR: 0.06, mouth: 'snarl' },
  mast:       { eyes: 2, eyeR: 0.14, eyeY: -0.08, pupilR: 0.05, mouth: 'smile' },
  platelet:   { eyes: 1, eyeR: 0.20, eyeY: -0.06, pupilR: 0.09, mouth: 'smile' },
  virus:      { eyes: 2, eyeR: 0.16, eyeY: -0.12, pupilR: 0.06, mouth: 'fangs' },
  germ:       { eyes: 2, eyeR: 0.16, eyeY: -0.10, pupilR: 0.06, mouth: 'snarl' },
  bacterium:  { eyes: 1, eyeR: 0.18, eyeY: -0.06, pupilR: 0.07, mouth: 'tongue' },
  amoebaP:    { eyes: 2, eyeR: 0.15, eyeY: -0.06, pupilR: 0.06, mouth: 'fangs' },
  slime:      { eyes: 2, eyeR: 0.18, eyeY: -0.04, pupilR: 0.07, mouth: 'drool' },
  mite:       { eyes: 2, eyeR: 0.13, eyeY: -0.10, pupilR: 0.05, mouth: 'snarl' },
  spore:      { eyes: 1, eyeR: 0.20, eyeY: -0.06, pupilR: 0.08, mouth: 'frown' },
  toxin:      { eyes: 0,                                          mouth: 'none' },
};

// ---------- Tiny colour helpers (kept here so CELL_TYPES init can use them) ----------
const HEX_RGBA_CACHE = new Map();
function hexToRgbaUncached(hex, alpha) {
  let h = (hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
export function hexToRgba(hex, alpha) {
  const key = hex + '|' + alpha;
  let v = HEX_RGBA_CACHE.get(key);
  if (v == null) { v = hexToRgbaUncached(hex, alpha); HEX_RGBA_CACHE.set(key, v); }
  return v;
}

export function frac(v) { return v - Math.floor(v); }
