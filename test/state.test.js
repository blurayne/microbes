// Pure-logic tests for the i18n + cell-type registry in core/state.js.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  T, S, LOCALES, CELL_TYPES, BACKGROUNDS, THEMES, PATHOGEN_GROUPS,
  cellLabel, cellDesc,
  OVERLAY_KIND_LIST, OVERLAY_FX_LIST, OVERLAY_SCENE_KEY,
  _normaliseOverlayOrder,
  overlayFxOrder, setOverlayFxOrder,
  overlayKindRunsAfterScene, setOverlayKindSide,
} from '../assets/core/state.js';

test('T() returns the English value for a known key', () => {
  S.lang = 'en';
  assert.equal(T('settings_title'), 'Settings');
});

test('T() falls back through locale → en → key', () => {
  S.lang = 'de';
  assert.equal(T('settings_title'), 'Einstellungen');
  S.lang = 'xx'; // unknown locale → en fallback
  assert.equal(T('settings_title'), 'Settings');
  S.lang = 'en';
  assert.equal(T('this_key_does_not_exist'), 'this_key_does_not_exist');
});

test('T() interpolates {name}-style placeholders', () => {
  S.lang = 'en';
  assert.equal(T('adding', { name: 'Foo' }), 'Adding: Foo');
  S.lang = 'de';
  assert.equal(T('adding', { name: 'Foo' }), 'Hinzufügen: Foo');
  S.lang = 'bar';
  assert.equal(T('adding', { name: 'Foo' }), 'Dazua: Foo');
  S.lang = 'latin';
  assert.equal(T('adding', { name: 'Foo' }), 'Addendo: Foo');
  S.lang = 'en';
});

test('every locale defines at least the core UI keys', () => {
  const required = ['settings_title', 'theme', 'reset_sim', 'adding', 'help_group_good'];
  for (const lang of Object.keys(LOCALES)) {
    for (const k of required) {
      assert.ok(LOCALES[lang][k], `missing ${lang}.${k}`);
    }
  }
});

test('cellLabel / cellDesc cover all 19 cell types', () => {
  S.lang = 'en';
  for (const k of Object.keys(CELL_TYPES)) {
    assert.ok(cellLabel(k), `cellLabel(${k}) empty`);
    assert.ok(cellDesc(k), `cellDesc(${k}) empty`);
  }
});

test('CELL_TYPES has the 12 good (immune + RBC) + 8 pathogen entries', () => {
  const good = Object.values(CELL_TYPES).filter(t => t.category === 'good');
  const bad  = Object.values(CELL_TYPES).filter(t => t.category === 'bad');
  assert.equal(good.length, 12);
  assert.equal(bad.length, 8);
});

test('every CELL_TYPE entry has the schema the renderer expects', () => {
  for (const [k, t] of Object.entries(CELL_TYPES)) {
    assert.ok(t.body && typeof t.body.kind === 'string', `${k}.body.kind missing`);
    assert.ok(t.nucleus && typeof t.nucleus.kind === 'string', `${k}.nucleus.kind missing`);
    assert.ok(t.move && typeof t.move.patrolSpeed === 'number', `${k}.move.patrolSpeed missing`);
    assert.ok(t.field && typeof t.field.blur === 'number', `${k}.field.blur missing`);
    assert.ok(t.colors && typeof t.colors.cytoTop === 'string', `${k}.colors.cytoTop missing`);
    assert.ok(typeof t.colors.cytoBotTransp === 'string', `${k}.cytoBotTransp not pre-baked`);
  }
});

test('BACKGROUNDS contains a fallback solid + every theme bg', () => {
  assert.ok(BACKGROUNDS.solid, 'solid fallback missing');
  for (const [k, t] of Object.entries(THEMES)) {
    if (t.bg) assert.ok(BACKGROUNDS[k], `BACKGROUNDS missing ${k}`);
  }
});

test('PATHOGEN_GROUPS members all resolve to bad cell types', () => {
  for (const g of PATHOGEN_GROUPS) {
    for (const m of g.members) {
      const t = CELL_TYPES[m];
      assert.ok(t, `unknown member ${m} in group ${g.key}`);
      assert.equal(t.category, 'bad', `${m} in ${g.key} is not category=bad`);
    }
  }
});

// ── Overlay-stack migration + helpers ───────────────────────────

