import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFileBattles, summarizeFileBattles, battleKey, killCount, aiCount, localBattleDay } from '../app/lib/file-battles.ts';
import { allowedVectorRequest } from './vector-dev-bridge.mjs';

const battle = (overrides = {}) => ({ schemaVersion: 1, id: '123456789abcdef', accountId: '42', player: 'Test pilot',
  playedAt: '2026-09-08T12:00:00Z', mission: 'test', outcome: 'win', conflict: false, hasLog: true, hasReplay: true, rewardsFinal: true,
  wp: 1000, exp: 200, kills: 3, groundKills: 1, navalKills: 0, aiKills: 2, aiGroundKills: 4, aiNavalKills: 0,
  assists: 1, deaths: 1, spawns: 2, score: 900, seconds: 120.5, vehicles: ['test_plane'], ...overrides });

test('automatic archive validates and sorts by play time, not import time', () => {
  const old = battle(), recent = battle({ id: 'ffffffff', playedAt: '2026-09-08T13:00:00Z' });
  assert.deepEqual(decodeFileBattles([old, recent]), { battles: [recent, old], rejected: 0 });
});
test('duplicates are rejected and accounts remain distinct', () => {
  const b = battle(), other = battle({ accountId: '43' });
  assert.notEqual(battleKey(b), battleKey(other));
  const result = decodeFileBattles([b, b, other]);
  assert.equal(result.rejected, 1); assert.equal(result.battles.length, 2);
});
test('invalid economic or scoreboard fields cannot enter aggregates', () => {
  for (const overrides of [{ wp: NaN }, { exp: 1e12 }, { deaths: -1 }, { seconds: Infinity }, { playedAt: 'invalid' },
    { accountId: '../x' }, { vehicles: [null] }, { hasLog: false, hasReplay: false }, { conflict: true }, { kills: undefined }]) {
    assert.equal(decodeFileBattles([battle(overrides)]).rejected, 1);
  }
  assert.throws(() => decodeFileBattles({}));
});
test('unresolved matches do not count as losses or finalized rewards', () => {
  const b = battle(), unresolved = battle({ outcome: 'unknown', rewardsFinal: false, wp: 99999, exp: 99999 });
  const s = summarizeFileBattles([b, unresolved]);
  assert.equal(s.count, 2); assert.equal(s.unresolved, 1); assert.equal(s.winRate, 100);
  assert.equal(s.losses, 0); assert.equal(s.wp, 1000); assert.equal(s.exp, 200);
});
test('AI counters never inflate the non-AI kill/death ratio', () => {
  assert.equal(killCount(battle()), 4); assert.equal(aiCount(battle()), 6);
  const s = summarizeFileBattles([battle()]); assert.equal(s.kd, 4); assert.equal(s.ai, 6);
});

test('kills per death and per statistical spawn have independent denominators', () => {
  const s = summarizeFileBattles([battle({ kills: 4, groundKills: 0, deaths: 1, spawns: 2 }), battle({ kills: 2, groundKills: 0, deaths: 1, spawns: 1 })]);
  assert.equal(s.kd, 3); assert.equal(s.ks, 2); assert.equal(s.spawns, 3); assert.equal(s.spawnKills, 6);
});

test('missing spawn evidence never becomes deaths plus one or corrupts the ratio', () => {
  const s = summarizeFileBattles([battle(), battle({ kills: 100, spawns: null }), battle({ hasReplay: false, kills: null, spawns: 5 })]);
  assert.equal(s.ks, 2); assert.equal(s.spawnCount, 1); assert.equal(s.spawns, 2);
  assert.equal(summarizeFileBattles([]).ks, null);
  const legacy = battle(); delete legacy.spawns;
  assert.equal(decodeFileBattles([legacy]).battles[0].spawns, null);
  for (const spawns of [0, -1, 1.5, 513, NaN]) assert.equal(decodeFileBattles([battle({ spawns })]).rejected, 1);
});
test('log-only records are not zero-valued scoreboards', () => {
  const b = battle({ hasReplay: false, kills: null, deaths: null });
  assert.equal(killCount(b), null);
  const s = summarizeFileBattles([b]); assert.equal(s.scoreCount, 0); assert.equal(s.kd, null);
});
test('partial reward coverage is explicit and missing data stays null', () => {
  const s = summarizeFileBattles([battle(), battle({ wp: null, exp: null })]);
  assert.equal(s.resolved, 2); assert.equal(s.wpCount, 1); assert.equal(s.expCount, 1);
  assert.equal(summarizeFileBattles([]).wp, null);
  assert.equal(summarizeFileBattles([battle({ outcome: 'unknown' })]).winRate, null);
  assert.equal(summarizeFileBattles([battle({ deaths: 0 })]).kd, null);
});
test('conflicted outcomes are excluded and numeric zero is retained', () => {
  const b = battle({ conflict: true, outcome: 'unknown', wp: 0, exp: 0 });
  assert.equal(decodeFileBattles([b]).rejected, 0);
  assert.equal(summarizeFileBattles([b]).resolved, 0);
  assert.equal(summarizeFileBattles([battle({ wp: 0 })]).wp, 0);
});
test('battle day uses local calendar boundaries', () => {
  const date = new Date(2026, 8, 8, 0, 10); assert.equal(localBattleDay(date.toISOString()), '2026-09-08');
});
test('a confirmed replay outcome does not finalize provisional log rewards', () => {
  const s = summarizeFileBattles([battle({ rewardsFinal: false })]);
  assert.equal(s.wins, 1); assert.equal(s.wp, null); assert.equal(s.exp, null);
});
test('development bridge rejects remote hosts, origins and cross-site requests', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
    assert.equal(allowedVectorRequest({ headers: { host, origin: `http://${host}` } }), true);
  }
  for (const headers of [{ host: 'evil.example:3000' }, { host: 'localhost:3000', origin: 'null' },
    { host: 'localhost:3000', origin: 'https://evil.example' }, { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }]) {
    assert.equal(allowedVectorRequest({ headers }), false);
  }
});
