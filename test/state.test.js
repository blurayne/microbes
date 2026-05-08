// Pure-logic tests for the i18n + cell-type registry in core/state.js.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  T, S, LOCALES, CELL_TYPES, BACKGROUNDS, THEMES, PATHOGEN_GROUPS,
  cellLabel, cellDesc,
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
  S.lang = 'brbn';
  assert.equal(T('adding', { name: 'Foo' }), 'STUFF NEW: Foo');
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
