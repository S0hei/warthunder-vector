import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../app/lib/map-catalog.json' with { type: 'json' };
import { mapName } from '../app/lib/map-names.ts';
import { compileMaps } from './map-catalog.mjs';
import { englishEntries } from './aircraft-catalog.mjs';

test('map IDs observed in saved battles resolve to the game location names', () => {
  const expected = {
    air_africa_desert: 'El Alamein', air_equatorial_island: 'Bourbon Island', air_israel: 'Golan Heights',
    air_kamchatka: 'Volcano Valley', air_ladoga: 'Ladoga', air_mysterious_valley: 'Mysterious Valley',
    air_smolensk: 'Smolensk', air_southeastern_cliffs: 'Rocky Pillars', air_vietnam: 'Vietnam',
    avg_egypt_sinai: 'Sinai', avg_poland: 'Poland', avg_rheinland: 'Crossing over the Rhine',
    berlin: 'Berlin', britain: 'Britain', bulge: 'Bulge', hurtgen: 'Hürtgen', khalkhin_gol: 'Khalkhin Gol',
    korea: 'Korea', korsun: 'Korsun', krymsk: 'Kuban', kursk: 'Kursk', malta: 'Malta', moscow: 'Moscow',
    mozdok: 'Mozdok', mozdok_winter: 'Winter Mozdok', norway: 'Norway', ruhr: 'Ruhr', sicily: 'Sicily',
    spain: 'Spain', stalingrad: 'Stalingrad', stalingrad_w: 'Winter Stalingrad', tunisia: 'Tunisia', zhengzhou: 'Zhengzhou',
  };
  for (const [id, expectedName] of Object.entries(expected)) {
    assert.equal(catalog.maps[id], expectedName, id);
    assert.equal(mapName(id), expectedName, id);
  }
});

test('replay level paths, localization keys and casing resolve without fuzzy matching', () => {
  for (const id of ['avg_egypt_sinai', 'LEVELS/AVG_EGYPT_SINAI.BIN', ' levels\\avg_egypt_sinai.bin ', 'location/avg_egypt_sinai']) {
    assert.equal(mapName(id), 'Sinai');
  }
  assert.equal(mapName('avg_kursk'), 'Kursk - tank battle');
  assert.equal(mapName('kursk'), 'Kursk');
  assert.equal(mapName('avg_kursk_villages'), 'Fire Arc');
  assert.equal(mapName('air_kamchatka_custom'), 'Kamchatka Custom');
  assert.equal(mapName('kamchatka'), 'Kamchatka');
  assert.equal(mapName('avg_sector_montmedy_snow'), 'Maginot Line');
});

test('unknown maps get readable names, absent maps stay unavailable', () => {
  assert.equal(mapName('levels/air_new_island.bin'), 'New Island');
  assert.equal(mapName('avn_new_port'), 'New Port');
  assert.equal(mapName('arcade_test_valley'), 'Test Valley');
  assert.equal(mapName('My Custom PvE Map'), 'My Custom PvE Map');
  assert.equal(mapName('constructor'), 'Constructor');
  assert.equal(mapName('toString'), 'ToString');
  for (const value of [null, undefined, '', '   ', 'air_', 'levels/.bin']) {
    assert.equal(mapName(value), 'Map unavailable');
    assert.equal(mapName(value, 'Battle'), 'Battle');
  }
});

test('catalog compilation accepts only actual location labels and normalizes punctuation', () => {
  const names = englishEntries('<ID>;<English>\n"location/sample";"Cliffs; Coast"\n"mission/sample";"Ignore me"\n"location/winter";"Winter\nValley"\n');
  names.set('location/dashes', ' Map \u2014 Test ');
  names.set('location/empty', '  ');
  names.set('location/placeholder', '<untranslated>');
  names.set('location/../invalid', 'Ignore me');
  assert.deepEqual(compileMaps(names), { dashes: 'Map - Test', sample: 'Cliffs; Coast', winter: 'Winter Valley' });
});

test('the bundled map catalog is complete, safe plain text and has pinned provenance', () => {
  assert.match(catalog.source.revision, /^[0-9a-f]{40}$/);
  assert.equal(catalog.source.file, 'lang.vromfs.bin_u/lang/missions_locations.csv');
  assert.ok(Object.keys(catalog.maps).length > 100);
  for (const [id, name] of Object.entries(catalog.maps)) {
    assert.match(id, /^[a-z0-9_]+$/);
    assert.ok(name.trim());
    assert.doesNotMatch(name, /[\u2012-\u2015]|<|>|\{\{/);
    assert.equal(mapName(id), name);
  }
});
