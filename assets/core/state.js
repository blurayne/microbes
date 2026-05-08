// Microbes — shared state, registries, constants, i18n.
//
// Pure data + helpers. Touches `localStorage` and `navigator` only behind
// `typeof` guards so this module is safely importable from Node for tests.
// `applyI18n` is the only DOM touch; it no-ops when `document` is missing.

export const SETTINGS_KEY = 'microbes.settings.v2';
export const SETTINGS_KEY_V1 = 'microbes.settings.v1';

export const ALL_CELL_KEYS = [
  'neutrophil', 'monocyte', 'mast', 'nk', 'macrophage', 'dendritic',
  'basophil', 'platelet', 'tcell', 'bcell', 'eosinophil',
  'virus', 'germ', 'bacterium', 'amoebaP', 'slime', 'mite', 'spore', 'toxin',
];

export const DEFAULTS = {
  splitMode: 'bondDrift',
  autoSplitSeconds: 10,
  maxCells: 32,
  bgFlowSpeed: 0.55,
  outlinePx: 5,
  showDebugField: false,
  theme: 'petriDish',
  activeTypes: ALL_CELL_KEYS.slice(),
  splitOnTap: false,
  randomSplit: false,
  showFPS: false,
  friction: 0.80,
  bounce: 0.6,
  throwStrength: 0.35,
  wobbleAmp: 0.13,
  blendMode: 'overlay',
  speedMul: 1.0,
  cartoon: false,
  lang: 'en',
  allowBadGuys: true,
  cellSizeMul: 1.0,
  membraneIntensity: 0.55,
  background: 'petriDish',
  renderScale: 1.0,
  upscaleMode: 'blur',
  scanlines: false,
  highlightColor: '#ffffff',
  renderer: 'canvas2d',     // 'canvas2d' | 'webgl2' (added for the upcoming WebGL renderer)
};

const KNOWN_THEME_KEYS = [
  'petriDish', 'bloodstream', 'neonBloom', 'aquaticGlow',
  'crayonBox', 'cartoonNight', 'glowStick', 'bedtime',
  'spectrum', 'aurora', 'prism', 'pride',
  'deepSpace', 'volcano', 'forestFloor', 'cyberGrid',
  'lymphNode', 'thymus', 'boneMarrow', 'heart',
  'gut', 'lung', 'brain', 'kidney', 'skin', 'liver',
];

