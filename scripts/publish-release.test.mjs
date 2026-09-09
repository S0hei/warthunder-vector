import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { publishRelease, assetNames, verifyAssets } from './publish-release.mjs';

const sha = 'a'.repeat(40), tag = 'v0.2.1';
const files = assetNames.map(name => ({ name, bytes: Buffer.from(`fixture-${name}`) }));
const assets = files.map(file => ({ name: file.name, state: 'uploaded', size: file.bytes.length, digest: 'sha256:' + createHash('sha256').update(file.bytes).digest('hex') }));
function fixture(overrides = {}) {
  const calls = [], draft = { id: 123, draft: true, tag_name: tag, assets: [] };
  const request = async (url, options) => {
    calls.push([url, options]);
    let body, status = 200;
    if (url.includes('/git/ref/')) body = { object: { type: 'tag', sha: 'b'.repeat(40) } };
    else if (url.includes('/git/tags/')) body = { object: { type: 'commit', sha } };
    else if (url.includes('/releases/tags/')) { status = 404; body = {}; }
    else if (url.endsWith('/releases')) body = draft;
    else if (url.includes('/assets?')) body = {};
    else body = options.method === 'PATCH' ? { ...draft, draft: false, assets } : { ...draft, assets };
    if (overrides.response) ({ body, status } = overrides.response(url, options, { body, status }));
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, run: () => publishRelease({ tag, version: '0.2.1', token: 'fixture-token', sha, notes: 'Fixture release', files, request }) };
}
test('release API verifies tag and uploaded assets before publishing a draft', async () => {
  const { calls, run } = fixture();
  assert.equal(await run(), `https://github.com/S0hei/warthunder-vector/releases/tag/${tag}`);
  assert.equal(calls.filter(([, call]) => call.method === 'POST').length, 4);
  assert.equal(calls.at(-1)[1].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { draft: false, make_latest: 'true' });
  for (const [url, call] of calls) {
    assert.match(url, /^https:\/\/(?:api|uploads)\.github\.com\/repos\/S0hei\/warthunder-vector\//);
    assert.equal(call.redirect, 'error');
    assert.equal(call.headers.Authorization, 'Bearer fixture-token');
  }
});
test('published releases, mismatched tags and corrupt uploaded assets are never mutated', async () => {
  for (const kind of ['published', 'tag', 'digest']) {
    const { calls, run } = fixture({ response(url, options, result) {
      if (kind === 'published' && url.includes('/releases/tags/')) return { status: 200, body: { draft: false } };
      if (kind === 'tag' && url.includes('/git/tags/')) result.body.object.sha = 'c'.repeat(40);
      if (kind === 'digest' && url.endsWith('/releases/123')) result.body.assets = assets.map(asset => ({ ...asset, digest: null }));
      return result;
    } });
    await assert.rejects(run);
    assert.equal(calls.some(([, call]) => call.method === 'PATCH' || call.method === 'DELETE'), false);
  }
});
test('API failures identify the failing stage without exposing credentials', async () => {
  const { run } = fixture({ response(url, options, result) {
    return url.endsWith('/releases') ? { status: 403, body: { message: 'Rejected fixture-token' } } : result;
  } });
  await assert.rejects(run, error => /Create draft release: HTTP 403/.test(error.message) && !error.message.includes('fixture-token'));
});
test('all release checksums, names and sizes must match exactly', () => {
  verifyAssets({ assets }, files);
  for (const broken of [[], assets.slice(1), [...assets, assets[0]], assets.map(asset => ({ ...asset, size: 0 }))]) assert.throws(() => verifyAssets({ assets: broken }, files));
});
