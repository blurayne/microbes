(() => {
  'use strict';

  // ---------- Settings ----------
  const SETTINGS_KEY = 'microbes.settings.v2';
  const SETTINGS_KEY_V1 = 'microbes.settings.v1';
  const ALL_CELL_KEYS = [
    'neutrophil','monocyte','mast','nk','macrophage','dendritic','basophil','platelet','tcell','bcell','eosinophil',
    'virus','germ','bacterium','amoebaP','slime','mite','spore','toxin',
  ];
  const DEFAULTS = {
    splitMode: 'bondDrift',     // 'pushApart' | 'bondDrift'
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
    blendMode: 'overlay',     // overlapping cells get a perceptual overlay blend by default
    speedMul: 1.0,            // global movement multiplier (range 0..3)
    cartoon: false,           // cartoon-face overlay
    lang: 'en',               // 'en' | 'de' | 'es' | 'brbn'
    allowBadGuys: true,       // expose pathogen palette + spawn paths
  };

  function loadSettings() {
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
      // Sanitize: activeTypes must be a non-empty array of known keys
      if (!Array.isArray(parsed.activeTypes) || parsed.activeTypes.length === 0
          || parsed.activeTypes.some(k => !ALL_CELL_KEYS.includes(k))) {
        parsed.activeTypes = [...DEFAULTS.activeTypes];
      }
      // Drop the obsolete `fixedGrid` split-mode value
      if (parsed.splitMode === 'fixedGrid') parsed.splitMode = 'bondDrift';
      // Drop themes no longer in the registry (hard-coded list to avoid TDZ on THEMES)
      const knownThemes = ['petriDish','bloodstream','neonBloom','aquaticGlow',
        'crayonBox','cartoonNight','glowStick','bedtime',
        'spectrum','aurora','prism','pride',
        'deepSpace','volcano','forestFloor','cyberGrid',
        'lymphNode','thymus','boneMarrow','heart','gut','lung','brain','kidney','skin','liver'];
      if (parsed.theme && !knownThemes.includes(parsed.theme)) parsed.theme = DEFAULTS.theme;
      return { ...DEFAULTS, ...parsed };
    } catch { return { ...DEFAULTS }; }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch {}
  }

  const S = loadSettings();

  // ---------- Themes ----------
  // Themes paint the *world* (background + outline style + neutral helpers).
  // Each cell type carries its own colour identity (see CELL_TYPES below) so
  // every microbe stays visually distinct regardless of theme.
  const THEMES = {
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

    // ----- Dark themes — children-colour palettes -----
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

    // ----- Dark themes — rainbow palettes -----
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

    // ----- Misc dark themes -----
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

    // ----- Anatomy scenes -----
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

  function currentTheme() {
    return THEMES[S.theme] || THEMES.petriDish;
  }

  // ---------- Cell types ----------
  // Each entry encodes a recognisable immune cell from the reference charts.
  // body.kind  → polygon radius formula in shapeVertex()
  // nucleus.kind → drawNucleus() dispatch
  // decoration.kind → drawDecorations() dispatch
  // granules → number of small dots inside the cell, drawn through the mask
  // description → 1-sentence role shown in the help dialog
  const DEFAULT_MOVE = {
    patrolSpeed: 50, attackSpeed: 110, patrolAccel: 90, alarmAccel: 240,
    weight: 1.0, friction: 1.0, hostility: 'idle',
  };
  const ALARM_RADIUS = 240;

  const CELL_TYPES = {
    neutrophil: {
      label: 'Neutrophil', category: 'good',
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
      label: 'Monocyte', category: 'good',
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
      label: 'Mast cell', category: 'good',
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
      label: 'NK cell', category: 'good',
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
      label: 'Macrophage', category: 'good',
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
      label: 'Dendritic cell', category: 'good',
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
      label: 'Basophil', category: 'good',
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
      label: 'Platelet', category: 'good',
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
      label: 'T-cell', category: 'good',
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
      label: 'B-cell', category: 'good',
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
      label: 'Eosinophil', category: 'good',
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

    // ---------- Bad guys ----------
    virus: {
      label: 'Virus', category: 'bad', subcategory: 'virus',
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
      label: 'Germ', category: 'bad', subcategory: 'bacteria',
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
      label: 'Bacterium', category: 'bad', subcategory: 'bacteria',
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
      label: 'Amoeba (✗)', category: 'bad', subcategory: 'parasite',
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
      label: 'Slime', category: 'bad', subcategory: 'fungus',
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
      label: 'Mite', category: 'bad', subcategory: 'parasite',
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
      label: 'Spore', category: 'bad', subcategory: 'fungus',
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
      label: 'Toxin', category: 'bad', subcategory: 'toxin',
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

  function cellColors(cell) {
    return (CELL_TYPES[cell.type] || CELL_TYPES.neutrophil).colors;
  }

  function pickRandomActiveType() {
    const list = (Array.isArray(S.activeTypes) && S.activeTypes.length)
      ? S.activeTypes.filter(k => CELL_TYPES[k])
      : Object.keys(CELL_TYPES);
    return list[Math.floor(Math.random() * list.length)] || 'neutrophil';
  }

  // ---------- Constants ----------
  const SPLIT_DURATION = 0.9;
  const BOND_DURATION = 2.0;
  const CELL_RADIUS = 52;          // 2× original
  const NUCLEUS_RATIO = 0.30;
  const BROWNIAN = 18;             // softer jiggle for gel feel
  const REPULSION = 180;
  const MARGIN = 80;
  const MARGIN_SPRING = 5;
  const DOWNSAMPLE = 0.5;
  const WOBBLE_VERTS = 32;         // polygon resolution for membrane

  // ---------- Canvas + offscreens ----------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');
  const off2 = document.createElement('canvas');
  const off2Ctx = off2.getContext('2d');

  let dpr = 1, W = 0, H = 0;

  // ---------- Camera (pan + zoom) ----------
  const camera = { tx: 0, ty: 0, scale: 1 };
  const MIN_SCALE = 0.25, MAX_SCALE = 4;

  function screenToWorld(sx, sy) {
    return { x: (sx - camera.tx) / camera.scale, y: (sy - camera.ty) / camera.scale };
  }

  // ---------- Drag / pan state ----------
  let drag = null;          // { cell, dx, dy, started, downX, downY }
  let pan = null;           // { lastX, lastY, startX, startY, moved, button }
  const activePointers = new Map();   // pointerId -> { x, y, world }
  let pinch = null;         // { startDist, startMid, startScale, startTx, startTy }
  const selectedCells = new Set(); // good cells the user has marked for movement
  let targetMarker = null;  // { x, y, t0 } — fading circle + dashed lines, ~1500ms
  const DRAG_THRESHOLD = 6;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ow = Math.max(2, Math.floor(W * DOWNSAMPLE));
    const oh = Math.max(2, Math.floor(H * DOWNSAMPLE));
    off.width = ow; off.height = oh;
    off2.width = ow; off2.height = oh;

    clampAllInside();
  }

  // ---------- Cells ----------
  const cells = [];
  let cellId = 0;

  function makeCell(x, y, r = CELL_RADIUS, type = null) {
    const t = (type && CELL_TYPES[type]) ? type : pickRandomActiveType();
    return {
      id: ++cellId,
      x, y, r,
      vx: 0, vy: 0,
      type: t,
      state: 'NORMAL',
      splitTimer: rollSplitTimer(t),
      splitProgress: 0,
      splitAngle: 0,
      bondTimer: 0,
      phase: Math.random() * Math.PI * 2,
      orientation: Math.random() * Math.PI * 2,
      wobbleSeed: Math.random() * 1000,
      wobbleFreq: 0.55 + Math.random() * 0.45,
      flash: 0,
      target: null,    // {x, y} world point this cell is moving toward (set on tap-empty when selected)
      patrolTarget: null,
      patrolTimer: 0,
      alarmTarget: null,
      alarmTimer: 0,
      category: (CELL_TYPES[t] && CELL_TYPES[t].category) || 'good',
      nextBlink: performance.now() + 1500 + Math.random() * 4500,
    };
  }

  function rollSplitTimer(type) {
    const factor = (type && CELL_TYPES[type]) ? CELL_TYPES[type].splitFactor : 1.0;
    const j = (Math.random() * 0.6) - 0.3;
    return Math.max(1.5, S.autoSplitSeconds * factor * (1 + j));
  }

  function clampAllInside() {
    for (const c of cells) {
      c.x = Math.max(MARGIN, Math.min(W - MARGIN, c.x));
      c.y = Math.max(MARGIN, Math.min(H - MARGIN, c.y));
    }
  }

  // ---------- Splitting ----------
  function beginSplit(cell) {
    if (cell.state !== 'NORMAL') return;
    if (cells.length >= S.maxCells) {
      cell.flash = 0.5;
      cell.splitTimer = rollSplitTimer(cell.type) * 0.5;
      return;
    }
    cell.state = 'SPLITTING';
    cell.splitProgress = 0;
    // Capsule-shaped cells (e.g. mast cells) preferentially split along their long axis.
    const ctype = CELL_TYPES[cell.type];
    if (ctype && ctype.body && ctype.body.kind === 'oblong') {
      cell.splitAngle = cell.orientation;
    } else {
      cell.splitAngle = Math.random() * Math.PI * 2;
    }
    cell.vx *= 0.3;
    cell.vy *= 0.3;
  }

  function finishSplit(cell, idx) {
    const a = cell.splitAngle;
    const cx = Math.cos(a), cy = Math.sin(a);
    const sep = cell.r * 1.05;
    const left = makeCell(cell.x - cx * sep, cell.y - cy * sep, cell.r, cell.type);
    const right = makeCell(cell.x + cx * sep, cell.y + cy * sep, cell.r, cell.type);
    // Daughters inherit parent orientation so rods stay aligned with their lineage
    left.orientation = cell.orientation;
    right.orientation = cell.orientation;
    // Inherit some of parent velocity
    left.vx = cell.vx; left.vy = cell.vy;
    right.vx = cell.vx; right.vy = cell.vy;

    if (S.splitMode === 'pushApart') {
      const speed = 70;
      left.vx -= cx * speed; left.vy -= cy * speed;
      right.vx += cx * speed; right.vy += cy * speed;
    } else if (S.splitMode === 'bondDrift') {
      const speed = 14;
      left.vx -= cx * speed; left.vy -= cy * speed;
      right.vx += cx * speed; right.vy += cy * speed;
      left.bondTimer = BOND_DURATION;
      right.bondTimer = BOND_DURATION;
    }

    cells.splice(idx, 1, left, right);
    selectedCells.delete(cell);
  }

  // ---------- Input ----------
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  function pointerScreen(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function hitCell(worldX, worldY) {
    let hit = -1, hitD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.state !== 'NORMAL') continue;
      const dx = c.x - worldX, dy = c.y - worldY;
      const d2 = dx * dx + dy * dy;
      const reach = c.r * 1.4;
      if (d2 < reach * reach && d2 < hitD) { hitD = d2; hit = i; }
    }
    return hit;
  }

  function startPinchIfTwoPointers() {
    if (activePointers.size !== 2) return false;
    const pts = [...activePointers.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    pinch = {
      startDist: Math.hypot(dx, dy) || 1,
      startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      startScale: camera.scale,
      startTx: camera.tx,
      startTy: camera.ty,
    };
    drag = null;
    pan = null;
    return true;
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.target !== canvas) return;
    const sp = pointerScreen(ev);
    activePointers.set(ev.pointerId, { x: sp.x, y: sp.y });
    canvas.setPointerCapture?.(ev.pointerId);

    // Two-finger pinch / pan
    if (startPinchIfTwoPointers()) return;

    // Right mouse button → pan
    if (ev.button === 2) {
      pan = { lastX: sp.x, lastY: sp.y, startX: sp.x, startY: sp.y, moved: false, button: 2 };
      return;
    }

    // Left button: try to grab a cell, else pan-on-background
    const w = screenToWorld(sp.x, sp.y);
    const idx = hitCell(w.x, w.y);
    if (idx >= 0) {
      const c = cells[idx];
      drag = {
        cell: c, dx: w.x - c.x, dy: w.y - c.y,
        started: false, downX: sp.x, downY: sp.y,
        samples: [{ x: c.x, y: c.y, t: performance.now() }],
      };
      c.vx = c.vy = 0;
      c.target = null;          // manual drag overrides any active move-to
    } else {
      pan = { lastX: sp.x, lastY: sp.y, startX: sp.x, startY: sp.y, moved: false, button: 0 };
    }
  });

  document.addEventListener('pointermove', (ev) => {
    if (!activePointers.has(ev.pointerId) && !drag && !pan && !pinch) return;
    const sp = pointerScreen(ev);
    const prev = activePointers.get(ev.pointerId);
    if (prev) { prev.x = sp.x; prev.y = sp.y; }

    if (pinch && activePointers.size === 2) {
      const pts = [...activePointers.values()];
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy) || 1;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const factor = dist / pinch.startDist;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinch.startScale * factor));
      // Keep the gesture midpoint stable in world space, then add pan from mid delta
      const wx = (pinch.startMid.x - pinch.startTx) / pinch.startScale;
      const wy = (pinch.startMid.y - pinch.startTy) / pinch.startScale;
      camera.scale = newScale;
      camera.tx = mid.x - wx * newScale;
      camera.ty = mid.y - wy * newScale;
      return;
    }

    if (drag) {
      if (!drag.started) {
        const ddx = sp.x - drag.downX, ddy = sp.y - drag.downY;
        if (ddx * ddx + ddy * ddy > DRAG_THRESHOLD * DRAG_THRESHOLD) drag.started = true;
      }
      if (drag.started) {
        const w = screenToWorld(sp.x, sp.y);
        drag.cell.x = w.x - drag.dx;
        drag.cell.y = w.y - drag.dy;
        drag.cell.vx = drag.cell.vy = 0;
        const now = performance.now();
        drag.samples.push({ x: drag.cell.x, y: drag.cell.y, t: now });
        // Keep only last ~120 ms of samples for velocity estimation
        const cutoff = now - 120;
        while (drag.samples.length > 2 && drag.samples[0].t < cutoff) drag.samples.shift();
      }
      return;
    }

    if (pan && prev) {
      const dx = sp.x - pan.lastX;
      const dy = sp.y - pan.lastY;
      if (!pan.moved) {
        const tx = sp.x - pan.startX, ty = sp.y - pan.startY;
        if (tx * tx + ty * ty > DRAG_THRESHOLD * DRAG_THRESHOLD) pan.moved = true;
      }
      if (pan.moved) {
        camera.tx += dx;
        camera.ty += dy;
      }
      pan.lastX = sp.x;
      pan.lastY = sp.y;
    }
  });

  function endPointer(ev) {
    activePointers.delete(ev.pointerId);
    if (pinch && activePointers.size < 2) pinch = null;
    if (activePointers.size === 0) {
      if (drag) {
        if (drag.started) {
          // Real drag → throw with momentum, clear any move-to target,
          // selection sticks (drag does not change which cell is selected).
          const now = performance.now();
          const samples = drag.samples;
          let i = samples.length - 1;
          while (i > 0 && (now - samples[i].t) < 80) i--;
          const a = samples[i];
          const b = samples[samples.length - 1];
          const dt = Math.max(0.016, (b.t - a.t) / 1000);
          drag.cell.vx = (b.x - a.x) / dt * S.throwStrength;
          drag.cell.vy = (b.y - a.y) / dt * S.throwStrength;
          drag.cell.target = null;
        } else if (S.splitOnTap) {
          beginSplit(drag.cell);
        } else {
          // Pure tap on a cell with splitOnTap OFF.
          // Only good cells can be selected for movement commands.
          if (drag.cell.category === 'good') {
            if (selectedCells.has(drag.cell)) {
              selectedCells.delete(drag.cell);
            } else {
              selectedCells.add(drag.cell);
              drag.cell.flash = 0.4;
              drag.cell.target = null;
            }
          } else {
            // Bad cell: brief flash so the tap registers visually, no selection
            drag.cell.flash = 0.25;
          }
        }
      } else if (pan && !pan.moved) {
        // Tap on empty world → if any good cells are selected, send them all there.
        if (selectedCells.size > 0) {
          const w = screenToWorld(pan.lastX, pan.lastY);
          for (const c of selectedCells) {
            if (c.state === 'NORMAL') c.target = { x: w.x, y: w.y };
          }
          targetMarker = { x: w.x, y: w.y, t0: performance.now() };
        }
      }
      drag = null;
      pan = null;
    }
  }
  document.addEventListener('pointerup', endPointer);
  document.addEventListener('pointercancel', endPointer);

  // Mouse wheel zoom (zoom toward cursor)
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const sp = pointerScreen(ev);
    const factor = Math.exp(-ev.deltaY * 0.0015);
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale * factor));
    const k = newScale / camera.scale;
    camera.tx = sp.x - (sp.x - camera.tx) * k;
    camera.ty = sp.y - (sp.y - camera.ty) * k;
    camera.scale = newScale;
  }, { passive: false });

  // ---------- Update ----------
  // Centre + swarm radius (max distance from centroid) for a category. Returns
  // null if the category has fewer than 2 cells (no cohesion needed).
  function swarmCentroid(category) {
    let n = 0, sx = 0, sy = 0;
    for (const c of cells) {
      if (c.state !== 'NORMAL' || c.category !== category) continue;
      sx += c.x; sy += c.y; n++;
    }
    if (n < 2) return null;
    const cx = sx / n, cy = sy / n;
    let r = 0;
    for (const c of cells) {
      if (c.state !== 'NORMAL' || c.category !== category) continue;
      const dx = c.x - cx, dy = c.y - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) r = d;
    }
    // Floor at 200 px so a tightly-clustered swarm still has a reasonable
    // permissible wander radius before stragglers get yanked home.
    return { x: cx, y: cy, r: Math.max(200, r) };
  }

  function update(dt) {
    // Cohesion: stragglers wandering >1.30× the swarm radius from the centroid
    // get their patrol target overridden back to the centroid until they're
    // back inside that bound. Computed once per frame, separately for each
    // category so good/bad pools cluster on their own.
    const centroidGood = swarmCentroid('good');
    const centroidBad  = swarmCentroid('bad');

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 2);

      if (c.state === 'NORMAL') {
        // Auto-split is gated by the "Random splitting" toggle
        if (S.randomSplit) {
          c.splitTimer -= dt;
          if (c.splitTimer <= 0) {
            if (cells.length < S.maxCells) {
              beginSplit(c);
            } else {
              c.splitTimer = rollSplitTimer(c.type) * 0.5;
            }
          }
        }

        if (c !== (drag && drag.cell)) {
          const moveCfg = (CELL_TYPES[c.type] && CELL_TYPES[c.type].move) || DEFAULT_MOVE;
          const sm = S.speedMul || 1;

          // Decay alarm timer
          if (c.alarmTimer > 0) c.alarmTimer = Math.max(0, c.alarmTimer - dt);

          let goalX = 0, goalY = 0, accel = 0, maxV = 0, hasGoal = false;

          if (c.target) {
            // Manual move-to (commanded by user)
            const dx = c.target.x - c.x, dy = c.target.y - c.y;
            const d = Math.hypot(dx, dy);
            if (d < 12) {
              c.target = null;
            } else {
              goalX = dx / d; goalY = dy / d;
              accel = moveCfg.alarmAccel * sm;
              maxV  = moveCfg.attackSpeed * sm;
              hasGoal = true;
            }
          }

          if (!hasGoal) {
            // Look for hostile within alarm radius (idle types ignore)
            if (c.alarmTimer === 0 && moveCfg.hostility !== 'idle') {
              let bestD = ALARM_RADIUS * ALARM_RADIUS, enemy = null;
              for (let j = 0; j < cells.length; j++) {
                const o = cells[j];
                if (o === c || o.state !== 'NORMAL') continue;
                if ((o.category || (CELL_TYPES[o.type] && CELL_TYPES[o.type].category)) === c.category) continue;
                const dx = o.x - c.x, dy = o.y - c.y;
                const d2 = dx*dx + dy*dy;
                if (d2 < bestD) { bestD = d2; enemy = o; }
              }
              if (enemy) { c.alarmTarget = enemy; c.alarmTimer = 1.6; }
            }

            if (c.alarmTimer > 0 && c.alarmTarget && c.alarmTarget.state === 'NORMAL') {
              const dx = c.alarmTarget.x - c.x, dy = c.alarmTarget.y - c.y;
              const d = Math.hypot(dx, dy) || 1;
              const sign = (moveCfg.hostility === 'flee') ? -1 : 1;
              goalX = sign * dx / d; goalY = sign * dy / d;
              accel = moveCfg.alarmAccel * sm;
              maxV  = moveCfg.attackSpeed * sm;
              hasGoal = true;
            } else {
              // Cohesion: if this cell has wandered >1.30× the swarm radius
              // from its category centroid, pull it back home before doing
              // any other patrol logic.
              const home = (c.category === 'bad') ? centroidBad : centroidGood;
              if (home && home.r > 0) {
                const hdx = home.x - c.x, hdy = home.y - c.y;
                const hd = Math.hypot(hdx, hdy);
                if (hd > 1.30 * home.r) {
                  c.patrolTarget = { x: home.x, y: home.y };
                  c.patrolTimer  = 4;
                }
              }
              // Patrol — refresh target every 3-8s, bias toward another cell
              c.patrolTimer -= dt;
              const reached = c.patrolTarget &&
                ((c.x - c.patrolTarget.x) ** 2 + (c.y - c.patrolTarget.y) ** 2) < 30 * 30;
              if (!c.patrolTarget || c.patrolTimer <= 0 || reached) {
                let pt = null;
                if (cells.length > 1 && Math.random() < 0.6) {
                  let other = null, tries = 6;
                  while (tries-- > 0) {
                    const o = cells[Math.floor(Math.random() * cells.length)];
                    if (o !== c && o.state === 'NORMAL') { other = o; break; }
                  }
                  if (other) pt = { x: other.x, y: other.y };
                }
                if (!pt) {
                  pt = {
                    x: c.x + (Math.random() - 0.5) * c.r * 12,
                    y: c.y + (Math.random() - 0.5) * c.r * 12,
                  };
                }
                c.patrolTarget = pt;
                c.patrolTimer = 3 + Math.random() * 5;
              }
              const dx = c.patrolTarget.x - c.x, dy = c.patrolTarget.y - c.y;
              const d = Math.hypot(dx, dy) || 1;
              goalX = dx / d; goalY = dy / d;
              accel = moveCfg.patrolAccel * sm;
              maxV  = moveCfg.patrolSpeed * sm;
              hasGoal = true;

              // small Brownian jitter for life
              const bMul = (CELL_TYPES[c.type] && CELL_TYPES[c.type].brownianMul) || 1.0;
              c.vx += (Math.random() - 0.5) * BROWNIAN * bMul * dt * 0.3;
              c.vy += (Math.random() - 0.5) * BROWNIAN * bMul * dt * 0.3;
            }
          }

          if (hasGoal) {
            const w = moveCfg.weight || 1;
            c.vx += goalX * accel * dt / w;
            c.vy += goalY * accel * dt / w;
            const sp = Math.hypot(c.vx, c.vy);
            if (sp > maxV) { c.vx = c.vx / sp * maxV; c.vy = c.vy / sp * maxV; }
          }

          // Friction: global S.friction × per-type multiplier, mapped exponentially
          // to a per-second damping factor (0.05^friction).
          let frictionEff = S.friction * (moveCfg.friction || 1);
          if (S.splitMode === 'bondDrift' && c.bondTimer > 0) {
            c.bondTimer -= dt;
            frictionEff = Math.min(1, frictionEff + 0.3);
          }
          frictionEff = Math.max(0, Math.min(1, frictionEff));
          const dampingPerSec = Math.max(0.001, Math.pow(0.05, frictionEff));
          const k = Math.pow(dampingPerSec, dt);
          c.vx *= k; c.vy *= k;

          c.x += c.vx * dt;
          c.y += c.vy * dt;
        }
      } else if (c.state === 'SPLITTING') {
        c.splitProgress += dt / SPLIT_DURATION;
        if (c.splitProgress >= 1) {
          finishSplit(c, i);
        }
      }
    }

    // Pairwise collision response (skip pairs while bonded)
    {
      const e = S.bounce;
      for (let i = 0; i < cells.length; i++) {
        const a = cells[i];
        if (a.state !== 'NORMAL') continue;
        for (let j = i + 1; j < cells.length; j++) {
          const b = cells[j];
          if (b.state !== 'NORMAL') continue;
          if (S.splitMode === 'bondDrift' && (a.bondTimer > 0 || b.bondTimer > 0)) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          const minD = a.r + b.r;
          if (d2 < minD * minD && d2 > 1) {
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d;
            // Position correction (split overlap)
            const overlap = minD - d;
            const aFixed = (drag && drag.cell === a);
            const bFixed = (drag && drag.cell === b);
            if (aFixed && !bFixed) {
              b.x += nx * overlap; b.y += ny * overlap;
            } else if (bFixed && !aFixed) {
              a.x -= nx * overlap; a.y -= ny * overlap;
            } else if (!aFixed && !bFixed) {
              a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
              b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
            }
            // Velocity reflection (impulse, equal mass)
            const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;
            if (velAlongNormal < 0) {
              const j = -(1 + e) * velAlongNormal / 2;
              if (!aFixed) { a.vx -= j * nx; a.vy -= j * ny; }
              if (!bFixed) { b.vx += j * nx; b.vy += j * ny; }
            }
          }
        }
      }
    }
  }

  // ---------- Background ----------
  const SPOTS = [];
  for (let i = 0; i < 7; i++) {
    SPOTS.push({
      ax: 0.15 + Math.random() * 0.7,
      ay: 0.15 + Math.random() * 0.7,
      ox1: 0.12 + Math.random() * 0.18,
      oy1: 0.12 + Math.random() * 0.18,
      ox2: 0.04 + Math.random() * 0.08,
      oy2: 0.04 + Math.random() * 0.08,
      w1: 0.10 + Math.random() * 0.18,
      w2: 0.05 + Math.random() * 0.10,
      phx: Math.random() * Math.PI * 2,
      phy: Math.random() * Math.PI * 2,
      r: 0.32 + Math.random() * 0.30,
    });
  }

  // ---------- Anatomy decor (used by anatomy themes) ----------
  // Called from drawBackground inside the camera transform; world coords.
  function drawAnatomyDecor(ts, decor, wx, wy, ww, wh) {
    const t = ts * 0.001 * S.bgFlowSpeed;
    const W2 = ww || W, H2 = wh || H;
    const sc = camera.scale;
    switch (decor) {
      case 'lymphocytes': {
        const N = 22;
        ctx.lineWidth = 1.4 / sc;
        for (let i = 0; i < N; i++) {
          const seed = i * 1.31;
          const fx = ((i / N) + 0.05 * Math.sin(t + seed)) % 1;
          const fy = (frac(seed * 0.7 + t * 0.3 + i * 0.13)) % 1;
          const px = fx * W; const py = fy * H;
          const r = 7 + 6 * frac(seed * 0.21);
          ctx.fillStyle = 'rgba(220,200,255,0.18)';
          ctx.strokeStyle = 'rgba(180,160,220,0.35)';
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = 'rgba(120,80,160,0.30)';
          ctx.beginPath(); ctx.arc(px - r * 0.2, py - r * 0.1, r * 0.45, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'lobules': {
        const N = 18;
        ctx.lineWidth = 1 / sc;
        ctx.strokeStyle = 'rgba(180,80,90,0.22)';
        for (let i = 0; i < N; i++) {
          const seed = i * 1.7;
          const px = frac(seed) * W;
          const py = frac(seed * 1.7) * H;
          const r = 30 + 20 * frac(seed * 0.31);
          const wob = Math.sin(t * 0.4 + seed) * 0.05;
          ctx.beginPath();
          for (let j = 0; j <= 6; j++) {
            const a = j * Math.PI / 3 + seed + wob;
            const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath(); ctx.stroke();
        }
        break;
      }
      case 'matrix': {
        ctx.strokeStyle = 'rgba(255,200,140,0.10)';
        ctx.lineWidth = 1 / sc;
        const step = 28;
        for (let x = 0; x < W; x += step) {
          const wob = Math.sin((x + t * 30) * 0.05) * 6;
          ctx.beginPath(); ctx.moveTo(x + wob, 0); ctx.lineTo(x - wob, H); ctx.stroke();
        }
        // Subtle horizontal cross-ties
        ctx.strokeStyle = 'rgba(255,200,140,0.06)';
        for (let y = 40; y < H; y += 80) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        break;
      }
      case 'pulse': {
        const cx = W / 2, cy = H / 2;
        ctx.strokeStyle = 'rgba(255,80,90,0.22)';
        ctx.lineWidth = 2 / sc;
        for (let i = 0; i < 5; i++) {
          const phase = ((t * 0.6 + i * 0.2) % 1);
          const r = phase * Math.max(W, H) * 0.55;
          const a = 1 - phase;
          ctx.globalAlpha = a * 0.6;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'villi': {
        ctx.fillStyle = 'rgba(220,140,140,0.20)';
        const N = 24;
        for (let i = 0; i < N; i++) {
          const x = (i + 0.5) * W / N;
          const wob = Math.sin(t * 1.4 + i * 0.7) * 5;
          const len = 30 + 12 * Math.sin(t * 1.0 + i);
          ctx.beginPath();
          ctx.ellipse(x + wob, len * 0.5, 11, len, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath();
          ctx.ellipse(x - wob, H - len * 0.5, 11, len, 0, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'alveoli': {
        ctx.strokeStyle = 'rgba(140,180,230,0.30)';
        ctx.lineWidth = 1 / sc;
        const N = 36;
        for (let i = 0; i < N; i++) {
          const seed = i * 2.31;
          const px = frac(seed) * W;
          const py = frac(seed * 1.31) * H;
          const r = 20 + 16 * Math.abs(Math.sin(t * 0.6 + seed));
          ctx.fillStyle = 'rgba(180,210,255,0.18)';
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        break;
      }
      case 'neurons': {
        const N = 16;
        ctx.lineWidth = 1.5 / sc;
        for (let i = 0; i < N; i++) {
          const seed = i * 1.7;
          const x1 = frac(seed) * W, y1 = frac(seed * 1.31) * H;
          const x2 = frac(seed * 2.3) * W, y2 = frac(seed * 1.7) * H;
          const flash = (Math.sin(t * 2 + seed) + 1) / 2;
          ctx.strokeStyle = `rgba(255,210,255,${0.10 + flash * 0.30})`;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          // Glowing nodes
          ctx.fillStyle = `rgba(255,230,255,${0.20 + flash * 0.5})`;
          ctx.beginPath(); ctx.arc(x1, y1, 3 / sc + flash * 2 / sc, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'tubules': {
        ctx.strokeStyle = 'rgba(255,150,120,0.22)';
        ctx.lineWidth = 2 / sc;
        const N = 12;
        for (let i = 0; i < N; i++) {
          const seed = i * 1.9;
          const x1 = frac(seed) * W;
          const cyy = frac(seed * 1.7) * H;
          ctx.beginPath();
          ctx.moveTo(x1, 0);
          ctx.bezierCurveTo(
            x1 + 60 + 30 * Math.sin(t + seed), cyy * 0.4,
            x1 - 60 - 30 * Math.cos(t + seed), cyy * 0.7,
            x1, H
          );
          ctx.stroke();
        }
        break;
      }
      case 'hair': {
        ctx.strokeStyle = 'rgba(120,80,40,0.45)';
        ctx.lineWidth = 1.2 / sc;
        const N = 56;
        for (let i = 0; i < N; i++) {
          const seed = i * 1.3;
          const px = frac(seed) * W;
          const py = frac(seed * 1.71) * H;
          const len = 22 + 12 * frac(seed * 0.7);
          const wob = Math.sin(t * 1.0 + seed) * 0.4;
          const tipX = px + Math.sin(wob) * len;
          const tipY = py - Math.cos(wob) * len;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + Math.sin(wob) * len * 0.5, py - len * 0.5, tipX, tipY);
          ctx.stroke();
          // Follicle dot
          ctx.fillStyle = 'rgba(60,30,15,0.6)';
          ctx.beginPath(); ctx.arc(px, py, 2 / sc, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
    }
  }

  function drawBackground(ts) {
    const theme = currentTheme();
    const bg = theme.bg;

    // Base fill
    if (bg.kind === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, bg.topColor);
      g.addColorStop(1, bg.botColor);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = bg.base;
    }
    ctx.fillRect(0, 0, W, H);

    // World-space layer: spots / rings / RBC silhouettes follow the camera so
    // panning + zooming feels like moving through a real environment.
    ctx.save();
    ctx.transform(camera.scale, 0, 0, camera.scale, camera.tx, camera.ty);
    // Visible world rectangle (so fillRects cover the viewport at any zoom)
    const wx = -camera.tx / camera.scale;
    const wy = -camera.ty / camera.scale;
    const ww = W / camera.scale;
    const wh = H / camera.scale;

    // Petri dish concentric rings (centred at world origin (W/2, H/2))
    if (bg.kind === 'agar') {
      ctx.save();
      ctx.strokeStyle = bg.ringColor || 'rgba(120,80,30,0.10)';
      ctx.lineWidth = 1 / camera.scale;
      const cx = W / 2, cy = H / 2;
      const maxR = Math.hypot(W, H) * 0.9;
      for (let r = 32; r < maxR; r += 32) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Drifting red blood cell silhouettes (Bloodstream)
    if (bg.rbcSilhouettes) {
      ctx.save();
      const t2 = ts * 0.00025 * S.bgFlowSpeed;
      const N = 22;
      ctx.lineWidth = 1.4 / camera.scale;
      for (let i = 0; i < N; i++) {
        const seed = i * 1.31;
        const fx = ((i / N) + 0.06 * Math.sin(t2 + seed)) % 1;
        const fy = (frac(seed * 0.7 + t2 * 0.6 + i * 0.13)) % 1;
        const px = fx * W;
        const py = fy * H;
        const r = 18 + 16 * frac(seed * 0.21);
        ctx.fillStyle = 'rgba(255,90,90,0.10)';
        ctx.strokeStyle = 'rgba(255,140,140,0.18)';
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.78, seed, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(120,20,20,0.18)';
        ctx.beginPath();
        ctx.arc(px, py, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Anatomy decor — drawn under the spots so the light wash reads on top.
    if (bg.decor) drawAnatomyDecor(ts, bg.decor, wx, wy, ww, wh);

    // Cyber Grid lines (drawn before the spots so spots glow on top)
    if (bg.kind === 'cybergrid') {
      ctx.save();
      const step = bg.gridStep || 48;
      ctx.strokeStyle = bg.gridColor || 'rgba(0,255,170,0.15)';
      ctx.lineWidth = 1 / camera.scale;
      // Snap grid to world units
      const x0 = Math.floor(wx / step) * step;
      const y0 = Math.floor(wy / step) * step;
      ctx.beginPath();
      for (let x = x0; x < wx + ww + step; x += step) { ctx.moveTo(x, wy); ctx.lineTo(x, wy + wh); }
      for (let y = y0; y < wy + wh + step; y += step) { ctx.moveTo(wx, y); ctx.lineTo(wx + ww, y); }
      ctx.stroke();
      ctx.restore();
    }

    // Drifting light spots
    const t = ts * 0.001 * S.bgFlowSpeed;
    const count = Math.min(SPOTS.length, bg.spotCount || SPOTS.length);
    const spotCols = Array.isArray(bg.spotColors) ? bg.spotColors : null;
    const fallbackCol = bg.spotColor || 'rgba(255,255,255,0.10)';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const s = SPOTS[i];
      const cx = (s.ax
        + s.ox1 * Math.sin(t * s.w1 + s.phx)
        + s.ox2 * Math.sin(t * s.w1 * 2.3 + s.phx * 0.7)) * W;
      const cy = (s.ay
        + s.oy1 * Math.cos(t * s.w2 + s.phy)
        + s.oy2 * Math.sin(t * s.w2 * 1.7 + s.phy * 1.3)) * H;
      const radius = s.r * Math.max(W, H);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      const col = spotCols ? spotCols[i % spotCols.length] : fallbackCol;
      grad.addColorStop(0, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(wx, wy, ww, wh);
    }
    ctx.restore();
    ctx.restore();

    // Vignette
    if (bg.vignette > 0) {
      const pulse = 0.92 + 0.08 * Math.sin(ts * 0.0006);
      const vg = ctx.createLinearGradient(0, 0, 0, H);
      const a = bg.vignette * pulse;
      vg.addColorStop(0, `rgba(0,0,0,${a})`);
      vg.addColorStop(0.5, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- Metaball mask ----------
  // Each cell renders as one or two "shapes" (two while splitting). Each shape
  // is a wobbly closed polygon filled hard-white onto the offscreen, then
  // blur+contrast carves the metaball edge. Hard fills + 'source-over' avoid
  // the outward bleed that radial gradients had between neighbouring cells.

  function inView(x, y, r) {
    // Frustum check in screen space; cull cells that don't touch the viewport.
    const sx = x * camera.scale + camera.tx;
    const sy = y * camera.scale + camera.ty;
    const sr = (r + 12) * camera.scale; // small slack so spikes/cilia stay visible
    return sx + sr >= 0 && sx - sr <= W && sy + sr >= 0 && sy - sr <= H;
  }

  function getShapes(t) {
    const out = [];
    for (const c of cells) {
      if (c.state === 'SPLITTING') {
        const p = c.splitProgress;
        const half = c.r * (0.05 + p * 1.15); // 0.1r..2.4r total separation
        const a = c.splitAngle;
        const dx = Math.cos(a) * half;
        const dy = Math.sin(a) * half;
        const rr = c.r * (1.0 - p * 0.05);
        // Cull only when both halves are off-screen.
        if (!inView(c.x - dx, c.y - dy, rr) && !inView(c.x + dx, c.y + dy, rr)) continue;
        out.push({ x: c.x - dx, y: c.y - dy, r: rr, cell: c });
        out.push({ x: c.x + dx, y: c.y + dy, r: rr, cell: c });
      } else {
        if (!inView(c.x, c.y, c.r * 1.6)) continue;
        out.push({ x: c.x, y: c.y, r: c.r, cell: c });
      }
    }
    return out;
  }

  function wobbleAt(c, theta, t) {
    // Two harmonics + slow precession give an organic, non-spinning jiggle.
    const s = c.wobbleSeed;
    const w1 = Math.sin(t * 0.55 * c.wobbleFreq + theta * 3 + s);
    const w2 = Math.sin(t * 0.85 * c.wobbleFreq + theta * 5 + s * 1.31 + c.phase);
    const mul = (CELL_TYPES[c.type] && CELL_TYPES[c.type].field && CELL_TYPES[c.type].field.wobbleMul) || 1;
    return (S.wobbleAmp || 0) * mul * (w1 * 0.65 + w2 * 0.45);
  }

  // Returns the world-space (x,y) of a vertex on the cell's outline at angle theta.
  // Used by the metaball polygon and decoration passes so spikes/cilia/etc.
  // align exactly with the wobbly membrane.
  function shapeVertex(s, theta, t) {
    const c = s.cell;
    const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
    const kind = (type.body && type.body.kind) || 'round';
    const aspect = (type.body && type.body.aspect) || 1.0;
    const seed = c.wobbleSeed;
    const phi = c.phase;

    // Per-type radius modulation (relative to s.r)
    let scale = 1;
    switch (kind) {
      case 'lobed':
        scale = 1
          + 0.16 * Math.sin(3 * theta + phi)
          + 0.08 * Math.sin(5 * theta + phi * 1.7);
        break;
      case 'rippled':
        scale = 1
          + 0.04 * Math.sin(24 * theta + phi)
          + 0.015 * Math.sin(8 * theta + phi * 0.7);
        break;
      case 'pseudopod':
        scale = 1
          + 0.20 * Math.sin(3 * theta + 0.8 * t * c.wobbleFreq + phi)
          + 0.06 * Math.sin(5 * theta - 0.5 * t * c.wobbleFreq + seed);
        break;
      case 'star': {
        // 10-pointed soft star
        const N = 10;
        scale = 0.85 + 0.45 * Math.abs(Math.sin((N / 2) * theta + phi));
        break;
      }
      case 'oblong':
      case 'round':
      default:
        scale = 1 + wobbleAt(c, theta, t);
    }

    // Shared subtle wobble layered on top of all kinds (except `star` which has its own profile)
    if (kind !== 'star' && kind !== 'lobed' && kind !== 'pseudopod') {
      scale += wobbleAt(c, theta, t) * 0.4;
    }

    // Apply per-type aspect along cell.orientation (for oblong / mast cell, etc.)
    let rx = Math.cos(theta) * s.r * scale;
    let ry = Math.sin(theta) * s.r * scale;
    if (aspect !== 1.0) {
      rx *= aspect;
      const cosA = Math.cos(c.orientation);
      const sinA = Math.sin(c.orientation);
      const ox = rx * cosA - ry * sinA;
      const oy = rx * sinA + ry * cosA;
      rx = ox; ry = oy;
    }
    return { x: s.x + rx, y: s.y + ry };
  }

  function drawMetaballMask(shapes, t) {
    // Each cell type gets its own metaball "field" (blur + contrast). Cells of
    // the same type still merge with one another (shared polygon pass), but
    // cells of different types render to distinct masks that are then unioned
    // — so a soft amoeboid macrophage and a crisp T-cell never share an edge.
    const ow = off.width, oh = off.height;
    const sx = ow / W;
    const cs = camera.scale, ctx_ = camera.tx, cty = camera.ty;
    const N = WOBBLE_VERTS;

    // Group shapes by cell.type
    const groups = {};
    for (const s of shapes) (groups[s.cell.type] ||= []).push(s);

    // Clear the master mask
    off2Ctx.setTransform(1, 0, 0, 1, 0, 0);
    off2Ctx.globalCompositeOperation = 'copy';
    off2Ctx.filter = 'none';
    off2Ctx.clearRect(0, 0, off2.width, off2.height);
    off2Ctx.globalCompositeOperation = 'source-over';

    for (const [typeKey, group] of Object.entries(groups)) {
      const field = (CELL_TYPES[typeKey] && CELL_TYPES[typeKey].field) || { blur: 6, contrast: 20 };

      // 1. Draw this group's polygons hard-white onto `off`
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
      offCtx.globalCompositeOperation = 'source-over';
      offCtx.filter = 'none';
      offCtx.clearRect(0, 0, ow, oh);
      offCtx.fillStyle = '#ffffff';
      for (const s of group) {
        offCtx.beginPath();
        for (let i = 0; i <= N; i++) {
          const theta = (i / N) * Math.PI * 2;
          const v = shapeVertex(s, theta, t);
          const px = (v.x * cs + ctx_) * sx;
          const py = (v.y * cs + cty) * sx;
          if (i === 0) offCtx.moveTo(px, py);
          else offCtx.lineTo(px, py);
        }
        offCtx.closePath();
        offCtx.fill();
      }

      // 2. Apply this type's filter in-place (off → off, with copy)
      offCtx.globalCompositeOperation = 'copy';
      offCtx.filter = `blur(${field.blur}px) contrast(${field.contrast})`;
      offCtx.drawImage(off, 0, 0);
      offCtx.filter = 'none';
      offCtx.globalCompositeOperation = 'source-over';

      // 3. Union the group mask into off2
      off2Ctx.globalCompositeOperation = 'source-over';
      off2Ctx.drawImage(off, 0, 0);
    }
  }

  function tintMask(color) {
    // Re-uses `off` as scratch, leaving `off2` (mask) intact.
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'copy';
    offCtx.filter = 'none';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-in';
    if (typeof color === 'function') {
      color(offCtx, off.width, off.height);
    } else {
      offCtx.fillStyle = color;
      offCtx.fillRect(0, 0, off.width, off.height);
    }
    offCtx.globalCompositeOperation = 'source-over';
  }

  function drawMetaballToMain(shapes, t) {
    const theme = currentTheme();
    const px = S.outlinePx;

    // ----- Outline pass: solid offset blits in the theme's outline colour
    // Glow themes (Neon Bloom, Aquatic Glow) layer a shadowBlur halo around
    // the same offsets, then darken the inner body so cell colours read.
    const offsets = [
      [-px, 0], [px, 0], [0, -px], [0, px],
      [-px, -px], [px, px], [-px, px], [px, -px],
    ];
    if (theme.outline.glow) {
      tintMask(theme.outline.glow);
      ctx.save();
      ctx.shadowColor = theme.outline.glow;
      ctx.shadowBlur = theme.outline.glowBlur || 14;
      for (const [dx, dy] of offsets) {
        ctx.drawImage(off, 0, 0, off.width, off.height, dx, dy, W, H);
      }
      ctx.restore();
      // Dark inner body
      tintMask(theme.outline.color);
      ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
    } else {
      tintMask(theme.outline.color);
      for (const [dx, dy] of offsets) {
        ctx.drawImage(off, 0, 0, off.width, off.height, dx, dy, W, H);
      }
    }

    // ----- Per-cell cytoplasm fill: each cell paints its own gradient as a
    // disk (arc+fill, NOT fillRect — the rectangle bleed used to leak the
    // gradient's last colour into the corners of the cell's bounding box and
    // overwrite a neighbour's interior).
    // The user-selected blend mode (multiply, screen, …) decides what happens
    // where two cells overlap inside the metaball mask.
    const sx = off.width / W;
    const cs = camera.scale, cTx = camera.tx, cTy = camera.ty;
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.filter = 'none';
    offCtx.clearRect(0, 0, off.width, off.height);
    offCtx.globalCompositeOperation = S.blendMode || 'source-over';
    for (const cell of cells) {
      const subs = (cell.state === 'SPLITTING')
        ? splitVirtualCenters(cell)
        : [{ x: cell.x, y: cell.y, r: cell.r }];
      const cc = cellColors(cell);
      for (const b of subs) {
        const cx = (b.x * cs + cTx) * sx;
        const cy = (b.y * cs + cTy) * sx;
        // 1.95 covers the worst-case extent (capsule mast / star platelet /
        // lobed neutrophil / pseudopod macrophage). Round cells look the same
        // as before because the gradient holds cytoBot from 0.55 outward and
        // only fades to fully-transparent at the disk edge — so the cell's
        // edge keeps its colour instead of going black.
        const r = b.r * 1.95 * cs * sx;
        const g = offCtx.createRadialGradient(cx, cy - r * 0.18, 0, cx, cy, r);
        g.addColorStop(0,    cc.cytoTop);
        g.addColorStop(0.55, cc.cytoBot);
        g.addColorStop(1,    hexToRgba(cc.cytoBot, 0));
        offCtx.fillStyle = g;
        offCtx.beginPath();
        offCtx.arc(cx, cy, r, 0, Math.PI * 2);
        offCtx.fill();
      }
    }
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);

    // ----- Inner highlight per cell (top-left soft glow), clipped to mask
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.clearRect(0, 0, off.width, off.height);
    for (const cell of cells) {
      const subs = (cell.state === 'SPLITTING')
        ? splitVirtualCenters(cell)
        : [{ x: cell.x, y: cell.y, r: cell.r }];
      const cc = cellColors(cell);
      for (const b of subs) {
        const x = ((b.x - b.r * 0.35) * cs + cTx) * sx;
        const y = ((b.y - b.r * 0.45) * cs + cTy) * sx;
        const r = b.r * 0.75 * cs * sx;
        const g = offCtx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, cc.nucleusHi);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = g;
        offCtx.beginPath();
        offCtx.arc(x, y, r, 0, Math.PI * 2);
        offCtx.fill();
      }
    }
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
    ctx.globalAlpha = 1.0;

    // Per-cell granules (drawn through the mask so dots stay inside the membrane)
    drawGranules(shapes, theme, t);

    // Per-type decorations (spikes, tendrils, Y-receptors) on top of the cytoplasm
    drawDecorations(shapes, theme, t);
  }

  function splitVirtualCenters(c) {
    const p = c.splitProgress;
    const half = c.r * (0.05 + p * 1.15);
    const a = c.splitAngle;
    const dx = Math.cos(a) * half, dy = Math.sin(a) * half;
    const rr = c.r * (1.0 - p * 0.05);
    return [{ x: c.x - dx, y: c.y - dy, r: rr }, { x: c.x + dx, y: c.y + dy, r: rr }];
  }

  // ---------- Decorations (per cell type) ----------
  function withCameraCtx(fn) {
    ctx.save();
    ctx.transform(camera.scale, 0, 0, camera.scale, camera.tx, camera.ty);
    try { fn(); } finally { ctx.restore(); }
  }

  function drawDecorations(shapes, theme, t) {
    withCameraCtx(() => {
      for (const s of shapes) {
        const c = s.cell;
        const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
        const kind = (type.decoration && type.decoration.kind) || 'none';
        switch (kind) {
          case 'bigSpikes':       drawBigSpikes(s, theme, t); break;
          case 'spikesPulsing':   drawSpikesPulsing(s, theme, t); break;
          case 'tendrils':        drawTendrils(s, theme, t); break;
          case 'tentaclesWiggling': drawTentaclesWiggling(s, theme, t); break;
          case 'flagellum':       drawFlagellum(s, theme, t); break;
          case 'drips':           drawDrips(s, theme, t); break;
          case 'legs':            drawLegs(s, theme, t); break;
          case 'fuzz':            drawFuzz(s, theme, t); break;
          case 'yReceptorsFew':   drawYReceptors(s, theme, t, 6); break;
          case 'yReceptorsMany':  drawYReceptors(s, theme, t, 14); break;
          case 'none':
          default: break;
        }
      }
    });
  }

  function drawBigSpikes(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 8;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, px * 0.7) / camera.scale;
    ctx.strokeStyle = theme.outline.color;
    ctx.fillStyle = cc.accent;
    const tipLen = s.r * 0.55;
    const baseHalf = s.r * 0.09;
    // Irregular angular jitter keyed off cell.id
    for (let i = 0; i < N; i++) {
      const jitter = (frac(c.id * 0.31 + i * 0.71) - 0.5) * 0.25;
      const theta = (i / N) * Math.PI * 2 + jitter;
      const base = shapeVertex(s, theta, t);
      const tx = base.x + Math.cos(theta) * tipLen;
      const ty = base.y + Math.sin(theta) * tipLen;
      ctx.beginPath();
      ctx.moveTo(
        base.x + Math.cos(theta + Math.PI / 2) * baseHalf,
        base.y + Math.sin(theta + Math.PI / 2) * baseHalf
      );
      ctx.lineTo(tx, ty);
      ctx.lineTo(
        base.x + Math.cos(theta - Math.PI / 2) * baseHalf,
        base.y + Math.sin(theta - Math.PI / 2) * baseHalf
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTendrils(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 13;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, px * 0.5) / camera.scale;
    ctx.strokeStyle = cc.cytoBot;
    for (let i = 0; i < N; i++) {
      const baseAng = (i / N) * Math.PI * 2 + c.phase;
      const base = shapeVertex(s, baseAng, t);
      const len = s.r * (1.1 + 0.4 * frac(c.id * 0.13 + i * 0.7));
      // Curving Bezier outward, with a time-based wiggle.
      const sway = 0.4 * Math.sin(t * 0.9 + i * 1.3 + c.wobbleSeed);
      const tipAng = baseAng + sway * 0.4;
      const tipX = base.x + Math.cos(tipAng) * len;
      const tipY = base.y + Math.sin(tipAng) * len;
      const ctrlAng = baseAng + sway;
      const ctrlR = len * 0.6;
      const cpX = base.x + Math.cos(ctrlAng) * ctrlR;
      const cpY = base.y + Math.sin(ctrlAng) * ctrlR;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawYReceptors(s, theme, t, count) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, px * 0.4) / camera.scale;
    ctx.strokeStyle = cc.accent;
    const stem = s.r * 0.22;
    const arms = s.r * 0.13;
    const armSpread = Math.PI * 0.25;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + c.phase;
      const base = shapeVertex(s, theta, t);
      const tipX = base.x + Math.cos(theta) * stem;
      const tipY = base.y + Math.sin(theta) * stem;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tipX, tipY);
      const lAng = theta + armSpread;
      const rAng = theta - armSpread;
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(lAng) * arms, tipY + Math.sin(lAng) * arms);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(rAng) * arms, tipY + Math.sin(rAng) * arms);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Animated baddie decorations ----------
  function drawSpikesPulsing(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 10;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, px * 0.7) / camera.scale;
    ctx.strokeStyle = theme.outline.color;
    ctx.fillStyle = cc.accent;
    const baseHalf = s.r * 0.09;
    for (let i = 0; i < N; i++) {
      const jitter = (frac(c.id * 0.31 + i * 0.71) - 0.5) * 0.18;
      const theta = (i / N) * Math.PI * 2 + jitter;
      const tipLen = s.r * (0.45 + 0.18 * Math.sin(t * 2.5 + i * 0.7 + (c.wobbleSeed || 0)));
      const base = shapeVertex(s, theta, t);
      const tipX = base.x + Math.cos(theta) * tipLen;
      const tipY = base.y + Math.sin(theta) * tipLen;
      ctx.beginPath();
      ctx.moveTo(
        base.x + Math.cos(theta + Math.PI / 2) * baseHalf,
        base.y + Math.sin(theta + Math.PI / 2) * baseHalf
      );
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(
        base.x + Math.cos(theta - Math.PI / 2) * baseHalf,
        base.y + Math.sin(theta - Math.PI / 2) * baseHalf
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTentaclesWiggling(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 6;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, px * 0.7) / camera.scale;
    ctx.strokeStyle = cc.cytoBot;
    for (let i = 0; i < N; i++) {
      const baseAng = (i / N) * Math.PI * 2 + c.phase;
      const base = shapeVertex(s, baseAng, t);
      const len = s.r * (1.0 + 0.5 * frac(c.id * 0.13 + i * 0.7));
      const sway = 0.7 * Math.sin(t * 1.6 + i * 1.3 + c.wobbleSeed);
      const curl = 0.6 * Math.sin(t * 1.1 + i * 0.5);
      const midAng = baseAng + sway;
      const midX = base.x + Math.cos(midAng) * len * 0.6;
      const midY = base.y + Math.sin(midAng) * len * 0.6;
      const tipAng = baseAng + sway + curl;
      const tipX = base.x + Math.cos(tipAng) * len;
      const tipY = base.y + Math.sin(tipAng) * len;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(midX, midY, tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFlagellum(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const ang = (c.orientation || 0) + Math.PI;
    // Tail starts at the cell's "back" along orientation+π
    const startV = shapeVertex(s, ang, t);
    const dirX = Math.cos(ang), dirY = Math.sin(ang);
    const perpX = -dirY, perpY = dirX;
    const length = s.r * 1.6;
    const N = 24;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, px * 0.6) / camera.scale;
    ctx.strokeStyle = cc.accent;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N;                                        // 0..1 along tail
      const along = length * u;
      const wave = Math.sin(u * Math.PI * 3 - t * 6) * (s.r * 0.18) * u;
      const x = startV.x + dirX * along + perpX * wave;
      const y = startV.y + dirY * along + perpY * wave;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawDrips(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const N = 5;
    ctx.save();
    ctx.fillStyle = cc.cytoBot;
    ctx.strokeStyle = theme.outline.color;
    ctx.lineWidth = Math.max(1.5, S.outlinePx * 0.5) / camera.scale;
    for (let i = 0; i < N; i++) {
      // Drips hang from the bottom-arc of the cell (theta from ~50° to 130°)
      const theta = (Math.PI * 0.30) + (i / (N - 1)) * (Math.PI * 0.40);   // 0.30π..0.70π
      const ang = Math.PI * 0.5 + theta - Math.PI * 0.5;                    // re-centered around 0.5π (down)
      const dirAng = Math.PI * 0.5 - 0.40 + (i / (N - 1)) * 0.80;          // sweep around straight-down
      const base = shapeVertex(s, dirAng, t);
      const drop = s.r * 0.22 + s.r * 0.06 * Math.sin(t * 1.8 + i);
      const tipX = base.x;
      const tipY = base.y + drop;
      ctx.beginPath();
      ctx.moveTo(base.x - s.r * 0.06, base.y);
      ctx.quadraticCurveTo(base.x, tipY + drop * 0.2, base.x + s.r * 0.06, base.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // small bobbing droplet below
      const bobY = tipY + s.r * 0.10 + s.r * 0.05 * Math.sin(t * 2.2 + i * 0.7);
      ctx.beginPath();
      ctx.arc(tipX, bobY, s.r * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLegs(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 10;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, px * 0.6) / camera.scale;
    ctx.strokeStyle = theme.outline.color;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const wiggle = 0.25 * Math.sin(t * 6 + i * 0.8);
      const base = shapeVertex(s, theta, t);
      const dir = theta + wiggle;
      const len = s.r * 0.4;
      const kneeX = base.x + Math.cos(dir) * len * 0.55;
      const kneeY = base.y + Math.sin(dir) * len * 0.55;
      const tipX = base.x + Math.cos(dir + 0.3 * Math.sin(t * 5 + i)) * len;
      const tipY = base.y + Math.sin(dir + 0.3 * Math.sin(t * 5 + i)) * len;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFuzz(s, theme, t) {
    const c = s.cell;
    const cc = cellColors(c);
    const px = S.outlinePx;
    const N = 22;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.4, px * 0.4) / camera.scale;
    ctx.strokeStyle = cc.accent;
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const base = shapeVertex(s, theta, t);
      const len = s.r * (0.18 + 0.10 * Math.sin(t * 1.2 + i * 0.7));
      const tipX = base.x + Math.cos(theta) * len;
      const tipY = base.y + Math.sin(theta) * len;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Granules ----------
  // Per-cell dot pattern drawn through the metaball mask so granules can never
  // spill outside the membrane. Each cell's granules use that cell's own
  // nucleus colour (so granules read as the same family as the nucleus).
  function drawGranules(shapes, theme, t) {
    const anyGranules = shapes.some(s => {
      const type = CELL_TYPES[s.cell.type] || CELL_TYPES.neutrophil;
      return (type.granules || 0) > 0;
    });
    if (!anyGranules) return;

    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.filter = 'none';
    offCtx.clearRect(0, 0, off.width, off.height);

    const sx = off.width / W;
    const cs = camera.scale, cTx = camera.tx, cTy = camera.ty;
    for (const s of shapes) {
      const c = s.cell;
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      const N = type.granules || 0;
      if (N === 0) continue;
      const seed = c.id * 9.7 + (c.wobbleSeed || 0);
      const isBig = c.type === 'basophil';
      const baseSize = isBig ? 0.115 : 0.05;
      const sizeJitter = isBig ? 0.05 : 0.04;
      const cc = cellColors(c);
      offCtx.fillStyle = cc.nucleus;
      offCtx.globalAlpha = isBig ? 0.85 : 0.55;
      for (let i = 0; i < N; i++) {
        const ang = frac(seed * 1.3 + i * 0.61) * Math.PI * 2;
        const rRel = 0.05 + 0.85 * Math.sqrt(frac(seed + i * 0.317));
        const wob = 0.04 * Math.sin(t * 0.5 + i + seed);
        const wx = s.x + Math.cos(ang) * s.r * (rRel + wob);
        const wy = s.y + Math.sin(ang) * s.r * (rRel + wob);
        const x = (wx * cs + cTx) * sx;
        const y = (wy * cs + cTy) * sx;
        const r = s.r * (baseSize + sizeJitter * frac(seed * 1.7 + i * 0.13)) * cs * sx;
        offCtx.beginPath();
        offCtx.arc(x, y, r, 0, Math.PI * 2);
        offCtx.fill();
      }
    }
    offCtx.globalAlpha = 1;

    // Clip to mask
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(off2, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
  }

  function frac(v) { return v - Math.floor(v); }

  // Convert "#rrggbb" / "#rgb" to rgba(r,g,b,alpha). Used so cytoplasm gradients
  // can fade to transparent at the disk edge without picking up a hard cytoBot.
  function hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return `rgba(0,0,0,${alpha})`;
    let s = hex.trim().replace(/^#/, '');
    if (s.length === 3) s = s.split('').map(c => c + c).join('');
    if (s.length !== 6) return hex;
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ---------- Nuclei ----------
  // ---------- Cartoon faces ----------
  // Per-type face configs. Eyes / pupils sized as a fraction of cell.r.
  // Mouths: smile / frown / snarl / fangs / tongue / drool / none.
  const FACE = {
    default:    { eyes: 2, eyeR: 0.18, eyeY: -0.10, pupilR: 0.07, mouth: 'smile' },
    // Good guys default smile; ignore individual overrides for now.
    macrophage: { eyes: 2, eyeR: 0.18, eyeY: -0.06, pupilR: 0.07, mouth: 'smile' },
    nk:         { eyes: 2, eyeR: 0.16, eyeY: -0.10, pupilR: 0.06, mouth: 'snarl' },
    mast:       { eyes: 2, eyeR: 0.14, eyeY: -0.08, pupilR: 0.05, mouth: 'smile' },
    platelet:   { eyes: 0,                                          mouth: 'none' },
    // Baddies — meaner expressions.
    virus:      { eyes: 2, eyeR: 0.16, eyeY: -0.12, pupilR: 0.06, mouth: 'fangs' },
    germ:       { eyes: 2, eyeR: 0.16, eyeY: -0.10, pupilR: 0.06, mouth: 'snarl' },
    bacterium:  { eyes: 1, eyeR: 0.18, eyeY: -0.06, pupilR: 0.07, mouth: 'tongue' },
    amoebaP:    { eyes: 2, eyeR: 0.15, eyeY: -0.06, pupilR: 0.06, mouth: 'fangs' },
    slime:      { eyes: 2, eyeR: 0.18, eyeY: -0.04, pupilR: 0.07, mouth: 'drool' },
    mite:       { eyes: 2, eyeR: 0.13, eyeY: -0.10, pupilR: 0.05, mouth: 'snarl' },
    spore:      { eyes: 1, eyeR: 0.20, eyeY: -0.06, pupilR: 0.08, mouth: 'frown' },
    toxin:      { eyes: 0,                                          mouth: 'none' },
  };

  function drawCartoonFaces(shapes, t) {
    if (!S.cartoon || shapes.length === 0) return;
    withCameraCtx(() => {
      const theme = currentTheme();
      const now = performance.now();
      const lw = Math.max(1.5, S.outlinePx * 0.6) / camera.scale;

      for (const s of shapes) {
        const c = s.cell;
        const cfg = FACE[c.type] || FACE.default;
        if (!cfg.eyes && cfg.mouth === 'none') continue;

        // Blink animation: when nextBlink fires, eyes squint for ~120ms then re-arm.
        if (now > c.nextBlink) c.nextBlink = now + 120 + 3000 + Math.random() * 3500;
        const blinkEnd = c.nextBlink - (3000 + 3500); // start of blink in worst case approx
        const blinking = (c.nextBlink - now) < 120 && (c.nextBlink - now) > 0;

        const cx = c.x;
        const cy = c.y;

        // Pupils look toward velocity (or alarmTarget if alarmed)
        let lookX = c.vx, lookY = c.vy;
        if (c.alarmTimer > 0 && c.alarmTarget && c.alarmTarget.state === 'NORMAL') {
          lookX = c.alarmTarget.x - cx;
          lookY = c.alarmTarget.y - cy;
        }
        const lm = Math.hypot(lookX, lookY) || 1;

        ctx.save();
        ctx.lineWidth = lw;
        ctx.strokeStyle = theme.outline.color;

        if (cfg.eyes >= 1) {
          const eyeR = c.r * cfg.eyeR;
          const eyeY = cy + c.r * cfg.eyeY;
          const pupilR = c.r * cfg.pupilR;
          const pupilOff = eyeR * 0.45;
          const pdx = (lookX / lm) * pupilOff;
          const pdy = (lookY / lm) * pupilOff;
          const eyeXs = cfg.eyes === 2
            ? [cx - c.r * 0.22, cx + c.r * 0.22]
            : [cx];
          for (const ex of eyeXs) {
            // Eye white
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            if (blinking) {
              // Squint: thin horizontal slit
              ctx.ellipse(ex, eyeY, eyeR, eyeR * 0.12, 0, 0, Math.PI * 2);
            } else {
              ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.stroke();
            // Pupil
            if (!blinking) {
              ctx.fillStyle = '#101218';
              ctx.beginPath();
              ctx.arc(ex + pdx, eyeY + pdy, pupilR, 0, Math.PI * 2);
              ctx.fill();
              // Glint
              ctx.fillStyle = 'rgba(255,255,255,0.85)';
              ctx.beginPath();
              ctx.arc(ex + pdx - pupilR * 0.35, eyeY + pdy - pupilR * 0.35, pupilR * 0.30, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        // Mouth
        if (cfg.mouth && cfg.mouth !== 'none') {
          const mY = cy + c.r * 0.18;
          const mW = c.r * 0.34;
          const cc = cellColors(c);
          ctx.lineWidth = lw * 1.3;
          ctx.strokeStyle = cc.nucleus;
          ctx.fillStyle = cc.nucleus;
          if (cfg.mouth === 'smile') {
            ctx.beginPath();
            ctx.arc(cx, mY - mW * 0.3, mW, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.stroke();
          } else if (cfg.mouth === 'frown') {
            ctx.beginPath();
            ctx.arc(cx, mY + mW * 0.6, mW, 1.12 * Math.PI, 1.88 * Math.PI);
            ctx.stroke();
          } else if (cfg.mouth === 'snarl') {
            // zig-zag teeth
            ctx.beginPath();
            const N = 5;
            for (let i = 0; i <= N; i++) {
              const x = cx - mW + (2 * mW) * (i / N);
              const y = mY + (i % 2 === 0 ? 0 : mW * 0.18);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          } else if (cfg.mouth === 'fangs') {
            // Open mouth + two fangs
            ctx.beginPath();
            ctx.ellipse(cx, mY, mW, mW * 0.45, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            // Fangs
            ctx.beginPath();
            ctx.moveTo(cx - mW * 0.55, mY - mW * 0.20);
            ctx.lineTo(cx - mW * 0.40, mY + mW * 0.45);
            ctx.lineTo(cx - mW * 0.25, mY - mW * 0.20);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(cx + mW * 0.25, mY - mW * 0.20);
            ctx.lineTo(cx + mW * 0.40, mY + mW * 0.45);
            ctx.lineTo(cx + mW * 0.55, mY - mW * 0.20);
            ctx.closePath();
            ctx.fill();
          } else if (cfg.mouth === 'tongue') {
            ctx.beginPath();
            ctx.ellipse(cx, mY, mW, mW * 0.40, 0, 0, Math.PI * 2);
            ctx.fill();
            // Tongue wags
            const wag = Math.sin(t * 5 + c.phase) * mW * 0.18;
            ctx.fillStyle = '#ff8aa0';
            ctx.beginPath();
            ctx.ellipse(cx + wag, mY + mW * 0.30, mW * 0.32, mW * 0.22, 0, 0, Math.PI * 2);
            ctx.fill();
          } else if (cfg.mouth === 'drool') {
            ctx.beginPath();
            ctx.arc(cx, mY - mW * 0.3, mW, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.stroke();
            // Drip below the smile
            const dripPhase = ((t * 0.6 + c.phase) % 1);
            const dripY = mY + mW * 0.25 + dripPhase * mW * 0.8;
            const dripA = 1 - dripPhase;
            ctx.fillStyle = `rgba(120, 220, 130, ${dripA})`;
            ctx.beginPath();
            ctx.ellipse(cx + mW * 0.25, dripY, mW * 0.10, mW * 0.16, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.restore();
      }
    });
  }

  // ---------- Selection ring + flash + target marker ----------
  function drawSelection(shapes, t) {
    const anyFlash = shapes.some(s => s.cell.flash);
    if (selectedCells.size === 0 && !anyFlash && !targetMarker) return;
    withCameraCtx(() => {
      // Selection rings: wobbly outline 10% outward in each cell's own colour.
      const N = WOBBLE_VERTS;
      for (const c of selectedCells) {
        if (c.state !== 'NORMAL') continue;
        const cc = cellColors(c);
        const inflated = { x: c.x, y: c.y, r: c.r * 1.10, cell: c };
        ctx.save();
        ctx.lineWidth = Math.max(2, S.outlinePx * 1.2) / camera.scale;
        ctx.strokeStyle = cc.cytoBot;
        ctx.shadowColor = cc.cytoBot;
        ctx.shadowBlur = 14 / camera.scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const theta = (i / N) * Math.PI * 2;
          const v = shapeVertex(inflated, theta, t);
          if (i === 0) ctx.moveTo(v.x, v.y);
          else ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      // Flash overlay (selection + tap-bad-flash): white wobbly fill, ~200 ms fade.
      for (const s of shapes) {
        const c = s.cell;
        if (!c.flash || c.flash <= 0) continue;
        const alpha = Math.min(1, c.flash / 0.2) * 0.6;
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const theta = (i / N) * Math.PI * 2;
          const v = shapeVertex(s, theta, t);
          if (i === 0) ctx.moveTo(v.x, v.y);
          else ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Target marker: fading circle at the commanded point + dashed lines from
      // every selected cell to the marker. Lifetime ~1500 ms.
      if (targetMarker) {
        const age = (performance.now() - targetMarker.t0) / 1500;
        if (age >= 1) {
          targetMarker = null;
        } else {
          const fade = 1 - age;
          ctx.save();
          ctx.globalAlpha = fade;
          ctx.lineWidth = 2 / camera.scale;
          ctx.setLineDash([8 / camera.scale, 6 / camera.scale]);
          ctx.lineDashOffset = -performance.now() * 0.04 / camera.scale;
          ctx.strokeStyle = '#ffffff';
          // Dashed lines from each selected cell to the target
          for (const c of selectedCells) {
            if (c.state !== 'NORMAL') continue;
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(targetMarker.x, targetMarker.y);
            ctx.stroke();
          }
          // Pulsing target ring
          ctx.setLineDash([]);
          const r = 18 / camera.scale * (1 + 0.4 * age);
          ctx.lineWidth = 3 / camera.scale;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(targetMarker.x, targetMarker.y, r, 0, Math.PI * 2);
          ctx.stroke();
          // Inner dot
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(targetMarker.x, targetMarker.y, 4 / camera.scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    });
  }

  function drawNuclei(ts) {
    const t = ts * 0.001;
    ctx.save();
    // Always slightly soft + translucent so nuclei read as organelles, not crisp disks.
    ctx.filter = 'blur(2px)';
    ctx.globalAlpha = 0.78;
    withCameraCtx(() => drawNucleiInner(ts, t));
    ctx.restore();
  }

  function drawNucleiInner(ts, t) {
    for (const c of cells) {
      const type = CELL_TYPES[c.type] || CELL_TYPES.neutrophil;
      if (type.nucleus.kind === 'none') continue;

      if (c.state === 'SPLITTING') {
        const p = c.splitProgress;
        const half = c.r * (0.1 + p * 1.0);
        const a = c.splitAngle;
        const cx = Math.cos(a) * half, cy = Math.sin(a) * half;
        const rr = c.r * NUCLEUS_RATIO * (1 - p * 0.2);
        const wob = 1.5 * (1 - p);
        drawNucleus(c,
          c.x - cx + Math.sin(t + c.phase) * wob,
          c.y - cy + Math.cos(t + c.phase * 0.7) * wob,
          rr);
        if (p > 0.04) {
          drawNucleus(c,
            c.x + cx + Math.sin(t + c.phase + 1.7) * wob,
            c.y + cy + Math.cos(t + c.phase * 0.7 + 1.7) * wob,
            rr);
        }
      } else {
        const wx = c.x + Math.sin(t + c.phase) * 1.8;
        const wy = c.y + Math.cos(t + c.phase * 0.7) * 1.8;
        drawNucleus(c, wx, wy, c.r * NUCLEUS_RATIO);
      }
    }
  }

  function drawNucleus(cell, x, y, r) {
    const theme = currentTheme();
    const cc = cellColors(cell);
    ctx.save();
    ctx.lineWidth = Math.max(2, S.outlinePx * 0.6) / camera.scale;
    ctx.strokeStyle = theme.outline.color;
    const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
    let kind = type.nucleus.kind;
    if (kind === 'round-small') { kind = 'round'; r *= 0.7; }

    ctx.fillStyle = cc.nucleus;

    if (kind === 'kidney') {
      // Outer arc + reversed bite arc to get a kidney/horseshoe shape with a
      // strokeable outline.
      const biteAngle = (cell.phase || 0);
      const biteOff = r * 0.6;
      const biteR = r * 0.85;
      const bx = x + Math.cos(biteAngle) * biteOff;
      const by = y + Math.sin(biteAngle) * biteOff;
      // Build the path using the boolean-like trick: fill the outer disk then
      // punch out the bite using destination-out, then re-stroke a precise path.
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(bx, by, biteR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Re-stroke: combine outer arc with reversed inner arc to make the kidney path.
      ctx.beginPath();
      // Find intersection-driven sub-arc angles. Approximate by sweeping.
      const dx = bx - x, dy = by - y;
      const d = Math.hypot(dx, dy);
      // The two circles intersect where r² and biteR² match the chord; if d is too
      // small we degenerate, so guard.
      if (d > 0.001 && d < r + biteR && d > Math.abs(r - biteR)) {
        const a = Math.acos((r * r - biteR * biteR + d * d) / (2 * r * d));
        const baseAng = Math.atan2(dy, dx);
        const start = baseAng + a;
        const end = baseAng + Math.PI * 2 - a;
        ctx.arc(x, y, r, start, end);
        const a2 = Math.acos((biteR * biteR - r * r + d * d) / (2 * biteR * d));
        const baseAng2 = Math.atan2(-dy, -dx);
        const start2 = baseAng2 - a2;
        const end2 = baseAng2 + a2;
        ctx.arc(bx, by, biteR, start2, end2, true);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Soft highlight
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'bilobed') {
      // Two overlapping circles.
      const sep = r * 0.7;
      const lr = r * 0.7;
      const ang = cell.phase || 0;
      const ox = Math.cos(ang) * sep * 0.5;
      const oy = Math.sin(ang) * sep * 0.5;
      // Fill both, then stroke the outline of their union via two arcs.
      ctx.beginPath();
      ctx.arc(x - ox, y - oy, lr, 0, Math.PI * 2);
      ctx.arc(x + ox, y + oy, lr, 0, Math.PI * 2);
      ctx.fill();
      // Outline: stroke each circle individually for simplicity (overlapping line in middle is acceptable visually).
      ctx.beginPath();
      ctx.arc(x - ox, y - oy, lr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, lr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - ox - lr * 0.35, y - oy - lr * 0.35, lr * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'multilobed') {
      // 4 overlapping circles arranged on a curved arc.
      const lr = r * 0.55;
      const baseAng = cell.phase || 0;
      const radius = r * 0.65;
      const lobes = [];
      for (let i = 0; i < 4; i++) {
        const a = baseAng + (i - 1.5) * 0.7;
        lobes.push({ x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius * 0.4 });
      }
      ctx.beginPath();
      for (const l of lobes) ctx.arc(l.x, l.y, lr, 0, Math.PI * 2);
      ctx.fill();
      for (const l of lobes) {
        ctx.beginPath();
        ctx.arc(l.x, l.y, lr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(lobes[0].x - lr * 0.35, lobes[0].y - lr * 0.35, lr * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // round (default)
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc.nucleusHi;
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- Debug ----------
  function drawDebug(blobs) {
    withCameraCtx(() => {
      ctx.save();
      ctx.lineWidth = 1 / camera.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      for (const b of blobs) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    });
    // Screen-space text overlay (not transformed)
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`cells: ${cells.length} / ${S.maxCells}  zoom: ${camera.scale.toFixed(2)}×`, 12, 38);
    ctx.restore();
  }

  // ---------- Frame loop ----------
  let lastTs = 0;
  const fpsBuf = [];
  const fpsEl = document.getElementById('fps');

  function updateFPS(dt, ts) {
    if (!S.showFPS || !fpsEl) return;
    fpsBuf.push(dt);
    if (fpsBuf.length > 60) fpsBuf.shift();
    if (Math.floor(ts / 250) === Math.floor((ts - dt * 1000) / 250)) return;
    let sum = 0;
    for (const v of fpsBuf) sum += v;
    const avg = sum / fpsBuf.length;
    const fps = avg > 0 ? Math.round(1 / avg) : 0;
    fpsEl.textContent = `${fps} fps · cells ${cells.length}`;
  }

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    update(dt);

    drawBackground(ts);
    const t = ts * 0.001;
    const shapes = getShapes(t);
    if (shapes.length) {
      drawMetaballMask(shapes, t);
      drawMetaballToMain(shapes, t);
    }
    drawNuclei(ts);
    drawSelection(shapes, t);
    drawCartoonFaces(shapes, t);
    if (S.showDebugField) drawDebug(shapes);

    updateFPS(dt, ts);

    requestAnimationFrame(frame);
  }

  // ---------- Settings UI ----------
  const settingsEl = document.getElementById('settings');
  const gearBtn = document.getElementById('gear');

  const panelEl = settingsEl.querySelector('.settings-panel');
  const helpDialog = document.getElementById('helpDialog');
  const paletteDialog = document.getElementById('paletteDialog');
  const paletteBadDialog = document.getElementById('paletteBadDialog');
  const helpBtn = document.getElementById('help');
  const paletteBtn = document.getElementById('palette');
  const paletteBadBtn = document.getElementById('paletteBad');
  const reloadBtn = document.getElementById('reload');
  const fabs = [gearBtn, helpBtn, paletteBtn, paletteBadBtn, reloadBtn].filter(Boolean);
  const allDialogs = [settingsEl, helpDialog, paletteDialog, paletteBadDialog].filter(Boolean);

  function openOnly(target) {
    for (const d of allDialogs) {
      if (d === target) d.classList.remove('hidden');
      else d.classList.add('hidden');
    }
  }
  function closeAll() {
    for (const d of allDialogs) d.classList.add('hidden');
  }

  gearBtn.addEventListener('click', () => {
    settingsEl.classList.contains('hidden') ? openOnly(settingsEl) : closeAll();
  });
  if (helpBtn) helpBtn.addEventListener('click', () => {
    helpDialog.classList.contains('hidden') ? openOnly(helpDialog) : closeAll();
  });
  if (paletteBtn) paletteBtn.addEventListener('click', () => {
    if (paletteDialog.classList.contains('hidden')) {
      renderPaletteGrid();
      openOnly(paletteDialog);
    } else closeAll();
  });
  if (paletteBadBtn) paletteBadBtn.addEventListener('click', () => {
    if (!S.allowBadGuys) return;
    if (paletteBadDialog.classList.contains('hidden')) {
      renderPaletteBadGrid();
      openOnly(paletteBadDialog);
    } else closeAll();
  });
  if (reloadBtn) reloadBtn.addEventListener('click', () => {
    const u = new URL(location.href);
    u.searchParams.set('_', Date.now().toString(36));
    location.replace(u.toString());
  });

  for (const d of allDialogs) {
    d.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => d.classList.add('hidden'));
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
  // Tap anywhere outside any panel (and not on a fab) closes whatever is open.
  document.addEventListener('pointerdown', (e) => {
    const anyOpen = allDialogs.some(d => !d.classList.contains('hidden'));
    if (!anyOpen) return;
    if (fabs.some(b => b.contains(e.target))) return;
    if (allDialogs.some(d => d.querySelector('.settings-panel,.dialog-panel')?.contains(e.target))) return;
    closeAll();
  }, true);

  function bindRange(id, key, valId, fmt) {
    const el = document.getElementById(id);
    const out = valId ? document.getElementById(valId) : null;
    el.value = S[key];
    if (out) out.textContent = fmt(S[key]);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      S[key] = v;
      if (out) out.textContent = fmt(v);
      saveSettings();
      if (key === 'autoSplitSeconds') {
        for (const c of cells) {
          if (c.state === 'NORMAL' && c.splitTimer > S.autoSplitSeconds * 1.5) {
            c.splitTimer = rollSplitTimer(c.type);
          }
        }
      }
    });
  }
  bindRange('maxCells', 'maxCells', 'maxCellsVal', v => v.toFixed(0));
  bindRange('autoSplitSeconds', 'autoSplitSeconds', 'autoVal', v => v.toFixed(0) + 's');
  bindRange('bgFlowSpeed', 'bgFlowSpeed', 'bgVal', v => v.toFixed(2) + '×');
  bindRange('outlinePx', 'outlinePx', 'outVal', v => v.toFixed(0) + 'px');
  bindRange('friction', 'friction', 'frictionVal', v => v.toFixed(2));
  bindRange('bounce', 'bounce', 'bounceVal', v => v.toFixed(2));
  bindRange('throwStrength', 'throwStrength', 'throwVal', v => v.toFixed(2) + '×');
  bindRange('wobbleAmp', 'wobbleAmp', 'wobbleVal', v => v.toFixed(2));

  const blendSel = document.getElementById('blendMode');
  if (blendSel) {
    blendSel.value = S.blendMode || 'source-over';
    blendSel.addEventListener('change', () => {
      S.blendMode = blendSel.value;
      saveSettings();
    });
  }

  function bindCheckbox(id, key, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!S[key];
    if (onChange) onChange(el.checked);
    el.addEventListener('change', () => {
      S[key] = el.checked;
      saveSettings();
      if (onChange) onChange(el.checked);
    });
  }
  bindCheckbox('splitOnTap', 'splitOnTap');
  bindCheckbox('randomSplit', 'randomSplit');
  bindCheckbox('cartoon', 'cartoon');
  bindCheckbox('showFPS', 'showFPS', (on) => {
    const el = document.getElementById('fps');
    if (el) el.classList.toggle('on', !!on);
  });

  for (const r of settingsEl.querySelectorAll('input[name="splitMode"]')) {
    r.checked = (r.value === S.splitMode);
    r.addEventListener('change', () => {
      if (!r.checked) return;
      S.splitMode = r.value;
      saveSettings();
    });
  }

  const dbg = document.getElementById('showDebugField');
  dbg.checked = S.showDebugField;
  dbg.addEventListener('change', () => {
    S.showDebugField = dbg.checked;
    saveSettings();
  });

  // Theme selector
  function applyThemeToCss(theme) {
    const root = document.documentElement;
    root.style.setProperty('--accent', theme.ui.panelAccent);
  }

  const themeSelect = document.getElementById('themeSelect');
  for (const [key, t] of Object.entries(THEMES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = t.label;
    themeSelect.appendChild(opt);
  }
  themeSelect.value = S.theme in THEMES ? S.theme : 'petriDish';
  applyThemeToCss(currentTheme());
  themeSelect.addEventListener('change', () => {
    if (THEMES[themeSelect.value]) {
      S.theme = themeSelect.value;
      saveSettings();
      applyThemeToCss(currentTheme());
    }
  });

  // (Cell-type checklist UI removed — all types are always active; spawn from the palette FAB.)

  // ---------- Categories + groupings ----------
  const PATHOGEN_GROUPS = [
    { key: 'virus',    label: 'Viruses',   icon: '🦠', members: ['virus'] },
    { key: 'bacteria', label: 'Bacteria',  icon: '🧫', members: ['germ', 'bacterium'] },
    { key: 'parasite', label: 'Parasites', icon: '🪱', members: ['amoebaP', 'mite'] },
    { key: 'fungus',   label: 'Fungi',     icon: '🍄', members: ['slime', 'spore'] },
    { key: 'toxin',    label: 'Toxins',    icon: '☠️',  members: ['toxin'] },
  ];

  function makeTile(key, t) {
    const tile = document.createElement('button');
    tile.className = 'cell-tile';
    tile.type = 'button';
    tile.title = t.description;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    tile.appendChild(c);
    const span = document.createElement('span');
    span.textContent = t.label;
    tile.appendChild(span);
    tile.addEventListener('click', () => {
      spawnAtCenter(key);
      closeAll();
    });
    renderCellPreview(c, key);
    return tile;
  }

  function appendGridSection(parent, title, entries) {
    if (!entries.length) return;
    const section = document.createElement('div');
    section.className = 'cell-grid-section';
    const h = document.createElement('h3');
    h.textContent = title;
    section.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'cell-grid';
    for (const [key, t] of entries) grid.appendChild(makeTile(key, t));
    section.appendChild(grid);
    parent.appendChild(section);
  }

  function appendHelpSection(parent, title, entries) {
    if (!entries.length) return;
    const section = document.createElement('li');
    section.className = 'cell-list-section';
    section.style.listStyle = 'none';
    const h = document.createElement('h3');
    h.textContent = title;
    section.appendChild(h);
    for (const [, t] of entries) {
      const row = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = t.label;
      const span = document.createElement('span');
      span.textContent = ' ' + t.description;
      row.appendChild(b);
      row.appendChild(span);
      row.style.padding = '6px 0';
      row.style.borderTop = '1px solid var(--line)';
      row.style.fontSize = '13px';
      section.appendChild(row);
    }
    parent.appendChild(section);
  }

  // Populate the help dialog list, category + sub-category grouped.
  const cellListEl = document.getElementById('cellList');
  function renderHelpList() {
    if (!cellListEl) return;
    cellListEl.innerHTML = '';
    const goodEntries = Object.entries(CELL_TYPES).filter(([, t]) => t.category === 'good');
    appendHelpSection(cellListEl, 'Good (Immune system)', goodEntries);
    if (S.allowBadGuys) {
      for (const g of PATHOGEN_GROUPS) {
        const entries = g.members.map(k => [k, CELL_TYPES[k]]).filter(([, t]) => t);
        appendHelpSection(cellListEl, `${g.icon} ${g.label}`, entries);
      }
    }
  }
  renderHelpList();

  // Palette grids: good-only + bad-only (sub-categorised by pathogen kind).
  const cellGridEl = document.getElementById('cellGrid');
  const cellGridBadEl = document.getElementById('cellGridBad');

  function renderPaletteGrid() {
    if (!cellGridEl) return;
    cellGridEl.innerHTML = '';
    const goodEntries = Object.entries(CELL_TYPES).filter(([, t]) => t.category === 'good');
    appendGridSection(cellGridEl, 'Good (Immune system)', goodEntries);
  }

  function renderPaletteBadGrid() {
    if (!cellGridBadEl) return;
    cellGridBadEl.innerHTML = '';
    if (!S.allowBadGuys) return;
    for (const g of PATHOGEN_GROUPS) {
      const entries = g.members.map(k => [k, CELL_TYPES[k]]).filter(([, t]) => t);
      appendGridSection(cellGridBadEl, `${g.icon} ${g.label}`, entries);
    }
  }

  // Bind the Allow-pathogens toggle now that the renderers above exist.
  // Initial body-class is set explicitly so the FAB stack is correct on first paint.
  document.body.classList.toggle('no-bad', !S.allowBadGuys);
  bindCheckbox('allowBadGuys', 'allowBadGuys', (on) => {
    document.body.classList.toggle('no-bad', !on);
    if (!on && paletteBadDialog && !paletteBadDialog.classList.contains('hidden')) {
      closeAll();
    }
    if (typeof renderHelpList === 'function') renderHelpList();
    if (typeof renderPaletteBadGrid === 'function') renderPaletteBadGrid();
  });

  function spawnAtCenter(typeKey) {
    if (cells.length >= S.maxCells) return;
    // Spawn at the centre of the visible viewport in world coords.
    const w = screenToWorld(W / 2, H / 2);
    const jitter = CELL_RADIUS * 0.3;
    const c = makeCell(
      w.x + (Math.random() - 0.5) * jitter,
      w.y + (Math.random() - 0.5) * jitter,
      CELL_RADIUS,
      typeKey,
    );
    cells.push(c);
  }

  // Static preview render used for palette tiles. Reuses the polygon body and
  // the per-type nucleus / decoration drawers but bypasses the metaball pipeline.
  function renderCellPreview(canvasEl, typeKey) {
    const c2 = canvasEl.getContext('2d');
    const w = canvasEl.width, h = canvasEl.height;
    c2.clearRect(0, 0, w, h);
    const fakeCell = {
      id: 1, x: w / 2, y: h / 2, r: w * 0.32,
      type: typeKey,
      vx: 0, vy: 0, state: 'NORMAL',
      splitTimer: 0, splitProgress: 0, splitAngle: 0, bondTimer: 0,
      phase: 0.4, orientation: 0, wobbleSeed: 7, wobbleFreq: 0.7, flash: 0,
    };
    const s = { x: fakeCell.x, y: fakeCell.y, r: fakeCell.r, cell: fakeCell };
    const cc = (CELL_TYPES[typeKey] || CELL_TYPES.neutrophil).colors;
    const theme = currentTheme();
    const t = 0.5;
    // Body fill with outline. We can't easily reuse the metaball pipeline here,
    // so trace the polygon directly.
    const N = 48;
    const path = new Path2D();
    for (let i = 0; i <= N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const v = shapeVertex(s, theta, t);
      if (i === 0) path.moveTo(v.x, v.y);
      else path.lineTo(v.x, v.y);
    }
    path.closePath();
    // Fill
    const grad = c2.createRadialGradient(s.x, s.y - s.r * 0.3, 0, s.x, s.y, s.r * 1.6);
    grad.addColorStop(0, cc.cytoTop);
    grad.addColorStop(1, cc.cytoBot);
    c2.fillStyle = grad;
    c2.fill(path);
    // Outline
    c2.lineWidth = Math.max(2, S.outlinePx);
    c2.strokeStyle = theme.outline.color;
    c2.lineJoin = 'round';
    c2.stroke(path);
    // Per-type nucleus + decoration drawn directly onto c2 (preview-only helpers).
    drawPreviewNucleus(c2, fakeCell, s.x, s.y, s.r * NUCLEUS_RATIO, theme);
    drawPreviewDecorations(c2, s, theme, t);
  }

  function drawPreviewNucleus(c2, cell, x, y, r, theme) {
    const cc = (CELL_TYPES[cell.type] || CELL_TYPES.neutrophil).colors;
    const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
    let kind = type.nucleus.kind;
    if (kind === 'none') return;
    if (kind === 'round-small') { kind = 'round'; r *= 0.7; }
    c2.save();
    c2.lineWidth = Math.max(2, S.outlinePx * 0.6);
    c2.strokeStyle = theme.outline.color;
    c2.fillStyle = cc.nucleus;
    if (kind === 'round') {
      c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.fill(); c2.stroke();
    } else if (kind === 'kidney') {
      c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.fill();
      c2.globalCompositeOperation = 'destination-out';
      c2.beginPath(); c2.arc(x + r * 0.6, y, r * 0.85, 0, Math.PI * 2); c2.fill();
      c2.globalCompositeOperation = 'source-over';
      c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.stroke();
    } else if (kind === 'bilobed') {
      const sep = r * 0.5, lr = r * 0.7;
      c2.beginPath(); c2.arc(x - sep * 0.5, y, lr, 0, Math.PI * 2); c2.arc(x + sep * 0.5, y, lr, 0, Math.PI * 2); c2.fill();
      c2.beginPath(); c2.arc(x - sep * 0.5, y, lr, 0, Math.PI * 2); c2.stroke();
      c2.beginPath(); c2.arc(x + sep * 0.5, y, lr, 0, Math.PI * 2); c2.stroke();
    } else if (kind === 'multilobed') {
      const lr = r * 0.55, R = r * 0.65;
      const lobes = [-1.05, -0.35, 0.35, 1.05].map(a => ({ x: x + Math.cos(a) * R, y: y + Math.sin(a) * R * 0.4 }));
      c2.beginPath();
      for (const l of lobes) c2.arc(l.x, l.y, lr, 0, Math.PI * 2);
      c2.fill();
      for (const l of lobes) { c2.beginPath(); c2.arc(l.x, l.y, lr, 0, Math.PI * 2); c2.stroke(); }
    }
    c2.restore();
  }

  function drawPreviewDecorations(c2, s, theme, t) {
    const cell = s.cell;
    const cc = (CELL_TYPES[cell.type] || CELL_TYPES.neutrophil).colors;
    const type = CELL_TYPES[cell.type] || CELL_TYPES.neutrophil;
    const kind = type.decoration && type.decoration.kind;
    if (!kind || kind === 'none') return;
    c2.save();
    c2.lineWidth = Math.max(1.5, S.outlinePx * 0.55);
    c2.strokeStyle = theme.outline.color;
    if (kind === 'bigSpikes') {
      c2.fillStyle = cc.accent;
      const N = 8;
      const tipLen = s.r * 0.55, baseHalf = s.r * 0.09;
      for (let i = 0; i < N; i++) {
        const theta = (i / N) * Math.PI * 2;
        const base = shapeVertex(s, theta, t);
        const tx = base.x + Math.cos(theta) * tipLen;
        const ty = base.y + Math.sin(theta) * tipLen;
        c2.beginPath();
        c2.moveTo(base.x + Math.cos(theta + Math.PI / 2) * baseHalf, base.y + Math.sin(theta + Math.PI / 2) * baseHalf);
        c2.lineTo(tx, ty);
        c2.lineTo(base.x + Math.cos(theta - Math.PI / 2) * baseHalf, base.y + Math.sin(theta - Math.PI / 2) * baseHalf);
        c2.closePath(); c2.fill(); c2.stroke();
      }
    } else if (kind === 'tendrils') {
      c2.strokeStyle = cc.cytoBot;
      c2.lineCap = 'round';
      const N = 13;
      for (let i = 0; i < N; i++) {
        const theta = (i / N) * Math.PI * 2;
        const base = shapeVertex(s, theta, t);
        const len = s.r * 1.2;
        const tx = base.x + Math.cos(theta) * len;
        const ty = base.y + Math.sin(theta) * len;
        const cpX = base.x + Math.cos(theta + 0.4) * len * 0.6;
        const cpY = base.y + Math.sin(theta + 0.4) * len * 0.6;
        c2.beginPath();
        c2.moveTo(base.x, base.y);
        c2.quadraticCurveTo(cpX, cpY, tx, ty);
        c2.stroke();
      }
    } else if (kind === 'yReceptorsFew' || kind === 'yReceptorsMany') {
      c2.strokeStyle = cc.accent;
      c2.lineCap = 'round';
      const count = kind === 'yReceptorsMany' ? 14 : 6;
      const stem = s.r * 0.22, arms = s.r * 0.13, armSpread = Math.PI * 0.25;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        const base = shapeVertex(s, theta, t);
        const tx = base.x + Math.cos(theta) * stem;
        const ty = base.y + Math.sin(theta) * stem;
        c2.beginPath();
        c2.moveTo(base.x, base.y); c2.lineTo(tx, ty);
        c2.moveTo(tx, ty); c2.lineTo(tx + Math.cos(theta + armSpread) * arms, ty + Math.sin(theta + armSpread) * arms);
        c2.moveTo(tx, ty); c2.lineTo(tx + Math.cos(theta - armSpread) * arms, ty + Math.sin(theta - armSpread) * arms);
        c2.stroke();
      }
    }
    c2.restore();
  }

  document.getElementById('resetSim').addEventListener('click', resetSim);

  function resetSim() {
    cells.length = 0;
    cellId = 0;
    const c = makeCell(W / 2, H / 2);
    cells.push(c);
  }

  // ---------- Build stamp ----------
  function renderBuildStamp() {
    const el = document.getElementById('build');
    if (!el) return;
    const b = window.__BUILD__ || { sha: 'dev', run: 0, dateUtc: null };
    const sha = (b.sha || 'dev').slice(0, 7);
    const run = (b.run !== undefined && b.run !== null) ? b.run : 0;
    let when = '—';
    if (b.dateUtc) {
      const d = new Date(b.dateUtc);
      if (!isNaN(d.getTime())) {
        const offMin = -d.getTimezoneOffset();
        const sign = offMin >= 0 ? '+' : '-';
        const abs = Math.abs(offMin);
        const oh = String(Math.floor(abs / 60)).padStart(2, '0');
        const om = String(abs % 60).padStart(2, '0');
        const local = d.toLocaleString(undefined, {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        when = `${local} UTC${sign}${oh}:${om}`;
      }
    }
    el.textContent = `sha ${sha} · build #${run} · ${when}`;
  }
  renderBuildStamp();

  // ---------- Boot ----------
  resize();
  window.addEventListener('resize', resize);
  resetSim();
  requestAnimationFrame(frame);
})();
