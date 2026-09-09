import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repository = 'S0hei/warthunder-vector';
const api = `https://api.github.com/repos/${repository}`;
export const assetNames = ['Vector.exe', 'Vector.html', 'SHA256SUMS'];
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

export function verifyAssets(release, files) {
  for (const file of files) {
    const assets = (release.assets ?? []).filter(asset => asset.name === file.name);
    assert(assets.length === 1 && assets[0].state === 'uploaded' && assets[0].size === file.bytes.length && assets[0].digest === digest(file.bytes),
      `Uploaded asset verification failed: ${file.name}`);
  }
}

export async function publishRelease({ tag, version, token, sha, notes, files, request = fetch }) {
  assert.equal(tag, `v${version}`, 'Tag must match package version');
  assert(/^v\d+\.\d+\.\d+$/.test(tag) && /^[a-f0-9]{40}$/.test(sha), 'Invalid release tag or commit');
  assert(token, 'Release token is unavailable');
  assert.deepEqual(files.map(file => file.name), assetNames, 'Unexpected release files');
  const call = async (label, url, method = 'GET', body, allowMissing = false) => {
    assert(url.startsWith(api + '/') || url.startsWith(`https://uploads.github.com/repos/${repository}/releases/`));
    const binary = Buffer.isBuffer(body);
    const response = await request(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Vector-release', ...(body ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}) },
      ...(body ? { body: binary ? body : JSON.stringify(body) } : {}),
    });
    if (allowMissing && response.status === 404) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(data.message ?? 'Request rejected').replaceAll(token, '[redacted]').slice(0, 300);
      throw new Error(`${label}: HTTP ${response.status}. ${message}`);
    }
    return data;
  };
  // A tag pushed through SSH must already exist; publishing never creates it.
  const reference = await call('Verify release tag', `${api}/git/ref/tags/${tag}`);
  let target = reference.object;
  if (target?.type === 'tag') target = (await call('Verify annotated tag', `${api}/git/tags/${target.sha}`)).object;
  assert(target?.type === 'commit' && target.sha === sha, 'Release tag does not point to the build commit');
  let release = await call('Find release', `${api}/releases/tags/${tag}`, 'GET', undefined, true);
  if (release) assert(release.draft === true, 'Published releases are never overwritten');
  else release = await call('Create draft release', `${api}/releases`, 'POST', { tag_name: tag, target_commitish: sha, name: `Vector ${tag}`, body: notes, draft: true, prerelease: false });
  assert(Number.isSafeInteger(release.id) && release.id > 0 && release.tag_name === tag && release.draft === true, 'Unexpected release response');
  for (const file of files) {
    if ((release.assets ?? []).some(asset => asset.name === file.name)) {
      // A retry may reuse an identical draft asset, but never overwrite a different one.
      verifyAssets(release, [file]);
      continue;
    }
    await call(`Upload ${file.name}`, `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`, 'POST', file.bytes);
  }
  release = await call('Verify uploaded release', `${api}/releases/${release.id}`);
  verifyAssets(release, files);
  assert(release.draft === true && release.tag_name === tag, 'Release changed before publication');
  const published = await call('Publish release', `${api}/releases/${release.id}`, 'PATCH', { draft: false, make_latest: 'true' });
  assert(published.draft === false && published.tag_name === tag, 'Release was not published');
  return `https://github.com/${repository}/releases/tag/${tag}`;
}

async function main() {
  assert.equal(process.env.GITHUB_REPOSITORY, repository, 'Unexpected publishing repository');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push', 'Release must follow a pushed tag');
  const root = new URL('../', import.meta.url), pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const files = await Promise.all(assetNames.map(async name => ({ name, bytes: await readFile(new URL(name, root)) })));
  const url = await publishRelease({ tag: process.env.RELEASE_TAG, version: pkg.version, token: process.env.GH_TOKEN, sha: process.env.GITHUB_SHA,
    notes: await readFile(new URL('.github/release-notes.md', root), 'utf8'), files });
  console.log(`Published verified release: ${url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const message = error.message.replaceAll(process.env.GH_TOKEN || '\0', '[redacted]').replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    console.error(`::error::${message}`);
    process.exitCode = 1;
  });
}