const VALID_RENDER_SCALES = [1, 0.5, 0.25, 0.125];

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
    if (parsed.theme && !KNOWN_THEME_KEYS.includes(parsed.theme)) parsed.theme = DEFAULTS.theme;
    if (!parsed.background) parsed.background = parsed.theme || DEFAULTS.background;
    if (!VALID_RENDER_SCALES.includes(parsed.renderScale)) parsed.renderScale = 1;
    if (parsed.renderer !== 'canvas2d' && parsed.renderer !== 'webgl2') parsed.renderer = DEFAULTS.renderer;
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
    theme: 'Theme', background: 'Background', gameplay: 'Gameplay',
    splitting: 'Splitting', split_mode: 'Split mode', population: 'Population',
    physics: 'Physics', cell_blending: 'Cell blending', look: 'Look',
    performance: 'Performance', language: 'Language',
    allow_pathogens: 'Allow pathogens',
    split_on_tap: 'Split on tap', random_split: 'Random splitting',
    split_push: 'Push apart with momentum', split_bond: 'Bond, then drift',
    max_cells: 'Max cells', auto_split: 'Auto-split (s)',
    friction: 'Friction', bounce: 'Bounce', throw_strength: 'Throw strength',
    wobble: 'Wobble', bg_flow: 'Background flow', outline_px: 'Outline px',
    membrane: 'Membrane', cell_size: 'Cell size', highlight_color: 'Highlight colour',
    mode_target: 'Target mode', mode_target_tip: 'Tap to select / send selected cells',
    mode_split: 'Split mode', mode_split_tip: 'Tap a cell to split it',
    cartoon_mode: 'Cartoon mode (faces)', show_fps: 'Show FPS',
    show_field: 'Show metaball field', render_scale: 'Render scale',
    upscale: 'Upscale', scanlines: 'Scanlines (CRT)',
    reset_sim: 'Reset simulation',
    help_title: 'Cells of the immune system',
    add_cell: 'Add a cell', add_pathogen: 'Add a pathogen',
    palette_to_help: 'Learn what each cell does →',
    palette_bad_to_help: 'Learn what each pathogen does →',
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
    theme: 'Thema', background: 'Hintergrund', gameplay: 'Spiel',
    splitting: 'Teilung', split_mode: 'Teilungsmodus', population: 'Population',
    physics: 'Physik', cell_blending: 'Zellüberblendung', look: 'Aussehen',
    performance: 'Leistung', language: 'Sprache',
    allow_pathogens: 'Krankheitserreger erlauben',
    split_on_tap: 'Bei Antippen teilen', random_split: 'Zufällige Teilung',
    split_push: 'Mit Schwung auseinander', split_bond: 'Verbinden, dann driften',
    max_cells: 'Max. Zellen', auto_split: 'Auto-Teilung (s)',
    friction: 'Reibung', bounce: 'Sprungkraft', throw_strength: 'Wurfkraft',
    wobble: 'Wackeln', bg_flow: 'Hintergrundfluss', outline_px: 'Umrandung px',
    membrane: 'Membran', cell_size: 'Zellgröße', highlight_color: 'Akzentfarbe',
    mode_target: 'Zielmodus', mode_target_tip: 'Antippen: auswählen / Ziel setzen',
    mode_split: 'Teilungsmodus', mode_split_tip: 'Antippen teilt die Zelle',
    cartoon_mode: 'Cartoon-Modus (Gesichter)', show_fps: 'FPS anzeigen',
    show_field: 'Metaball-Feld zeigen', render_scale: 'Renderskala',
    upscale: 'Hochskalieren', scanlines: 'Scanlines (CRT)',
    reset_sim: 'Simulation zurücksetzen',
    help_title: 'Zellen des Immunsystems',
    add_cell: 'Zelle hinzufügen', add_pathogen: 'Erreger hinzufügen',
    palette_to_help: 'Was macht jede Zelle? →',
    palette_bad_to_help: 'Was macht jeder Erreger? →',
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
    theme: 'Tema', background: 'Fondo', gameplay: 'Juego',
    splitting: 'División', split_mode: 'Modo de división', population: 'Población',
    physics: 'Física', cell_blending: 'Mezcla de células', look: 'Estilo',
    performance: 'Rendimiento', language: 'Idioma',
    allow_pathogens: 'Permitir patógenos',
    split_on_tap: 'Dividir al tocar', random_split: 'División aleatoria',
    split_push: 'Empujar con impulso', split_bond: 'Unir, luego separar',
    max_cells: 'Células máx.', auto_split: 'Auto-división (s)',
    friction: 'Fricción', bounce: 'Rebote', throw_strength: 'Fuerza de lanzamiento',
    wobble: 'Oscilación', bg_flow: 'Flujo de fondo', outline_px: 'Contorno px',
    membrane: 'Membrana', cell_size: 'Tamaño de célula', highlight_color: 'Color de selección',
    mode_target: 'Modo objetivo', mode_target_tip: 'Toca para seleccionar / enviar',
    mode_split: 'Modo división', mode_split_tip: 'Toca una célula para dividirla',
    cartoon_mode: 'Modo dibujo (caras)', show_fps: 'Mostrar FPS',
    show_field: 'Mostrar campo metaball', render_scale: 'Escala de render',
    upscale: 'Reescalar', scanlines: 'Líneas de barrido (CRT)',
    reset_sim: 'Reiniciar simulación',
    help_title: 'Células del sistema inmunitario',
    add_cell: 'Añadir célula', add_pathogen: 'Añadir patógeno',
    palette_to_help: 'Aprende qué hace cada célula →',
    palette_bad_to_help: 'Aprende qué hace cada patógeno →',
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
  brbn: {
    settings_title: 'BARBARIAN SMASH SETTINGS',
    theme: 'WORLD COLOR', background: 'WORLD PICTURE', gameplay: 'PLAY RULE',
    splitting: 'CELL MAKE TWO', split_mode: 'TWO-MAKE STYLE', population: 'CELL CROWD',
    physics: 'WORLD PUSH RULE', cell_blending: 'CELL MIX', look: 'EYE STUFF',
    performance: 'GO FAST', language: 'TALK WAY',
    allow_pathogens: 'LET BAD GUY IN',
    split_on_tap: 'POKE MAKE TWO', random_split: 'CELL TWO BY SELF',
    split_push: 'PUSH AND THROW', split_bond: 'STICK THEN FLOAT',
    max_cells: 'MOST CELLS', auto_split: 'AUTO TWO TIME',
    friction: 'STICKY WORLD', bounce: 'SPRING POWER', throw_strength: 'ROCK THROW POWER',
    wobble: 'JIGGLE', bg_flow: 'WORLD MOVE', outline_px: 'EDGE THICK',
    membrane: 'SKIN', cell_size: 'BIG CELL OR SMOL CELL', highlight_color: 'PICK SHINY COLOR',
    mode_target: 'POINT MODE', mode_target_tip: 'TAP PICK GUY OR SET PLACE',
    mode_split: 'SMASH MODE', mode_split_tip: 'TAP CELL MAKE TWO',
    cartoon_mode: 'BIG SILLY FACES', show_fps: 'SHOW FAST NUMBER',
    show_field: 'SHOW BLOB GRID', render_scale: 'BIG MAKE SIZE',
    upscale: 'BIG GROW', scanlines: 'TV LINE THING',
    reset_sim: 'MAKE WORLD NEW',
    help_title: 'GOOD CELLS LIST',
    add_cell: 'MAKE GOOD CELL', add_pathogen: 'MAKE BAD CELL',
    palette_to_help: 'LEARN WHAT CELL DO →',
    palette_bad_to_help: 'LEARN WHAT BAD GUY DO →',
    nav_settings: 'CONTROL ROOM', nav_help: 'BIG QUESTION', nav_add_cell: 'MAKE GOOD CELL',
    nav_add_pathogen: 'MAKE BAD CELL', nav_reload: 'WORLD RESTART',
    adding: 'STUFF NEW: {name}',
    fps_line: '{fps} FAST · CELLS {n}',
    help_group_good: 'FRIENDLY GUYS (BODY ARMY)',
    blend_none: 'NO MIX', blend_overlay: 'MIX (NORMAL)', blend_multiply: 'DARK MIX',
    blend_darken: 'GO DARK', blend_lighter: 'GO BRIGHT', blend_screen: 'BIG BRIGHT',
    blend_softlight: 'SOFT GLOW', blend_hardlight: 'HARD GLOW',
    blend_burn: 'COLOR BURN', blend_dodge: 'COLOR SHINE',
    upscale_blur: 'SMOOSH SMOOTH', upscale_pixel: 'BLOCKY CRISP',
    pgroup_virus: 'TINY SPIKE GUYS', pgroup_bacteria: 'WIGGLE STICKS',
    pgroup_parasite: 'CRAWL BUGS', pgroup_fungus: 'MOLD STUFF', pgroup_toxin: 'BURN ROCKS',
    cell_neutrophil_label: 'NEUTROPHIL',
    cell_neutrophil_desc: 'FIRST GUY ON SCENE. EAT BACTERIA. MOST COMMON WHITE BLOB.',
    cell_monocyte_label: 'MONOCYTE',
    cell_monocyte_desc: 'BLOOD GUARD. GROW UP INTO BIG EATER OR SHOW-AND-TELL CELL.',
    cell_mast_label: 'MAST CELL',
    cell_mast_desc: 'TISSUE WATCH. THROW HISTAMINE. MAKE SWELL AND ITCH.',
    cell_nk_label: 'NATURAL KILLER',
    cell_nk_desc: 'PATROL FOR SICK CELL. KILL ON SIGHT. NO QUESTION.',
    cell_macrophage_label: 'MACROPHAGE',
    cell_macrophage_desc: 'BIG EATER. CHOMP BUGS. SHOW CHEW BITS TO T-CELL.',
    cell_dendritic_label: 'DENDRITIC CELL',
    cell_dendritic_desc: 'COURIER GUY. GRAB BUG BIT. RUN TELL T-CELL IN LYMPH FORT.',
    cell_basophil_label: 'BASOPHIL',
    cell_basophil_desc: 'BLOOD GRAIN. SPRAY HISTAMINE. MAKE INFLAME LOUDER.',
    cell_platelet_label: 'PLATELET',
    cell_platelet_desc: 'TINY CRUMB. PLUG BLEED. CALL FRIENDS TO WOUND.',
    cell_tcell_label: 'T CELL',
    cell_tcell_desc: 'SMART KILLER. KNOW BAD GUY BY NAME. SMASH SICK CELL.',
    cell_bcell_label: 'B CELL',
    cell_bcell_desc: 'ARROW MAKER. SPIT STICKY ARROW THAT TAG BAD GUY.',
    cell_eosinophil_label: 'EOSINOPHIL',
    cell_eosinophil_desc: 'WORM SLAYER. THROW BURN BAG. ALSO MAKE ALLERGY HURT.',
    cell_virus_label: 'VIRUS',
    cell_virus_desc: 'SPIKE BALL. SNEAK IN CELL. MAKE MORE SELF.',
    cell_germ_label: 'GERM',
    cell_germ_desc: 'BUMPY BUG. JUST WANT EAT YOU.',
    cell_bacterium_label: 'BACTERIUM',
    cell_bacterium_desc: 'STICK BUG WITH WHIPPY TAIL. SWIM FAST.',
    cell_amoebaP_label: 'AMOEBA',
    cell_amoebaP_desc: 'BLOB CRAWLER. EAT FLESH BIT BY BIT.',
    cell_slime_label: 'SLIME',
    cell_slime_desc: 'GROSS GOO BLOB. DRIP NASTY DROP.',
    cell_mite_label: 'MITE',
    cell_mite_desc: 'TINY MANY-LEG SCURRY GUY.',
    cell_spore_label: 'SPORE',
    cell_spore_desc: 'MOLD SEED. FLOAT ON BREEZE. MAKE NEW MOLD.',
    cell_toxin_label: 'TOXIN',
    cell_toxin_desc: 'POINTY BURN ROCK. DRIFT AROUND. HURT ON TOUCH.',
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
export const THEMES = {
  petriDish: {
    label: 'Petri Dish',
    bg: { kind: 'agar', base: '#f1e1a1', spotColor: 'rgba(170,120,40,0.10)', spotCount: 5, vignette: 0.18, ringColor: 'rgba(120,80,30,0.10)' },
    outline: { color: '#2b1c0a', defaultPx: 5 },
    ui: { panelAccent: '#a86a18' },
  },
  bloodstream: {
    label: 'Bloodstream',
    bg: { kind: 'gradient', topColor: '#5b101a', botColor: '#1d0306', spotColor: 'rgba(255,90,100,0.18)', spotCount: 6, vignette: 0.45, rbcSilhouettes: true },
    outline: { color: '#1c0306', defaultPx: 4 },
    ui: { panelAccent: '#ff6b6b' },
  },
  neonBloom: {
    label: 'Neon Bloom',
    bg: { kind: 'navy-ghost', base: '#0e1840', spotColor: 'rgba(80,40,160,0.25)', spotCount: 7, vignette: 0.4 },
    outline: { color: '#0d0420', defaultPx: 3, glow: '#ff4fbf', glowBlur: 22 },
    ui: { panelAccent: '#ff4fbf' },
  },
  aquaticGlow: {
    label: 'Aquatic Glow',
    bg: { kind: 'gradient', topColor: '#001a4a', botColor: '#00050f', spotColor: 'rgba(80,200,255,0.10)', spotCount: 4, vignette: 0.3 },
    outline: { color: '#06122a', defaultPx: 3, glow: '#5ce7ff', glowBlur: 18 },
    ui: { panelAccent: '#5ce7ff' },
  },
  crayonBox: {
    label: 'Crayon Box',
    bg: { kind: 'flat', base: '#0a0612', spotColors: ['#ff4d4d','#ffd84d','#4d8dff','#4dd87a'], spotCount: 6, vignette: 0.25 },
    outline: { color: '#000000', defaultPx: 5 },
    ui: { panelAccent: '#ffd84d' },
  },
  cartoonNight: {
    label: 'Cartoon Night',
    bg: { kind: 'flat', base: '#0c1a3a', spotColors: ['#ff7ab8','#ffb84d','#5fe3d2','#ff5d6e'], spotCount: 6, vignette: 0.30 },
    outline: { color: '#04081a', defaultPx: 5 },
    ui: { panelAccent: '#5fe3d2' },
  },
  glowStick: {
    label: 'Glow Stick',
    bg: { kind: 'flat', base: '#000000', spotColors: ['#ffea00','#ff00aa','#00ff88','#00d8ff'], spotCount: 7, vignette: 0.50 },
    outline: { color: '#000000', defaultPx: 3, glow: '#ffffff', glowBlur: 12 },
    ui: { panelAccent: '#ffea00' },
  },
  bedtime: {
    label: 'Bedtime Stories',
    bg: { kind: 'gradient', topColor: '#0e0a2c', botColor: '#1c123e', spotColors: ['#fff4c2','#ffe0a3','#cdbcff','#bff5ff'], spotCount: 8, vignette: 0.45 },
    outline: { color: '#0c0a22', defaultPx: 3 },
    ui: { panelAccent: '#ffe0a3' },
  },
  spectrum: {
    label: 'Spectrum',
    bg: { kind: 'flat', base: '#000000', spotColors: ['#ff003c','#ff8a00','#ffd600','#3ecf6c','#3da6ff','#a855f7'], spotCount: 6, vignette: 0.30 },
    outline: { color: '#000000', defaultPx: 4 },
    ui: { panelAccent: '#a855f7' },
  },
  aurora: {
    label: 'Aurora',
    bg: { kind: 'gradient', topColor: '#03081a', botColor: '#000000', spotColors: ['#3ecf6c','#5cd6ff','#a855f7','#ff5cb8','#ffe070'], spotCount: 7, vignette: 0.40 },
    outline: { color: '#000000', defaultPx: 3, glow: '#5cd6ff', glowBlur: 16 },
    ui: { panelAccent: '#3ecf6c' },
  },
  prism: {
    label: 'Prism',
    bg: { kind: 'flat', base: '#04020a', spotColors: ['#ff3030','#ff8800','#ffd700','#00d068','#0088ff','#7000ff'], spotCount: 6, vignette: 0.50 },
    outline: { color: '#000000', defaultPx: 4 },
    ui: { panelAccent: '#ff8800' },
  },
  pride: {
    label: 'Pride',
    bg: { kind: 'gradient', topColor: '#15082a', botColor: '#04010d', spotColors: ['#e40303','#ff8c00','#ffed00','#008026','#004cff','#732982'], spotCount: 6, vignette: 0.35 },
    outline: { color: '#000000', defaultPx: 4 },
    ui: { panelAccent: '#ff8c00' },
  },
  deepSpace: {
    label: 'Deep Space',
    bg: { kind: 'flat', base: '#000005', spotColors: ['#ffffff','#a0c0ff','#ffe0a0'], spotCount: 9, vignette: 0.60 },
    outline: { color: '#000000', defaultPx: 3, glow: '#ffffff', glowBlur: 8 },
    ui: { panelAccent: '#a0c0ff' },
  },
  volcano: {
    label: 'Volcano',
    bg: { kind: 'gradient', topColor: '#3b0a05', botColor: '#0a0202', spotColors: ['#ff5a00','#ff9933','#ffe066','#ffaa44'], spotCount: 7, vignette: 0.50 },
    outline: { color: '#1a0606', defaultPx: 4, glow: '#ff7530', glowBlur: 14 },
    ui: { panelAccent: '#ff5a00' },
  },
  forestFloor: {
    label: 'Forest Floor',
    bg: { kind: 'flat', base: '#091206', spotColors: ['#a8d250','#ffd24d','#5ad27a','#cfe07f'], spotCount: 6, vignette: 0.45 },
    outline: { color: '#04080d', defaultPx: 4 },
    ui: { panelAccent: '#a8d250' },
  },
  cyberGrid: {
    label: 'Cyber Grid',
    bg: { kind: 'cybergrid', base: '#000010', spotColors: ['#00ff88','#ff00aa','#00d8ff'], spotCount: 4, vignette: 0.30, gridColor: 'rgba(0,255,170,0.18)', gridStep: 48 },
    outline: { color: '#000000', defaultPx: 3, glow: '#00ff88', glowBlur: 16 },
    ui: { panelAccent: '#00ff88' },
  },
  lymphNode: {
    label: 'Lymph Node',
    bg: { kind: 'gradient', topColor: '#2a0e3a', botColor: '#0a0410', spotColor: 'rgba(160,120,200,0.15)', spotCount: 5, vignette: 0.40, decor: 'lymphocytes' },
    outline: { color: '#0a0410', defaultPx: 4 },
    ui: { panelAccent: '#bd93e2' },
  },
  thymus: {
    label: 'Thymus',
    bg: { kind: 'gradient', topColor: '#401218', botColor: '#100204', spotColor: 'rgba(220,90,110,0.18)', spotCount: 6, vignette: 0.45, decor: 'lobules' },
    outline: { color: '#0a0102', defaultPx: 4 },
    ui: { panelAccent: '#e95870' },
  },
  boneMarrow: {
    label: 'Bone Marrow',
    bg: { kind: 'gradient', topColor: '#44290a', botColor: '#190a02', spotColor: 'rgba(255,180,90,0.18)', spotCount: 5, vignette: 0.40, decor: 'matrix' },
    outline: { color: '#0a0501', defaultPx: 4 },
    ui: { panelAccent: '#ffb95c' },
  },
  heart: {
    label: 'Heart',
    bg: { kind: 'gradient', topColor: '#4a0a0a', botColor: '#110202', spotColor: 'rgba(255,60,60,0.18)', spotCount: 4, vignette: 0.50, decor: 'pulse' },
    outline: { color: '#0a0202', defaultPx: 4 },
    ui: { panelAccent: '#ff4040' },
  },
  gut: {
    label: 'Gut',
    bg: { kind: 'gradient', topColor: '#3a1010', botColor: '#100404', spotColor: 'rgba(220,140,140,0.16)', spotCount: 5, vignette: 0.40, decor: 'villi' },
    outline: { color: '#0a0202', defaultPx: 4 },
    ui: { panelAccent: '#e08688' },
  },
  lung: {
    label: 'Lung',
    bg: { kind: 'gradient', topColor: '#082040', botColor: '#020618', spotColor: 'rgba(150,200,255,0.18)', spotCount: 5, vignette: 0.40, decor: 'alveoli' },
    outline: { color: '#02080f', defaultPx: 4 },
    ui: { panelAccent: '#5cb0ff' },
  },
  brain: {
    label: 'Brain',
    bg: { kind: 'gradient', topColor: '#2a142e', botColor: '#100612', spotColor: 'rgba(255,200,255,0.15)', spotCount: 6, vignette: 0.50, decor: 'neurons' },
    outline: { color: '#08020a', defaultPx: 3, glow: '#e0a0ff', glowBlur: 14 },
    ui: { panelAccent: '#e0a0ff' },
  },
  kidney: {
    label: 'Kidney',
    bg: { kind: 'gradient', topColor: '#2c0e08', botColor: '#0c0402', spotColor: 'rgba(255,140,90,0.16)', spotCount: 5, vignette: 0.45, decor: 'tubules' },
    outline: { color: '#0a0202', defaultPx: 4 },
    ui: { panelAccent: '#ff9070' },
  },
  skin: {
    label: 'Skin',
    bg: { kind: 'gradient', topColor: '#3c1c0c', botColor: '#100804', spotColor: 'rgba(255,200,160,0.18)', spotCount: 4, vignette: 0.35, decor: 'hair' },
    outline: { color: '#0a0402', defaultPx: 4 },
    ui: { panelAccent: '#e8a878' },
  },
  liver: {
    label: 'Liver',
    bg: { kind: 'gradient', topColor: '#2a0e0a', botColor: '#0a0202', spotColor: 'rgba(180,80,60,0.18)', spotCount: 5, vignette: 0.50, decor: 'lobules' },
    outline: { color: '#0a0202', defaultPx: 4 },
    ui: { panelAccent: '#c85a3c' },
  },
};

export function currentTheme() {
  return THEMES[S.theme] || THEMES.petriDish;
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
  return BACKGROUNDS[S.background] || BACKGROUNDS[S.theme] || BACKGROUNDS.solid;
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
export const SPLIT_DURATION = 0.9;
export const BOND_DURATION = 2.0;
export const CELL_RADIUS = 52;
export const NUCLEUS_RATIO = 0.30;
export const BROWNIAN = 18;
export const REPULSION = 180;
export const MARGIN = 80;
export const MARGIN_SPRING = 5;
export const DOWNSAMPLE = 0.5;
export const WOBBLE_VERTS = 32;
export const MIN_SCALE = 0.25;
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
  platelet:   { eyes: 0,                                          mouth: 'none' },
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