test('overlayOrder: empty input → default order with the scene pin', () => {
  const out = _normaliseOverlayOrder(undefined, undefined, undefined);
  assert.ok(out.includes(OVERLAY_SCENE_KEY), 'scene pin must be present');
  assert.equal(
    out.filter(k => k === OVERLAY_SCENE_KEY).length, 1,
    'scene pin appears exactly once',
  );
  for (const k of OVERLAY_KIND_LIST) {
    assert.ok(out.includes(k), `default order missing kind ${k}`);
  }
});

test('overlayOrder: legacy fxOrder permutation is preserved in the FX subset', () => {
  const legacyFx = ['crosshair', 'noise', 'vignette'];
  const out = _normaliseOverlayOrder(undefined, legacyFx, undefined);
  const fxSubset = out.filter(k => OVERLAY_FX_LIST.includes(k));
  assert.deepEqual(fxSubset, legacyFx);
});

test("overlayOrder: legacy rippleScope='bg' places ripples below the scene pin", () => {
  const out = _normaliseOverlayOrder(undefined, undefined, 'bg');
  const ripIdx = out.indexOf('ripples');
  const pinIdx = out.indexOf(OVERLAY_SCENE_KEY);
  assert.ok(ripIdx > pinIdx, `ripples (${ripIdx}) must be after pin (${pinIdx})`);
});

test("overlayOrder: legacy rippleScope='scene' places ripples above the scene pin", () => {
  const out = _normaliseOverlayOrder(undefined, undefined, 'scene');
  const ripIdx = out.indexOf('ripples');
  const pinIdx = out.indexOf(OVERLAY_SCENE_KEY);
  assert.ok(ripIdx < pinIdx, `ripples (${ripIdx}) must be before pin (${pinIdx})`);
});

test('overlayOrder: unknown kinds are dropped, missing kinds are appended', () => {
  const out = _normaliseOverlayOrder(['noise', 'foobar', 'scene'], undefined, undefined);
  assert.ok(!out.includes('foobar'), 'unknown kind dropped');
  for (const k of OVERLAY_KIND_LIST) {
    assert.ok(out.includes(k), `missing kind ${k} should have been re-added`);
  }
});

test('overlayOrder: duplicate scene pin collapses to one', () => {
  const out = _normaliseOverlayOrder(
    ['noise', 'scene', 'vignette', 'scene', 'ripples'],
    undefined, undefined,
  );
  assert.equal(out.filter(k => k === OVERLAY_SCENE_KEY).length, 1);
});

test('overlayOrder: duplicate non-pin kind collapses to one (first wins)', () => {
  const out = _normaliseOverlayOrder(
    ['noise', 'scene', 'noise', 'vignette'],
    undefined, undefined,
  );
  assert.equal(out.filter(k => k === 'noise').length, 1);
});

test('overlayFxOrder + setOverlayFxOrder round-trip preserves non-FX slots', () => {
  const before = S.overlayOrder.slice();
  const beforeNonFx = before.filter(k => !OVERLAY_FX_LIST.includes(k));
  setOverlayFxOrder(['crosshair', 'vignette', 'noise']);
  try {
    assert.deepEqual(overlayFxOrder(), ['crosshair', 'vignette', 'noise']);
    const afterNonFx = S.overlayOrder.filter(k => !OVERLAY_FX_LIST.includes(k));
    assert.deepEqual(afterNonFx, beforeNonFx,
      'non-FX entries must keep their positions across a setOverlayFxOrder');
  } finally {
    setOverlayFxOrder(before.filter(k => OVERLAY_FX_LIST.includes(k)));
  }
});

test('setOverlayKindSide: moves ripples across the scene pin', () => {
  const before = S.overlayOrder.slice();
  try {
    setOverlayKindSide('ripples', 'before');
    assert.equal(overlayKindRunsAfterScene('ripples'), false);
    setOverlayKindSide('ripples', 'after');
    assert.equal(overlayKindRunsAfterScene('ripples'), true);
  } finally {
    S.overlayOrder = before;
  }
});

test("setOverlayKindSide: scene pin itself is a no-op", () => {
  const before = S.overlayOrder.slice();
  setOverlayKindSide(OVERLAY_SCENE_KEY, 'before');
  assert.deepEqual(S.overlayOrder, before);
});
