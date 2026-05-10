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

export const DEFAULTS = {
  splitMode: 'bondDrift',
  autoSplitSeconds: 10,
  maxCells: 1024,           // hard cap (UI slider removed late 2026; was 32)
  bgFlowSpeed: 0.55,
  outlinePx: 5,
  showDebugField: false,
  // Visual style for the cell rendering itself. Was the lone "theme"
  // setting until late 2026; renamed when the colour palette below was
  // introduced as a separate "Interface color" setting.
  theme: 'legacy',
  // Colour palette tinting outlines + UI panel accent (was DEFAULTS.theme).
  // Renamed to interfaceColor to free up "theme" for the cell-shader theme.
  interfaceColor: 'pink',
  activeTypes: ALL_CELL_KEYS.slice(),
  splitOnTap: false,
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
  pinchRotation: false,     // two-finger twist rotates the camera. Off by default — most users find it surprising. When off, sim.camera.rotation stays at 0 and the gesture only pinch-zooms + pans.
  showFPS: false,
  showRenderer: false,      // append actual renderer info to the FPS line
  showBuildInfo: false,     // top-left build stamp (branch · sha · #run · time)
  friction: 0.80,
  bounce: 0.6,
  throwStrength: 0.35,
  wobbleAmp: 0.13,
  speedMul: 1.0,
  cartoon: false,
  lang: 'en',                               // 'en' | 'de' | 'es' | 'bar' | 'latin'
  allowBadGuys: true,
  cellSizeMul: 1.0,
  membraneIntensity: 0.9,
  cellBorderThickness: 2.5,    // multiplier on the disk-shader outline band; webgl2 / webgpu only
  background: 'solid',
  renderScale: 1.0,
  upscaleMode: 'blur',
  scanlinesAlpha: 0.08,     // 0..1 strength of the CRT scanlines overlay; 0 = off (replaces the old scanlines: bool toggle)
  useHighlight: true,                       // selection ring uses theme accent when on
  // Audio. Music ON by default — user wants the game to greet the
  // player with music. The first play() call is autoplay-blocked
  // until the user has interacted; music.js retries on the very
  // first pointerdown so the track starts the moment the player
  // touches anything. Volumes are 0..1 floats.
  musicEnabled: true,
  musicVolume: 0.5,
  sfxVolume: 0.7,
  renderer: 'webgpu',       // 'canvas2d' | 'webgl2' | 'webgpu'
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
const KNOWN_THEME_KEYS = [
  'legacy', 'microscope', 'cartoon', 'kurzgesagt', 'classic',
];

// Background scene-render keys — entries in the THEMES table that
// drive the bg shader. Used by both S.background validation and by
// the legacy interface-colour migration (any saved interfaceColor
// that's a bg key gets re-pointed to a sensible accent below).
const KNOWN_BACKGROUND_KEYS = [
  'bloodstream', 'bloodflow', 'cellShadow',
  'cartoonNight', 'spectrum', 'lymphNode',
  'lung', 'lavaFire', 'reactor',
  'boneMarrow', 'mitochondria', 'neuron', 'bile',
];

// Map old THEMES keys → new accent keys for the interfaceColor
// migration (when a saved settings blob still references the
// old conflated table).
const LEGACY_INTERFACE_COLOR_MIGRATION = {
  bloodstream: 'red',  bloodflow: 'red',     cellShadow: 'red',
  cartoonNight: 'cyan', spectrum: 'violet',  lymphNode: 'violet',
  lung: 'pink',         lavaFire: 'amber',   reactor: 'green',
  boneMarrow: 'amber',  mitochondria: 'amber',
  neuron: 'cyan',       bile: 'green',
  // Removed scenes — fold to a sensible accent.
  dracula: 'violet',
  // Removed scene keys (aurora / underwater) also map sensibly:
  aurora: 'green',      underwater: 'cyan',
};

const VALID_RENDER_SCALES = [1, 0.5, 0.25, 0.125];

// Currently only 'free' is wired. 'campaign' and 'survival' are
// reserved for future modes (see docs/ch04-konzept.md §4.3); the
// settings dropdown shows them as disabled "(soon)" entries.
const KNOWN_GAME_MODES = ['free'];

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
    const validMetaRtModes = ['bbox', 'fullCanvas', 'sharedMax'];
    if (!validMetaRtModes.includes(parsed.metaRtMode)) parsed.metaRtMode = DEFAULTS.metaRtMode;
    const validMetaOutlineModes = ['edge', 'sdf', 'polygon'];
    if (!validMetaOutlineModes.includes(parsed.metaOutlineMode)) parsed.metaOutlineMode = DEFAULTS.metaOutlineMode;
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
    settings_title: 'Settings',
    bg_solid: 'Solid color',
    bg_bloodstream: 'Bloodstream (crimson)',
    bg_bloodflow: 'Bloodflow (vermilion)',
    bg_cellShadow: 'Cell Shadow (red)',
    bg_cartoonNight: 'Cosmic Soup (navy)',
    bg_spectrum: 'Spectrum (rainbow)',
    bg_lymphNode: 'Lymph Node (violet)',
    bg_lung: 'Lung (smoke)',
    bg_lavaFire: 'Magma (orange)',
    bg_reactor: 'Reactor (acid green)',
    bg_boneMarrow: 'Bone Marrow (cream)',
    bg_mitochondria: 'Mitochondria (amber)',
    bg_neuron: 'Neuron (electric blue)',
    bg_bile: 'Bile (chartreuse)',
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
    cell_type_overlay: 'Show cell types',
    counters_needed: 'Counters needed',
    counters_covered: 'Fully covered',
    no_pathogens: 'No pathogens',
    audio: 'Audio',
    music_enabled: 'Music',
    music_volume: 'Music volume',
    sfx_volume: 'Sound effects volume',
    next_track: 'Next track',
    random_split: 'Random splitting', meta_split: 'Metaball split',
    meta_rt_mode: 'Metaball RT mode',
    meta_rt_bbox: 'Per-pair bbox (default)',
    meta_rt_full: 'Full-canvas pool',
    meta_rt_shared: 'Shared (largest pair)',
    auto_split: 'Auto-split (s)',
    friction: 'Friction', bounce: 'Bounce', throw_strength: 'Throw strength',
    wobble: 'Wobble', bg_flow: 'Background flow', outline_px: 'Outline px',
    membrane: 'Membrane', cell_size: 'Cell size', use_highlight: 'Use highlight colour',
    mode_target: 'Target mode', mode_target_tip: 'Tap to select / send selected cells',
    mode_split: 'Split mode', mode_split_tip: 'Tap a cell to split it',
    mode_kill: 'Kill mode', mode_kill_tip: 'Tap a cell to make it explode',
    cartoon_mode: 'Cartoon mode (faces)', show_fps: 'Show FPS', show_renderer: 'Show renderer', show_build_info: 'Show build info',
    show_field: 'Show metaball field', render_scale: 'Render scale',
    upscale: 'Upscale', scanlines: 'Scanlines (CRT)',
    renderer_engine: 'Renderer',
    renderer_canvas: 'Canvas2D',
    renderer_webgl: 'WebGL2',
    renderer_webgpu: 'WebGPU',
    reset_sim: 'Reset simulation',
    about: 'About', about_credits: 'Credits', about_licences: 'Third-party licences', about_licences_note: 'Three shader assets carry the Shadertoy default CC BY-NC-SA 3.0 licence (NonCommercial + ShareAlike). They would need replacing if this project ships under a permissive licence.', about_permissive: 'Permissive ports', about_desc: 'A 2D microbe sim — phagocytes, lymphocytes, and the pathogens they hunt.',
    help_title: 'Cells of the immune system',
    add_cell: 'Add a cell', add_pathogen: 'Add a pathogen',
    add_title: 'Add', add_tab_cells: 'Cells', add_tab_pathogens: 'Pathogens', add_tab_theme: 'Theme',
    spawn_banner_friends: 'Allies', spawn_banner_prey: 'Prey', spawn_banner_foes: 'Foes', spawn_banner_close: 'Got it',
    palette_to_help: 'Learn what each cell does →',
    palette_bad_to_help: 'Learn what each pathogen does →',
    debug_log: 'Debug log', clear: 'Clear', copy: 'Copy',
    pause: 'Pause', paused: 'PAUSE',
    paused_hint: 'Tap space or anywhere to continue',
    nav_settings: 'Settings', nav_help: 'Help', nav_add_cell: 'Add a cell',
    nav_add_pathogen: 'Add a pathogen', nav_reload: 'Hard reload',
    adding: 'Adding: {name}',
    fps_line: '{fps} fps · cells {n}',
    help_group_good: 'Good (Immune system)',
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
  de: {
    settings_title: 'Einstellungen',
    bg_solid: 'Volltonfarbe',
    bg_bloodstream: 'Blutstrom (Karmin)',
    bg_bloodflow: 'Blutfluss (Zinnober)',
    bg_cellShadow: 'Zellschatten (Rot)',
    bg_cartoonNight: 'Kosmische Suppe (Nachtblau)',
    bg_spectrum: 'Spektrum (Regenbogen)',
    bg_lymphNode: 'Lymphknoten (Violett)',
    bg_lung: 'Lunge (Rauch)',
    bg_lavaFire: 'Magma (Orange)',
    bg_reactor: 'Reaktor (Säuregrün)',
    bg_boneMarrow: 'Knochenmark (Creme)',
    bg_mitochondria: 'Mitochondrium (Bernstein)',
    bg_neuron: 'Neuron (Elektroblau)',
    bg_bile: 'Galle (Chartreuse)',
    ic_pink: 'Rosa', ic_red: 'Rot', ic_amber: 'Bernstein', ic_yellow: 'Gelb',
    ic_green: 'Grün', ic_cyan: 'Cyan', ic_blue: 'Blau', ic_violet: 'Violett', ic_mono: 'Mono',
    theme: 'Thema', interface_color: 'Schnittstellenfarbe', background: 'Hintergrund', gameplay: 'Spiel',
    theme_legacy: 'Legacy (Standard)', theme_microscope: 'Mikroskop',
    theme_cartoon: 'Cartoon', theme_kurzgesagt: 'Kurzgesagt', theme_classic: 'Klassisch',
    splitting: 'Teilung', population: 'Population',
    physics: 'Physik', look: 'Aussehen',
    performance: 'Leistung', language: 'Sprache',
    allow_pathogens: 'Krankheitserreger erlauben',
    pinch_rotation: 'Zwei-Finger-Drehung',
    fullscreen: 'Vollbild',
    shader_test_link: 'Shader-Test',
    game_mode: 'Spielmodus',
    mode_free: 'Free Game',
    mode_campaign_soon: 'Kampagne (bald)',
    mode_survival_soon: 'Survival (bald)',
    composition_hud: 'Aufstellungs-HUD',
    caustics_overlay: 'Lichtspiel-Overlay',
    liquid_ripples: 'Flüssigkeitswellen',
    cell_type_overlay: 'Zelltypen anzeigen',
    counters_needed: 'Konter benötigt',
    counters_covered: 'Voll abgedeckt',
    no_pathogens: 'Keine Erreger',
    audio: 'Audio',
    music_enabled: 'Musik',
    music_volume: 'Musiklautstärke',
    sfx_volume: 'Effektlautstärke',
    next_track: 'Nächster Titel',
    random_split: 'Zufällige Teilung', meta_split: 'Metaball-Teilung',
    auto_split: 'Auto-Teilung (s)',
    friction: 'Reibung', bounce: 'Sprungkraft', throw_strength: 'Wurfkraft',
    wobble: 'Wackeln', bg_flow: 'Hintergrundfluss', outline_px: 'Umrandung px',
    membrane: 'Membran', cell_size: 'Zellgröße', use_highlight: 'Akzentfarbe verwenden',
    mode_target: 'Zielmodus', mode_target_tip: 'Antippen: auswählen / Ziel setzen',
    mode_split: 'Teilungsmodus', mode_split_tip: 'Antippen teilt die Zelle',
    mode_kill: 'Tötungsmodus', mode_kill_tip: 'Zelle antippen, sie zerplatzt',
    cartoon_mode: 'Cartoon-Modus (Gesichter)', show_fps: 'FPS anzeigen', show_renderer: 'Renderer anzeigen', show_build_info: 'Build-Info anzeigen',
    show_field: 'Metaball-Feld zeigen', render_scale: 'Renderskala',
    upscale: 'Hochskalieren', scanlines: 'Scanlines (CRT)',
    renderer_engine: 'Renderer',
    renderer_canvas: 'Canvas2D',
    renderer_webgl: 'WebGL2',
    renderer_webgpu: 'WebGPU',
    reset_sim: 'Simulation zurücksetzen',
    about: 'Über', about_credits: 'Mitwirkende', about_licences: 'Drittanbieter-Lizenzen', about_licences_note: 'Drei Shader-Assets stehen unter der Shadertoy-Standardlizenz CC BY-NC-SA 3.0 (NichtKommerziell + ShareAlike). Müssten ersetzt werden, falls das Projekt jemals unter eine permissive Lizenz gestellt wird.', about_permissive: 'Permissive Portierungen', about_desc: 'Eine 2D-Mikroben-Simulation — Phagozyten, Lymphozyten und die Erreger, die sie jagen.',
    help_title: 'Zellen des Immunsystems',
    add_cell: 'Zelle hinzufügen', add_pathogen: 'Erreger hinzufügen',
    add_title: 'Hinzufügen', add_tab_cells: 'Zellen', add_tab_pathogens: 'Erreger', add_tab_theme: 'Thema',
    spawn_banner_friends: 'Verbündete', spawn_banner_prey: 'Beute', spawn_banner_foes: 'Feinde', spawn_banner_close: 'Verstanden',
    palette_to_help: 'Was macht jede Zelle? →',
    palette_bad_to_help: 'Was macht jeder Erreger? →',
    debug_log: 'Debug-Log', clear: 'Leeren', copy: 'Kopieren',
    pause: 'Pause', paused: 'PAUSE',
    paused_hint: 'Leertaste oder Bildschirm zum Fortsetzen',
    nav_settings: 'Einstellungen', nav_help: 'Hilfe', nav_add_cell: 'Zelle hinzufügen',
    nav_add_pathogen: 'Erreger hinzufügen', nav_reload: 'Neu laden',
    adding: 'Hinzufügen: {name}',
    fps_line: '{fps} fps · Zellen {n}',
    help_group_good: 'Gut (Immunsystem)',
    blend_none: 'Keine', blend_overlay: 'Overlay (Standard)', blend_multiply: 'Multiplizieren',
    blend_darken: 'Abdunkeln', blend_lighter: 'Heller', blend_screen: 'Aufhellen',
    blend_softlight: 'Weiches Licht', blend_hardlight: 'Hartes Licht',
    blend_burn: 'Nachbelichten', blend_dodge: 'Abwedeln',
    upscale_blur: 'Weichzeichnen', upscale_pixel: 'Pixel (knackig)',
    pgroup_virus: 'Viren', pgroup_bacteria: 'Bakterien',
    pgroup_parasite: 'Parasiten', pgroup_fungus: 'Pilze', pgroup_toxin: 'Toxine',
    cell_neutrophil_label: 'Neutrophil',
    cell_neutrophil_desc: 'Erste Verteidigung; verschlingt Bakterien per Phagozytose. Häufigste weiße Blutzelle.',
    cell_monocyte_label: 'Monozyt',
    cell_monocyte_desc: 'Wachposten im Blut; reift im Gewebe zu Makrophagen oder dendritischen Zellen.',
    cell_mast_label: 'Mastzelle',
    cell_mast_desc: 'Gewebewächter; setzt Histamin frei und löst Entzündung und Allergie aus.',
    cell_nk_label: 'Natürliche Killerzelle',
    cell_nk_desc: 'Patrouilliert nach virusinfizierten und Tumorzellen; tötet bei Kontakt ohne Vorprägung.',
    cell_macrophage_label: 'Makrophage',
    cell_macrophage_desc: '"Großfresser" — langlebiger Phagozyt; verdaut Erreger und präsentiert Antigene den T-Zellen.',
    cell_dendritic_label: 'Dendritische Zelle',
    cell_dendritic_desc: 'Antigen-präsentierender Kurier; bringt Erregerproben zu den T-Zellen in den Lymphknoten.',
    cell_basophil_label: 'Basophiler Granulozyt',
    cell_basophil_desc: 'Kreisender Granulozyt; setzt Histamin und Heparin frei und verstärkt Entzündung.',
    cell_platelet_label: 'Blutplättchen',
    cell_platelet_desc: 'Winziges Zellfragment; gerinnt Blut an Wunden und hilft, Immunzellen zu rekrutieren.',
    cell_tcell_label: 'T-Zelle',
    cell_tcell_desc: 'Adaptiver Killer/Koordinator; erkennt spezifische Antigene und tötet infizierte Zellen.',
    cell_bcell_label: 'B-Zelle',
    cell_bcell_desc: 'Adaptive Antikörperfabrik; produziert Antikörper passend zu jedem Erreger.',
    cell_eosinophil_label: 'Eosinophiler Granulozyt',
    cell_eosinophil_desc: 'Spezialist gegen Parasiten; wichtig bei Allergien, setzt giftige Granulen frei.',
    cell_rbc_label: 'Rote Blutzelle',
    cell_rbc_desc: 'Erythrozyt; bikonkave Scheibe voller Hämoglobin — transportiert Sauerstoff durch den Körper.',
    cell_virus_label: 'Virus',
    cell_virus_desc: 'Spike-Eindringling; kapert Zellen, um sich darin zu vermehren.',
    cell_germ_label: 'Keim',
    cell_germ_desc: 'Allgemeine knubbelige Mikrobe — opportunistischer Erreger.',
    cell_bacterium_label: 'Bakterium',
    cell_bacterium_desc: 'Stäbchenbakterium, schwimmt mit peitschendem Flagellum.',
    cell_amoebaP_label: 'Amöbe (Parasit)',
    cell_amoebaP_desc: 'Amöboider Parasit; kriecht und verschlingt Gewebe.',
    cell_slime_label: 'Schleim',
    cell_slime_desc: 'Schleimige Biofilm-Kugel; tropft giftige Brühe.',
    cell_mite_label: 'Milbe',
    cell_mite_desc: 'Winziger Krabbler; viele kleine Beine.',
    cell_spore_label: 'Spore',
    cell_spore_desc: 'Pilzspore — treibt mit der Strömung und sät neues Wachstum.',
    cell_toxin_label: 'Toxin',
    cell_toxin_desc: 'Zackiger Giftkristall; treibt umher und verbrennt bei Kontakt.',
  },
  es: {
    settings_title: 'Ajustes',
    bg_solid: 'Color sólido',
    bg_bloodstream: 'Torrente sanguíneo (carmesí)',
    bg_bloodflow: 'Flujo sanguíneo (bermellón)',
    bg_cellShadow: 'Sombra celular (rojo)',
    bg_cartoonNight: 'Sopa cósmica (azul noche)',
    bg_spectrum: 'Espectro (arcoíris)',
    bg_lymphNode: 'Ganglio linfático (violeta)',
    bg_lung: 'Pulmón (humo)',
    bg_lavaFire: 'Magma (naranja)',
    bg_reactor: 'Reactor (verde ácido)',
    bg_boneMarrow: 'Médula ósea (crema)',
    bg_mitochondria: 'Mitocondria (ámbar)',
    bg_neuron: 'Neurona (azul eléctrico)',
    bg_bile: 'Bilis (chartreuse)',
    ic_pink: 'Rosa', ic_red: 'Rojo', ic_amber: 'Ámbar', ic_yellow: 'Amarillo',
    ic_green: 'Verde', ic_cyan: 'Cian', ic_blue: 'Azul', ic_violet: 'Violeta', ic_mono: 'Mono',
    theme: 'Tema', interface_color: 'Color de interfaz', background: 'Fondo', gameplay: 'Juego',
    theme_legacy: 'Legacy (predeterminado)', theme_microscope: 'Microscopio',
    theme_cartoon: 'Cartoon', theme_kurzgesagt: 'Kurzgesagt', theme_classic: 'Clásico',
    splitting: 'División', population: 'Población',
    physics: 'Física', look: 'Estilo',
    performance: 'Rendimiento', language: 'Idioma',
    allow_pathogens: 'Permitir patógenos',
    pinch_rotation: 'Rotación con dos dedos',
    fullscreen: 'Pantalla completa',
    shader_test_link: 'Prueba de shader',
    game_mode: 'Modo de juego',
    mode_free: 'Juego libre',
    mode_campaign_soon: 'Campaña (pronto)',
    mode_survival_soon: 'Supervivencia (pronto)',
    composition_hud: 'HUD de composición',
    caustics_overlay: 'Cáusticas (luz)',
    liquid_ripples: 'Ondas líquidas',
    cell_type_overlay: 'Mostrar tipos de célula',
    counters_needed: 'Contras necesarios',
    counters_covered: 'Cubierto',
    no_pathogens: 'Sin patógenos',
    audio: 'Audio',
    music_enabled: 'Música',
    music_volume: 'Volumen de música',
    sfx_volume: 'Volumen de efectos',
    next_track: 'Pista siguiente',
    random_split: 'División aleatoria', meta_split: 'División metaball',
    auto_split: 'Auto-división (s)',
    friction: 'Fricción', bounce: 'Rebote', throw_strength: 'Fuerza de lanzamiento',
    wobble: 'Oscilación', bg_flow: 'Flujo de fondo', outline_px: 'Contorno px',
    membrane: 'Membrana', cell_size: 'Tamaño de célula', use_highlight: 'Usar color de resalte',
    mode_target: 'Modo objetivo', mode_target_tip: 'Toca para seleccionar / enviar',
    mode_split: 'Modo división', mode_split_tip: 'Toca una célula para dividirla',
    mode_kill: 'Modo matar', mode_kill_tip: 'Toca una célula para que explote',
    cartoon_mode: 'Modo dibujo (caras)', show_fps: 'Mostrar FPS', show_renderer: 'Mostrar renderer', show_build_info: 'Mostrar info de build',
    show_field: 'Mostrar campo metaball', render_scale: 'Escala de render',
    upscale: 'Reescalar', scanlines: 'Líneas de barrido (CRT)',
    renderer_engine: 'Motor de render',
    renderer_canvas: 'Canvas2D',
    renderer_webgl: 'WebGL2',
    renderer_webgpu: 'WebGPU',
    reset_sim: 'Reiniciar simulación',
    about: 'Acerca de', about_credits: 'Créditos', about_licences: 'Licencias de terceros', about_licences_note: 'Tres recursos de shader llevan la licencia Shadertoy CC BY-NC-SA 3.0.', about_permissive: 'Portes permisivos', about_desc: 'Simulación 2D de microbios.',
    help_title: 'Células del sistema inmunitario',
    add_cell: 'Añadir célula', add_pathogen: 'Añadir patógeno',
    add_title: 'Añadir', add_tab_cells: 'Células', add_tab_pathogens: 'Patógenos', add_tab_theme: 'Tema',
    spawn_banner_friends: 'Aliados', spawn_banner_prey: 'Presa', spawn_banner_foes: 'Enemigos', spawn_banner_close: 'Vale',
    palette_to_help: 'Aprende qué hace cada célula →',
    palette_bad_to_help: 'Aprende qué hace cada patógeno →',
    debug_log: 'Registro de depuración', clear: 'Limpiar', copy: 'Copiar',
    pause: 'Pausa', paused: 'PAUSA',
    paused_hint: 'Pulsa espacio o la pantalla para continuar',
    nav_settings: 'Ajustes', nav_help: 'Ayuda', nav_add_cell: 'Añadir célula',
    nav_add_pathogen: 'Añadir patógeno', nav_reload: 'Recargar',
    adding: 'Añadiendo: {name}',
    fps_line: '{fps} fps · células {n}',
    help_group_good: 'Buenas (sistema inmunitario)',
    blend_none: 'Ninguno', blend_overlay: 'Superponer (predet.)', blend_multiply: 'Multiplicar',
    blend_darken: 'Oscurecer', blend_lighter: 'Sumar (más claro)', blend_screen: 'Trama',
    blend_softlight: 'Luz suave', blend_hardlight: 'Luz fuerte',
    blend_burn: 'Subexponer color', blend_dodge: 'Sobreexponer color',
    upscale_blur: 'Difuminado', upscale_pixel: 'Píxel (nítido)',
    pgroup_virus: 'Virus', pgroup_bacteria: 'Bacterias',
    pgroup_parasite: 'Parásitos', pgroup_fungus: 'Hongos', pgroup_toxin: 'Toxinas',
    cell_neutrophil_label: 'Neutrófilo',
    cell_neutrophil_desc: 'Primera respuesta; engulle bacterias por fagocitosis. La célula blanca más abundante.',
    cell_monocyte_label: 'Monocito',
    cell_monocyte_desc: 'Centinela en sangre; madura en macrófagos o células dendríticas al entrar en tejido.',
    cell_mast_label: 'Mastocito',
    cell_mast_desc: 'Centinela en tejidos; libera histamina para inflamación y respuestas alérgicas.',
    cell_nk_label: 'Asesina natural',
    cell_nk_desc: 'Patrulla células infectadas por virus y tumorales; mata por contacto sin sensibilización previa.',
    cell_macrophage_label: 'Macrófago',
    cell_macrophage_desc: '"Gran comedor" — fagocito longevo; engulle patógenos y presenta antígenos a las células T.',
    cell_dendritic_label: 'Célula dendrítica',
    cell_dendritic_desc: 'Mensajera presentadora de antígenos; muestra invasores a células T en ganglios linfáticos.',
    cell_basophil_label: 'Basófilo',
    cell_basophil_desc: 'Granulocito circulante; libera histamina y heparina para reforzar la inflamación.',
    cell_platelet_label: 'Plaqueta',
    cell_platelet_desc: 'Fragmento celular diminuto; coagula sangre y ayuda a reclutar células inmunitarias.',
    cell_tcell_label: 'Linfocito T',
    cell_tcell_desc: 'Asesino/coordinador adaptativo; reconoce antígenos específicos y mata células infectadas.',
    cell_bcell_label: 'Linfocito B',
    cell_bcell_desc: 'Fábrica adaptativa de anticuerpos; secreta anticuerpos para patógenos específicos.',
    cell_eosinophil_label: 'Eosinófilo',
    cell_eosinophil_desc: 'Especialista anti-parásitos; clave en alergias, libera gránulos tóxicos.',
    cell_rbc_label: 'Glóbulo rojo',
    cell_rbc_desc: 'Eritrocito; disco bicóncavo lleno de hemoglobina que transporta oxígeno por el cuerpo.',
    cell_virus_label: 'Virus',
    cell_virus_desc: 'Invasor de espícula; secuestra células para replicarse en su interior.',
    cell_germ_label: 'Germen',
    cell_germ_desc: 'Microbio rugoso genérico — infector oportunista.',
    cell_bacterium_label: 'Bacteria',
    cell_bacterium_desc: 'Bacteria con forma de bastón que nada con un flagelo en látigo.',
    cell_amoebaP_label: 'Ameba (parásito)',
    cell_amoebaP_desc: 'Parásito ameboide que repta y engulle tejido.',
    cell_slime_label: 'Limo',
    cell_slime_desc: 'Glóbulo de biofilm viscoso; gotea baba tóxica.',
    cell_mite_label: 'Ácaro',
    cell_mite_desc: 'Bicho minúsculo y rápido; muchas patitas.',
    cell_spore_label: 'Espora',
    cell_spore_desc: 'Espora fúngica — flota con las corrientes y siembra nuevo crecimiento.',
    cell_toxin_label: 'Toxina',
    cell_toxin_desc: 'Cristal tóxico dentado; deriva y quema al contacto.',
  },
  bar: {
    // Bayrisch / Boarisch — translated from the German entries.
    settings_title: 'Eistellunga',
    bg_solid: 'Voitofarb',
    bg_bloodstream: 'Bluadströhmung (Karmin)',
    bg_bloodflow: 'Bluadfluss (Zinnoba)',
    bg_cellShadow: 'Zellnschattn (Rot)',
    bg_cartoonNight: 'Kosmische Suppm (Nachtbloh)',
    bg_spectrum: 'Spektrum (Regnbogn)',
    bg_lymphNode: 'Lymphknotn (Violett)',
    bg_lung: 'Lunga (Rauch)',
    bg_lavaFire: 'Magma (Orange)',
    bg_reactor: 'Reakta (Saurgrea)',
    bg_boneMarrow: 'Knochnmark (Creme)',
    bg_mitochondria: 'Mitochondrium (Bernstoaa)',
    bg_neuron: 'Neuron (Elektrobloh)',
    bg_bile: 'Goi (Chartreuse)',
    ic_pink: 'Rosa', ic_red: 'Rot', ic_amber: 'Bernstoaa', ic_yellow: 'Goib',
    ic_green: 'Grea', ic_cyan: 'Zyan', ic_blue: 'Bloh', ic_violet: 'Violett', ic_mono: 'Mono',
    theme: 'Thema', interface_color: 'Schnittstelln-Farb', background: 'Hintagrund', gameplay: 'Spui',
    theme_legacy: 'Legacy (Standard)', theme_microscope: 'Mikroskop',
    theme_cartoon: 'Cartoon', theme_kurzgesagt: 'Kurzgesagt', theme_classic: 'Klassisch',
    splitting: 'Teilung', population: 'Population',
    physics: 'Physik', look: 'Ausschaung',
    performance: 'Leistung', language: 'Sproch',
    allow_pathogens: 'Bazilln daloum',
    pinch_rotation: 'Mit zwoa Finga drahn',
    fullscreen: 'Vuibüd',
    shader_test_link: 'Shoda-Test',
    game_mode: 'Spuimodus',
    mode_free: 'Frei spuin',
    mode_campaign_soon: 'Kampagne (boid)',
    mode_survival_soon: 'Survival (boid)',
    composition_hud: 'Aufstöing-HUD',
    caustics_overlay: 'Liachtgflimm',
    liquid_ripples: 'Flüssigkeitswelln',
    cell_type_overlay: 'Zoidnzaign',
    counters_needed: 'Konter braucht ma',
    counters_covered: 'Olls do',
    no_pathogens: 'Koa Bazilln',
    audio: 'Tone',
    music_enabled: 'Musi',
    music_volume: 'Musi-Laudstärk',
    sfx_volume: 'Effekt-Laudstärk',
    next_track: 'Nägstes Liadl',
    random_split: 'Zoifällige Teilung', meta_split: 'Metaball-Doaln',
    auto_split: 'Auto-Teilung (s)',
    friction: 'Reibung', bounce: 'Sprungkraft', throw_strength: 'Wuafkraft',
    wobble: 'Wackln', bg_flow: 'Hintagrundgflies', outline_px: 'Umrandung px',
    membrane: 'Membran', cell_size: 'Zoingrässn', use_highlight: 'Akzentfarb vawendn',
    mode_target: 'Zuimodus', mode_target_tip: 'Drauflanga: aussuacha / Zui setzn',
    mode_split: 'Teilungsmodus', mode_split_tip: 'Drauflanga deid de Zoin teiln',
    mode_kill: 'Schomattmodus', mode_kill_tip: 'Drauflanga und d\'Zoin macht boom',
    cartoon_mode: 'Cartoon-Modus (Gsichta)', show_fps: 'FPS oazoang', show_renderer: 'Render oazoang', show_build_info: 'Build-Info oazoang',
    show_field: 'Metaball-Föd zoang', render_scale: 'Renderskala',
    upscale: 'Aufskaliern', scanlines: 'Scanlines (CRT)',
    renderer_engine: 'Render',
    renderer_canvas: 'Canvas2D',
    renderer_webgl: 'WebGL2',
    renderer_webgpu: 'WebGPU',
    reset_sim: 'Simulation z\'rucksetzn',
    about: 'Iwa', about_credits: 'Mitwirkn', about_licences: 'Lizenzn', about_licences_note: 'Drei Shader-Assets miassn Shadertoy-Standard-Lizenz folgn.', about_permissive: 'Permissive', about_desc: '2D-Mikrobnsimulation.',
    help_title: 'Zoin vom Immunsystem',
    add_cell: 'Zoin dazua', add_pathogen: 'Bazi dazua',
    add_title: 'Dazua', add_tab_cells: 'Zoin', add_tab_pathogens: 'Bazi', add_tab_theme: 'Dema',
    spawn_banner_friends: 'Spezi', spawn_banner_prey: 'Beit', spawn_banner_foes: 'Feind', spawn_banner_close: 'Bassd',
    palette_to_help: 'Wos macht jede Zoin? →',
    palette_bad_to_help: 'Wos macht jeda Bazi? →',
    debug_log: 'Debug-Protokoi', clear: 'Leara', copy: 'Kopiern',
    pause: 'Pause', paused: 'PAUSE',
    paused_hint: 'Leertaste oder Bildschirm zum Weidamoacha',
    nav_settings: 'Eistellunga', nav_help: 'Huif', nav_add_cell: 'Zoin dazua',
    nav_add_pathogen: 'Bazi dazua', nav_reload: 'Nei lodn',
    adding: 'Dazua: {name}',
    fps_line: '{fps} fps · Zoin {n}',
    help_group_good: 'Guad (Immunsystem)',
    blend_none: 'Koa', blend_overlay: 'Overlay (Stand)', blend_multiply: 'Multipliziarn',
    blend_darken: 'Dunkla macha', blend_lighter: 'Hella', blend_screen: 'Aufhelln',
    blend_softlight: 'Woach\'s Liacht', blend_hardlight: 'Hoats Liacht',
    blend_burn: 'Nochbelichtn', blend_dodge: 'Owedln',
    upscale_blur: 'Woachzeichna', upscale_pixel: 'Pixel (knacki)',
    pgroup_virus: 'Viren', pgroup_bacteria: 'Bakterien',
    pgroup_parasite: 'Parasitn', pgroup_fungus: 'Schwammerln', pgroup_toxin: 'Gifte',
    cell_neutrophil_label: 'Neutrophil',
    cell_neutrophil_desc: 'De erste Vateidigung; vaschlingt Bakterien per Phagozytose. De häufigste weiße Bluadzelln.',
    cell_monocyte_label: 'Monozyt',
    cell_monocyte_desc: 'Wachpostn im Bluad; reift im Gewebe zu Makrophagn oda dendritischn Zoin.',
    cell_mast_label: 'Mastzelln',
    cell_mast_desc: 'Gewebewachta; haut s\' Histamin raus und macht Entzündung und Allergie.',
    cell_nk_label: 'Natürliche Killazelln',
    cell_nk_desc: 'Patrouilliert nach virusinfiziertn und Tumorzelln; daschlogt bei Kontakt ohne Vorprägung.',
    cell_macrophage_label: 'Makrophag',
    cell_macrophage_desc: '"Großfressa" — langlebiga Phagozyt; vadaut Erreger und zoagt d\'Antigene de T-Zelln.',
    cell_dendritic_label: 'Dendritische Zelln',
    cell_dendritic_desc: 'Antigen-präsentierada Bot; bringt Erregaprobm zu de T-Zelln in de Lymphknotn.',
    cell_basophil_label: 'Basophila Granulozyt',
    cell_basophil_desc: 'Kreisada Granulozyt; setzt Histamin und Heparin frei und vastärkt d\'Entzündung.',
    cell_platelet_label: 'Bluadplattl',
    cell_platelet_desc: 'A winzigs Zellnstickl; verklebt s\'Bluad bei Wundn und huift, Immunzelln zsammz\'rufa.',
    cell_tcell_label: 'T-Zelln',
    cell_tcell_desc: 'Adaptiva Killa/Koordinator; daskennt spezifische Antigene und daschlogt infizierte Zelln.',
    cell_bcell_label: 'B-Zelln',
    cell_bcell_desc: 'Adaptive Antikörperfabrik; baut Antikörper, de zu jedem Erreger passn.',
    cell_eosinophil_label: 'Eosinophila Granulozyt',
    cell_eosinophil_desc: 'Spezialist gega Parasitn; wichti bei Allergien, haut giftige Granuln raus.',
    cell_rbc_label: 'Rote Bluadzelln',
    cell_rbc_desc: 'Erythrozyt; bikonkave Scheibm voi Hämoglobin — schleppt Sauastoff durch\'n Körpa.',
    cell_virus_label: 'Virus',
    cell_virus_desc: 'Spike-Eindringling; kapat Zelln, dass\'a si do drin vamehrn ko.',
    cell_germ_label: 'Bazi',
    cell_germ_desc: 'A allgmoa knubbliga Bazi — opportunistischa Erreger.',
    cell_bacterium_label: 'Bakterium',
    cell_bacterium_desc: 'Stäbchenbakterium, schwimmt mit am peitschadn Flagellum.',
    cell_amoebaP_label: 'Amöbe (Parasit)',
    cell_amoebaP_desc: 'Amöboida Parasit; kriacht und vaschlingt s\'Gewebe.',
    cell_slime_label: 'Schleim',
    cell_slime_desc: 'A schleimige Biofilm-Kugl; tropft giftige Bria.',
    cell_mite_label: 'Milbn',
    cell_mite_desc: 'A winziga Krabbla; vui kloane Hax\'n.',
    cell_spore_label: 'Spor',
    cell_spore_desc: 'Schwammalspor — treibt mit da Strömung und sät neis Wachstum.',
    cell_toxin_label: 'Gift',
    cell_toxin_desc: 'A zackiga Giftkristoi; treibt umadum und brennt bei Kontakt.',
  },
  hes: {
    // Hessisch (Frankfurter / mittelhessischer Raum) — von der
    // deutschen Übersetzung abgeleitet, leicht lesbar fürs Auge
    // standarddeutsch geübter Leser.
    settings_title: 'Eistellunge',
    bg_solid: 'Vollfarb',
    bg_bloodstream: 'Blutstroom (Karmin)',
    bg_bloodflow: 'Blutfluß (Zinnober)',
    bg_cellShadow: 'Zellschadde (Roht)',
    bg_cartoonNight: 'Kosmisch Subb (Nachtblau)',
    bg_spectrum: 'Spektrum (Reschebooche)',
    bg_lymphNode: 'Lymphknotn (Violett)',
    bg_lung: 'Lung (Rauch)',
    bg_lavaFire: 'Magma (Orsch)',
    bg_reactor: 'Reakta (Saurgrie)',
    bg_boneMarrow: 'Knochemark (Creme)',
    bg_mitochondria: 'Mitochondrium (Bernstaa)',
    bg_neuron: 'Neuron (Elektrablau)',
    bg_bile: 'Gall (Chartreuse)',
    ic_pink: 'Rosa', ic_red: 'Roht', ic_amber: 'Bernstaa', ic_yellow: 'Gelb',
    ic_green: 'Grie', ic_cyan: 'Zyan', ic_blue: 'Blau', ic_violet: 'Violett', ic_mono: 'Mono',
    theme: 'Thema', interface_color: 'Schnittstellefarb', background: 'Hintergrund', gameplay: 'Spiel',
    theme_legacy: 'Legacy (Standard)', theme_microscope: 'Mikroskop',
    theme_cartoon: 'Cartoon', theme_kurzgesagt: 'Kurzgesagt', theme_classic: 'Klassisch',
    splitting: 'Teilung', population: 'Population',
    physics: 'Physik', look: 'Aussehe',
    performance: 'Leistung', language: 'Sprooch',
    allow_pathogens: 'Krankheitserreger erlaube',
    pinch_rotation: 'Zwaa-Finger-Drehung',
    fullscreen: 'Vollbild',
    shader_test_link: 'Shader-Test',
    game_mode: 'Spielmodus',
    mode_free: 'Free Game',
    mode_campaign_soon: 'Kampagne (gleisch)',
    mode_survival_soon: 'Survival (gleisch)',
    composition_hud: 'Aufstellungs-HUD',
    caustics_overlay: 'Lichtspiel-Iwwerlach',
    liquid_ripples: 'Flüssichkeits-Welle',
    cell_type_overlay: 'Zelltypen weisen',
    counters_needed: 'Konter braucht mer',
    counters_covered: 'Alles dabei',
    no_pathogens: 'Kaa Erreger',
    audio: 'Audio',
    music_enabled: 'Musik',
    music_volume: 'Musiklautstärke',
    sfx_volume: 'Effektlautstärke',
    next_track: 'Nächst Stück',
    random_split: 'Zufällige Teilung', meta_split: 'Metaball-Teilung',
    auto_split: 'Auto-Teilung (s)',
    friction: 'Reibung', bounce: 'Sprungkraft', throw_strength: 'Wurfkraft',
    wobble: 'Wackeln', bg_flow: 'Hintergrundfluss', outline_px: 'Umrandung px',
    membrane: 'Membran', cell_size: 'Zellgröß', use_highlight: 'Akzentfarb verwende',
    mode_target: 'Zielmodus', mode_target_tip: 'Drufftippe: aussuche / Ziel setze',
    mode_split: 'Teilungsmodus', mode_split_tip: 'Drufftippe teilt die Zell',
    mode_kill: 'Tötungsmodus', mode_kill_tip: 'Zell antippe, dann macht\'s puff',
    cartoon_mode: 'Cartoon-Modus (Gesischter)', show_fps: 'FPS aazaiche', show_renderer: 'Renderer aazaiche', show_build_info: 'Build-Info aazaiche',
    show_field: 'Metaball-Feld zaiche', render_scale: 'Renderskala',
    upscale: 'Hochskaliere', scanlines: 'Scanlines (CRT)',
    renderer_engine: 'Renderer',
    renderer_canvas: 'Canvas2D',
    renderer_webgl: 'WebGL2',
    renderer_webgpu: 'WebGPU',
    reset_sim: 'Simulation zurücksetze',
    about: 'Iwwer', about_credits: 'Mitwirkende', about_licences: 'Drittanbieter-Lizenze', about_licences_note: 'Drei Shader-Assets folge der Shadertoy CC BY-NC-SA 3.0 Lizenz.', about_permissive: 'Permissive Portierunge', about_desc: '2D Mikrobe-Simulation.',
    help_title: 'Zelle vom Immunsystem',
    add_cell: 'Zell dezugeb', add_pathogen: 'Erreger dezugeb',
    add_title: 'Dezugeb', add_tab_cells: 'Zelle', add_tab_pathogens: 'Erreger', add_tab_theme: 'Thema',
    spawn_banner_friends: 'Kumbel', spawn_banner_prey: 'Beit', spawn_banner_foes: 'Feind', spawn_banner_close: 'Hab dich',
    palette_to_help: 'Was machd jede Zell? →',
    palette_bad_to_help: 'Was machd jeder Erreger? →',
    debug_log: 'Debug-Logbuch', clear: 'Lääre', copy: 'Kopiere',
    pause: 'Pause', paused: 'PAUSE',
    paused_hint: 'Leertast oder Bildschirm zum Weidamache',
    nav_settings: 'Eistellunge', nav_help: 'Hilf', nav_add_cell: 'Zell dezugeb',
    nav_add_pathogen: 'Erreger dezugeb', nav_reload: 'Neu lade',
    adding: 'Dezu: {name}',
    fps_line: '{fps} fps · Zelle {n}',
    help_group_good: 'Gut (Immunsystem)',
    blend_none: 'Kaa', blend_overlay: 'Overlay (Standard)', blend_multiply: 'Multipliziere',
    blend_darken: 'Abdunkele', blend_lighter: 'Heller', blend_screen: 'Aufhelle',
    blend_softlight: 'Waaches Licht', blend_hardlight: 'Hartes Licht',
    blend_burn: 'Nachbelichte', blend_dodge: 'Abwedele',
    upscale_blur: 'Waachzaichne', upscale_pixel: 'Pixel (knackisch)',
    pgroup_virus: 'Viren', pgroup_bacteria: 'Bakterien',
    pgroup_parasite: 'Parasite', pgroup_fungus: 'Pilz', pgroup_toxin: 'Toxine',
    cell_neutrophil_label: 'Neutrophil',
    cell_neutrophil_desc: 'Erschte Verteidigung; verschling Bakterie per Phagozytose. Häufischste weiße Blutzell.',
    cell_monocyte_label: 'Monozyt',
    cell_monocyte_desc: 'Wachposchte im Blut; werd im Gewebe zu Makrophage oder dendritische Zell.',
    cell_mast_label: 'Mastzell',
    cell_mast_desc: 'Gewebewächter; haut Histamin raus und macht Entzündung und Allergie.',
    cell_nk_label: 'Natürliche Killerzell',
    cell_nk_desc: 'Patrouilliert nach virusinfizierte und Tumorzelle; daschlägt bei Kontakt ohne Vorprägung.',
    cell_macrophage_label: 'Makrophage',
    cell_macrophage_desc: '"Großfresser" — langlebischer Phagozyt; verdaut Erreger und zaicht den T-Zelle die Antigene.',
    cell_dendritic_label: 'Dendritische Zell',
    cell_dendritic_desc: 'Antigen-präsentierender Kurier; bringt Erregerprobe zu de T-Zelle in die Lymphknote.',
    cell_basophil_label: 'Basophiler Granulozyt',
    cell_basophil_desc: 'Kreisender Granulozyt; setzt Histamin und Heparin frei und verstärkt Entzündung.',
    cell_platelet_label: 'Blutplättche',
    cell_platelet_desc: 'Winzisches Zellstickche; gerinnt Blut an Wunde und hilft, Immunzelle herzurufe.',
    cell_tcell_label: 'T-Zell',
    cell_tcell_desc: 'Adaptiver Killer/Koordinator; daskennt spezifische Antigene und daschlägt infizierte Zelle.',
    cell_bcell_label: 'B-Zell',
    cell_bcell_desc: 'Adaptive Antikörperfabrik; baut Antikörper, die zu jedem Erreger passe.',
    cell_eosinophil_label: 'Eosinophiler Granulozyt',
    cell_eosinophil_desc: 'Spezialischt gegen Parasite; wichtig bei Allergie, haut giftige Granule raus.',
    cell_rbc_label: 'Rote Blutzell',
    cell_rbc_desc: 'Erythrozyt; bikonkave Scheib voll Hämoglobin — schleppt Sauerstoff durch de Körper.',
    cell_virus_label: 'Virus',
    cell_virus_desc: 'Spike-Eindringling; kapert Zelle, dass\'a sich do drin vermehrn kann.',
    cell_germ_label: 'Keim',
    cell_germ_desc: 'Allgemoaa knubbelische Mikrob — opportunistischer Erreger.',
    cell_bacterium_label: 'Bakterium',
    cell_bacterium_desc: 'Stäbchebakterium, schwimmt mit am peitschende Flagellum.',
    cell_amoebaP_label: 'Amöbe (Parasit)',
    cell_amoebaP_desc: 'Amöboider Parasit; kriescht und verschling Gewebe.',
    cell_slime_label: 'Schlaim',
    cell_slime_desc: 'Schlaimische Biofilm-Kugel; tropft giftische Brüh.',
    cell_mite_label: 'Milb',
    cell_mite_desc: 'Winzischer Krabbeler; viel klaane Bee.',
    cell_spore_label: 'Spor',
    cell_spore_desc: 'Pilzspor — treibt mit de Strömung und sät neues Wachstum.',
    cell_toxin_label: 'Gift',
    cell_toxin_desc: 'Zackischer Giftkristall; treibt umme und brennt bei Kontakt.',
  },
  mainz: {
    // Mainzerisch / Meenzerisch (Stadt Mainz) — Rheinhessischer
    // Stadtdialekt, weicher als Hessisch, weniger harte "scht"-Laute,
    // mit Mainzer Eigenheiten ("ei guude", "babbele", "Meenz", "uff").
    settings_title: 'Eistellunge',
    bg_solid: 'Vollfarb',
    bg_bloodstream: 'Bluddstroom (Karmin)',
    bg_bloodflow: 'Bluddfloß (Zinnober)',
    bg_cellShadow: 'Zellschadde (Roht)',
    bg_cartoonNight: 'Kosmisch Subb (Nachtblau)',
    bg_spectrum: 'Spektrum (Reschebooche)',
    bg_lymphNode: 'Lymphknodde (Violett)',
    bg_lung: 'Lung (Rauch)',
    bg_lavaFire: 'Magma (Orsch)',
    bg_reactor: 'Reaktor (Saurgrie)',
    bg_boneMarrow: 'Knochemark (Creem)',
    bg_mitochondria: 'Mitochondrium (Bernstaa)',
    bg_neuron: 'Neuron (Elektroblau)',
    bg_bile: 'Gall (Chartreuse)',
    ic_pink: 'Rosa', ic_red: 'Roht', ic_amber: 'Bernstaa', ic_yellow: 'Gelb',
    ic_green: 'Grie', ic_cyan: 'Zyan', ic_blue: 'Blau', ic_violet: 'Violett', ic_mono: 'Mono',
    theme: 'Thema', interface_color: 'Schnittstellefarb', background: 'Hintergrund', gameplay: 'Spiel',
    theme_legacy: 'Legacy (Standard)', theme_microscope: 'Mikroskop',
    theme_cartoon: 'Cartoon', theme_kurzgesagt: 'Kurzgesagt', theme_classic: 'Klassisch',
    splitting: 'Teilung', population: 'Population',
    physics: 'Physik', look: 'Ausseh',
    performance: 'Leistung', language: 'Sproch',
    allow_pathogens: 'Krankheitserreger erlaube',
    pinch_rotation: 'Zwaa-Finger-Drehung',
    fullscreen: 'Vollbild',
    shader_test_link: 'Shader-Test',
    game_mode: 'Spielmodus',
    mode_free: 'Free Game',
    mode_campaign_soon: 'Kampagne (bald)',
    mode_survival_soon: 'Survival (bald)',
    composition_hud: 'Aufstellungs-HUD',
    caustics_overlay: 'Lichtspiel-Drüwwer',
    liquid_ripples: 'Flüssichkeits-Welle',
    cell_type_overlay: 'Zelletype zeische',
    counters_needed: 'Konter braucht mer',
    counters_covered: 'Alles dabei',
    no_pathogens: 'Kaa Erreger',
    audio: 'Audio',
    music_enabled: 'Musik',
    music_volume: 'Musiklautstärk',
    sfx_volume: 'Effektlautstärk',
    next_track: 'Nächst Stück',
    random_split: 'Zufällische Teilung', meta_split: 'Metaball-Teilung',
    auto_split: 'Auto-Teilung (s)',
    friction: 'Reibung', bounce: 'Sprungkraft', throw_strength: 'Wurfkraft',
    wobble: 'Wackele', bg_flow: 'Hintergrundfluss', outline_px: 'Umrandung px',
    membrane: 'Membran', cell_size: 'Zellgröß', use_highlight: 'Akzentfarb verwenne',
    mode_target: 'Zielmodus', mode_target_tip: 'Druffdibbe: aussuche / Ziel setze',
    mode_split: 'Teilungsmodus', mode_split_tip: 'Druffdibbe teilt die Zell',
    mode_kill: 'Tötungsmodus', mode_kill_tip: 'Zell andibbe, dann gibt\'s peng',
    cartoon_mode: 'Cartoon-Modus (Gesichter)', show_fps: 'FPS zeische', show_renderer: 'Renderer zeische', show_build_info: 'Build-Info zeische',
    show_field: 'Metaball-Feld zeische', render_scale: 'Renderskala',
    upscale: 'Hochskaliere', scanlines: 'Scanlines (CRT)',
    renderer_engine: 'Renderer',
    renderer_canvas: 'Canvas2D',
    renderer_webgl: 'WebGL2',
    renderer_webgpu: 'WebGPU',
    reset_sim: 'Simulation zurückstelle',
    about: 'Iwwer', about_credits: 'Mitwirkende', about_licences: 'Drittanbieter-Lizenze', about_licences_note: 'Drei Shader-Assets folge der Shadertoy CC BY-NC-SA 3.0 Lizenz.', about_permissive: 'Permissive Portierunge', about_desc: '2D Mikrobe-Simulation.',
    help_title: 'Zelle vum Immunsystem',
    add_cell: 'Zell dabbeschdun', add_pathogen: 'Erreger dabbeschdun',
    add_title: 'Dabbeschdun', add_tab_cells: 'Zelle', add_tab_pathogens: 'Erreger', add_tab_theme: 'Tema',
    spawn_banner_friends: 'Geschwisterle', spawn_banner_prey: 'Beit', spawn_banner_foes: 'Feind', spawn_banner_close: 'Hab schun',
    palette_to_help: 'Was macht jede Zell? →',
    palette_bad_to_help: 'Was macht jeder Erreger? →',
    debug_log: 'Debug-Logbuch', clear: 'Lääre', copy: 'Kopiere',
    pause: 'Pause', paused: 'PAUSE',
    paused_hint: 'Leertast oder Bildschirm zum Weiterbabbele',
    nav_settings: 'Eistellunge', nav_help: 'Hilf', nav_add_cell: 'Zell dabbeschdun',
    nav_add_pathogen: 'Erreger dabbeschdun', nav_reload: 'Nei laade',
    adding: 'Dabbei: {name}',
    fps_line: '{fps} fps · Zelle {n}',
    help_group_good: 'Gut (Immunsystem)',
    blend_none: 'Kaa', blend_overlay: 'Overlay (Standard)', blend_multiply: 'Multipliziere',
    blend_darken: 'Abdunkele', blend_lighter: 'Heller', blend_screen: 'Aufhelle',
    blend_softlight: 'Wääches Licht', blend_hardlight: 'Harts Licht',
    blend_burn: 'Nachbelichte', blend_dodge: 'Abwedele',
    upscale_blur: 'Weichzeichne', upscale_pixel: 'Pixel (knackisch)',
    pgroup_virus: 'Viren', pgroup_bacteria: 'Bakterie',
    pgroup_parasite: 'Parasite', pgroup_fungus: 'Pilz', pgroup_toxin: 'Toxine',
    cell_neutrophil_label: 'Neutrophil',
    cell_neutrophil_desc: 'Erst Verteidigung; verschlingt Bakterie per Phagozytose. Häufigst weiße Blutzell.',
    cell_monocyte_label: 'Monozyt',
    cell_monocyte_desc: 'Wachposte im Blut; werd im Gewebe zu Makrophage oder dendritische Zell.',
    cell_mast_label: 'Mastzell',
    cell_mast_desc: 'Gewebewächter; lässt Histamin raus un macht Entzündung un Allergie.',
    cell_nk_label: 'Natürliche Killerzell',
    cell_nk_desc: 'Patrouilliert nach virusinfizierte un Tumorzelle; macht\'se kalt ohne Vorprägung.',
    cell_macrophage_label: 'Makrophage',
    cell_macrophage_desc: '"Großfresser" — langlebischer Phagozyt; verdaut Erreger un weist den T-Zelle die Antigene.',
    cell_dendritic_label: 'Dendritische Zell',
    cell_dendritic_desc: 'Antigen-präsentierender Kurier; bringt Erregerprobe zu de T-Zelle in de Lymphknote.',
    cell_basophil_label: 'Basophiler Granulozyt',
    cell_basophil_desc: 'Kreisender Granulozyt; lässt Histamin un Heparin raus un verstärkt Entzündung.',
    cell_platelet_label: 'Blutplättsche',
    cell_platelet_desc: 'Winzisches Zellstickelsche; gerinnt Blut an Wunne un hilft, Immunzelle herzubringe.',
    cell_tcell_label: 'T-Zell',
    cell_tcell_desc: 'Adaptiver Killer/Koordinator; erkennt spezifische Antigene un macht infizierte Zelle kalt.',
    cell_bcell_label: 'B-Zell',
    cell_bcell_desc: 'Adaptive Antikörperfabrik; baut Antikörper, die zu jedem Erreger basse.',
    cell_eosinophil_label: 'Eosinophiler Granulozyt',
    cell_eosinophil_desc: 'Spezialist gege Parasite; wichtig bei Allergie, lässt giftische Granule raus.',
    cell_rbc_label: 'Rote Blutzell',
    cell_rbc_desc: 'Erythrozyt; bikonkave Scheib voll Hämoglobin — bringt Sauerstoff durch de Körper.',
    cell_virus_label: 'Virus',
    cell_virus_desc: 'Spike-Eindringling; kabbert Zelle, dass\'er sich do drin vermehre kann.',
    cell_germ_label: 'Keim',
    cell_germ_desc: 'Allgemaa knubbelische Mikrob — opportunistischer Erreger.',
    cell_bacterium_label: 'Bakterium',
    cell_bacterium_desc: 'Stäbschebakterium, schwimmt mit aam peitsche-de Flagellum.',
    cell_amoebaP_label: 'Amöb (Parasit)',
    cell_amoebaP_desc: 'Amöboider Parasit; kriescht un verschlingt Gewebe.',
    cell_slime_label: 'Schlaim',
    cell_slime_desc: 'Schlaimische Biofilm-Kuhl; tropft giftische Brüh.',
    cell_mite_label: 'Milb',
    cell_mite_desc: 'Winzischer Krabbler; viel klaa Baa.',
    cell_spore_label: 'Spor',
    cell_spore_desc: 'Pilzspor — treibt mit de Strömung un sät neies Wachstum.',
    cell_toxin_label: 'Gift',
    cell_toxin_desc: 'Zackischer Giftkristall; treibt umme un brennt bei Kontakt.',
  },
  latin: {
    settings_title: 'Configuratio',
    bg_solid: 'Color solidus',
    bg_bloodstream: 'Sanguinis flumen (coccinum)',
    bg_bloodflow: 'Sanguinis fluxus (cinnabar)',
    bg_cellShadow: 'Umbra cellularis (rubrum)',
    bg_cartoonNight: 'Iuscellum cosmicum (caeruleum nocturnum)',
    bg_spectrum: 'Spectrum (iris)',
    bg_lymphNode: 'Nodus lymphaticus (violaceus)',
    bg_lung: 'Pulmo (fumus)',
    bg_lavaFire: 'Magma (aurantium)',
    bg_reactor: 'Reactor (viride acidum)',
    bg_boneMarrow: 'Medulla ossea (cremor)',
    bg_mitochondria: 'Mitochondrium (succinum)',
    bg_neuron: 'Neuron (caeruleum electricum)',
    bg_bile: 'Bilis (chartreuse)',
    ic_pink: 'Roseus', ic_red: 'Ruber', ic_amber: 'Sucinus', ic_yellow: 'Gilvus',
    ic_green: 'Viridis', ic_cyan: 'Caesius', ic_blue: 'Caeruleus', ic_violet: 'Violaceus', ic_mono: 'Unicolor',
    theme: 'Tema', interface_color: 'Color interfaciei', background: 'Tergum', gameplay: 'Ludus',
    theme_legacy: 'Legacy (defalta)', theme_microscope: 'Microscopium',
    theme_cartoon: 'Cartoon', theme_kurzgesagt: 'Kurzgesagt', theme_classic: 'Classicus',
    splitting: 'Divisio', population: 'Populatio',
    physics: 'Physica', look: 'Aspectus',
    performance: 'Celeritas', language: 'Lingua',
    allow_pathogens: 'Pathogenes admittere',
    pinch_rotation: 'Rotatio bidigitalis',
    fullscreen: 'Imago tota',
    shader_test_link: 'Probatio adumbratoris',
    game_mode: 'Modus ludendi',
    mode_free: 'Lusus liber',
    mode_campaign_soon: 'Expeditio (mox)',
    mode_survival_soon: 'Superstes (mox)',
    composition_hud: 'HUD compositionis',
    caustics_overlay: 'Lux undans',
    liquid_ripples: 'Undae liquidae',
    cell_type_overlay: 'Genera cellularum',
    counters_needed: 'Repugnatores requiruntur',
    counters_covered: 'Plene defensus',
    no_pathogens: 'Nullae pestes',
    audio: 'Audio',
    music_enabled: 'Musica',
    music_volume: 'Volumen musicae',
    sfx_volume: 'Volumen effectuum',
    next_track: 'Carmen sequens',
    random_split: 'Divisio casualis', meta_split: 'Divisio metaballi',
    auto_split: 'Auto-divisio (s)',
    friction: 'Frictio', bounce: 'Resilientia', throw_strength: 'Vis jactus',
    wobble: 'Tremor', bg_flow: 'Fluxus tergi', outline_px: 'Linea (px)',
    membrane: 'Membrana', cell_size: 'Magnitudo cellulae',
    use_highlight: 'Colore luminis utere',
    mode_target: 'Modus signi', mode_target_tip: 'Tange ut elige / mitte',
    mode_split: 'Modus divisionis', mode_split_tip: 'Tange cellulam ut dividas',
    mode_kill: 'Modus necandi', mode_kill_tip: 'Tange cellulam ut displodatur',
    cartoon_mode: 'Modus picturae (vultus)', show_fps: 'Monstra FPS', show_renderer: 'Monstra machinam', show_build_info: 'Monstra info constructionis',
    show_field: 'Monstra campum metaball', render_scale: 'Scala depingendi',
    upscale: 'Augmentum', scanlines: 'Lineae televisorii',
    renderer_engine: 'Machina depingendi',
    renderer_canvas: 'Canvas2D',
    renderer_webgl: 'WebGL2',
    renderer_webgpu: 'WebGPU',
    reset_sim: 'Restituere simulationem',
    about: 'De projecto', about_credits: 'Auctores', about_licences: 'Licentiae alienae', about_licences_note: 'Tres pelliculae sub licentia Shadertoy CC BY-NC-SA 3.0 sunt.', about_permissive: 'Translationes permissivae', about_desc: 'Simulatio microborum bidimensionalis.',
    help_title: 'Cellulae systematis immunitarii',
    add_cell: 'Adde cellulam', add_pathogen: 'Adde pathogenem',
    add_title: 'Addere', add_tab_cells: 'Cellulae', add_tab_pathogens: 'Pathogenes', add_tab_theme: 'Thema',
    spawn_banner_friends: 'Socii', spawn_banner_prey: 'Praeda', spawn_banner_foes: 'Hostes', spawn_banner_close: 'Intelligo',
    palette_to_help: 'Disce quid quaeque cellula faciat →',
    palette_bad_to_help: 'Disce quid quisque pathogenes faciat →',
    debug_log: 'Diarium debugationis', clear: 'Vacua', copy: 'Describe',
    pause: 'Mora', paused: 'MORA',
    paused_hint: 'Tange spatium aut velum ut continues',
    nav_settings: 'Configuratio', nav_help: 'Auxilium', nav_add_cell: 'Adde cellulam',
    nav_add_pathogen: 'Adde pathogenem', nav_reload: 'Iterum onerare',
    adding: 'Addendo: {name}',
    fps_line: '{fps} fps · cellulae {n}',
    help_group_good: 'Bonae (systema immunitarium)',
    blend_none: 'Nullum', blend_overlay: 'Superpositio', blend_multiply: 'Multiplica',
    blend_darken: 'Obscura', blend_lighter: 'Adde lucem', blend_screen: 'Velum',
    blend_softlight: 'Lux mollis', blend_hardlight: 'Lux dura',
    blend_burn: 'Incende', blend_dodge: 'Tolle',
    upscale_blur: 'Mollis', upscale_pixel: 'Pixel (acutus)',
    pgroup_virus: 'Virus', pgroup_bacteria: 'Bacteria',
    pgroup_parasite: 'Parasiti', pgroup_fungus: 'Fungi', pgroup_toxin: 'Venena',
    cell_neutrophil_label: 'Neutrophilus',
    cell_neutrophil_desc: 'Primus respondens; bacteria phagocytosi devorat. Cellula alba sanguinis frequentissima.',
    cell_monocyte_label: 'Monocytus',
    cell_monocyte_desc: 'Custos circulans; in tissu maturat in macrophagos vel cellulas dendriticas.',
    cell_mast_label: 'Mastocytus',
    cell_mast_desc: 'Custos in tissu; histaminam emittit ad inflammationem allergiamque.',
    cell_nk_label: 'Cellula NK',
    cell_nk_desc: 'Patrouillat cellulas virusinfectas et tumores; ad contactum sine sensibilitate praevia necat.',
    cell_macrophage_label: 'Macrophagus',
    cell_macrophage_desc: '"Magnus edens" — phagocytus longaevus; pathogenes devorat et antigena T-cellulis ostendit.',
    cell_dendritic_label: 'Cellula dendritica',
    cell_dendritic_desc: 'Cursor antigeniferens; specimina hostium fert ad T-cellulas in nodis lymphaticis.',
    cell_basophil_label: 'Basophilus',
    cell_basophil_desc: 'Granulocytus circulans; histaminam et heparinam emittit ad inflammationem fortificandam.',
    cell_platelet_label: 'Thrombocytus',
    cell_platelet_desc: 'Fragmentum cellulare minimum; sanguinem in vulneribus coagulat et cellulas immunitarias accersit.',
    cell_tcell_label: 'T-cellula',
    cell_tcell_desc: 'Necator-coordinator adaptivus; antigena specifica agnoscit et cellulas infectas necat.',
    cell_bcell_label: 'B-cellula',
    cell_bcell_desc: 'Officina anticorporum adaptiva; anticorpora specifica facit.',
    cell_eosinophil_label: 'Eosinophilus',
    cell_eosinophil_desc: 'Specialista contra parasitos; granula toxica emittit.',
    cell_rbc_label: 'Erythrocytus',
    cell_rbc_desc: 'Discus biconcavus plenus haemoglobini; oxygenium per corpus portat.',
    cell_virus_label: 'Virus',
    cell_virus_desc: 'Invasor cum spinis; cellulas capit ut intra se multiplicet.',
    cell_germ_label: 'Microbus',
    cell_germ_desc: 'Microbus communis tuberosus — opportunisticus infector.',
    cell_bacterium_label: 'Bacterium',
    cell_bacterium_desc: 'Bacterium baculum; cum flagello flagellante natat.',
    cell_amoebaP_label: 'Amoeba (parasitus)',
    cell_amoebaP_desc: 'Parasitus amoebodialis; serpit et tissum devorat.',
    cell_slime_label: 'Limus',
    cell_slime_desc: 'Globus biofilmi limosus; venenum stillans gutta.',
    cell_mite_label: 'Acarus',
    cell_mite_desc: 'Bestiola minima; multa parva crura.',
    cell_spore_label: 'Spora',
    cell_spore_desc: 'Spora fungi — fluctibus fertur et novum incrementum seminat.',
    cell_toxin_label: 'Toxinum',
    cell_toxin_desc: 'Crystallum venenosum dentatum; fluctuat et tactus urit.',
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
    bg: { kind: 'gradient', topColor: '#5b101a', botColor: '#1d0306', spotColor: 'rgba(255,90,100,0.18)', spotCount: 6, vignette: 0.45, rbcSilhouettes: true },
    outline: { color: '#1c0306', defaultPx: 4 },
    ui: { panelAccent: '#ff6b6b' },
  },
  bloodflow: {
    label: 'Bloodflow (vermilion)',
    bg: { kind: 'bloodflow', topColor: '#3a0a12', botColor: '#0e0205', vignette: 0.30 },
    outline: { color: '#1c0306', defaultPx: 4 },
    ui: { panelAccent: '#d63333' },
  },
  cellShadow: {
    label: 'Cell Shadow (red)',
    bg: { kind: 'cell-shadow', base: '#3a060e', vignette: 0.35 },
    outline: { color: '#1c0306', defaultPx: 4 },
    ui: { panelAccent: '#c83246' },
  },
  cartoonNight: {
    label: 'Cosmic Soup (navy)',
    bg: { kind: 'flat', base: '#0c1a3a', spotColors: ['#ff7ab8','#ffb84d','#5fe3d2','#ff5d6e'], spotCount: 6, vignette: 0.30 },
    outline: { color: '#04081a', defaultPx: 5 },
    ui: { panelAccent: '#5fe3d2' },
  },
  spectrum: {
    label: 'Spectrum (rainbow)',
    bg: { kind: 'flat', base: '#000000', spotColors: ['#ff003c','#ff8a00','#ffd600','#3ecf6c','#3da6ff','#a855f7'], spotCount: 6, vignette: 0.30 },
    outline: { color: '#000000', defaultPx: 4 },
    ui: { panelAccent: '#a855f7' },
  },
  lymphNode: {
    label: 'Lymph Node (violet)',
    bg: { kind: 'gradient', topColor: '#2a0e3a', botColor: '#0a0410', spotColor: 'rgba(160,120,200,0.15)', spotCount: 5, vignette: 0.40 },
    outline: { color: '#0a0410', defaultPx: 4 },
    ui: { panelAccent: '#bd93e2' },
  },
  lung: {
    label: 'Lung (smoke)',
    bg: { kind: 'lung', base: '#1a1118', topColor: '#3a1c2c', botColor: '#0a0610', spotCount: 0, vignette: 0.40 },
    outline: { color: '#02080f', defaultPx: 4 },
    ui: { panelAccent: '#ff9aa8' },
  },
  lavaFire: {
    label: 'Magma (orange)',
    bg: { kind: 'lava', base: '#1a0402', topColor: '#3b0a05', botColor: '#0a0202', spotCount: 0, vignette: 0.50 },
    outline: { color: '#1a0606', defaultPx: 4 },
    ui: { panelAccent: '#ff5a00' },
  },
  // ── New palettes (2026) — common themes the project lacked.
  boneMarrow: {
    // Pale cream + tan — bone-marrow / cancellous-bone aesthetic.
    label: 'Bone Marrow (cream)',
    bg: { kind: 'flat', base: '#e9dcb8', spotColors: ['#c9a87a','#b0905e','#937444'], spotCount: 5, vignette: 0.20 },
    outline: { color: '#5a432a', defaultPx: 3 },
    ui: { panelAccent: '#b0905e' },
  },
  mitochondria: {
    // Warm amber on deep brown — mitochondrial inner-membrane palette.
    label: 'Mitochondria (amber)',
    bg: { kind: 'gradient', topColor: '#3a1c0a', botColor: '#100602', spotColor: 'rgba(255,160,60,0.20)', spotCount: 6, vignette: 0.40 },
    outline: { color: '#1c0a02', defaultPx: 4 },
    ui: { panelAccent: '#ffa040' },
  },
  neuron: {
    // Electric blue on near-black — synapse / action-potential feel.
    label: 'Neuron (electric blue)',
    bg: { kind: 'gradient', topColor: '#0a1830', botColor: '#020610', spotColor: 'rgba(80,180,255,0.22)', spotCount: 5, vignette: 0.40 },
    outline: { color: '#020610', defaultPx: 3 },
    ui: { panelAccent: '#50b4ff' },
  },
  bile: {
    // Chartreuse on deep olive — bile / gallbladder palette.
    label: 'Bile (chartreuse)',
    bg: { kind: 'gradient', topColor: '#1c2810', botColor: '#080c04', spotColor: 'rgba(180,220,80,0.18)', spotCount: 4, vignette: 0.35 },
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
    bg: { kind: 'reactor', base: '#02060a', spotCount: 0, vignette: 0.40 },
    outline: { color: '#0a1816', defaultPx: 4 },
    ui: { panelAccent: '#7eff8a' },
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
};

export function cellColors(cell) {
  return (cell && cell._colors)
    || (CELL_TYPES[cell && cell.type] || CELL_TYPES.neutrophil).colors;
}

export function pickRandomActiveType() {
  const list = (Array.isArray(S.activeTypes) && S.activeTypes.length)
    ? S.activeTypes.filter(k => CELL_TYPES[k])
    : Object.keys(CELL_TYPES);
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
