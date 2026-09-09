import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { componentLoader } from './component-test-loader.mjs';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const { needsAppReload } = componentLoader()('use-app-updates.ts');

test('native version and instance changes refresh the tab, outages and malformed data do not', () => {
  const boot = { version: '0.2.0', instance: 'a'.repeat(32) };
  assert.equal(needsAppReload(boot, boot), false);
  assert.equal(needsAppReload(boot, { ...boot, version: '0.3.0' }), true);
  assert.equal(needsAppReload(boot, { ...boot, instance: 'b'.repeat(32) }), true);
  for (const value of [null, {}, 'offline', { version: 'x', instance: 'b'.repeat(32) }, { version: '0.3.0', instance: 'invalid' }]) assert.equal(needsAppReload(boot, value), false);
  assert.equal(needsAppReload({}, boot), false);
});
test('launch and hourly checks are native and independent from history collection', () => {
  const source = read('native/Updates.cs'), app = read('native/Vector.cs');
  assert.match(source, /new Timer\(_ => Check\(false\), null, skipStartup \? 3600000 : 0, 3600000\)/);
  assert.match(source, /if \(!OutOfBattle\(\)\) return/);
  assert.match(source, /if \(stopped \|\| !OutOfBattle\(\)\) return/);
  assert.match(app, /new AppUpdates\(skipUpdate\)/);
  assert.match(app, /Check for app updates/);
  assert.match(app, /UpdateInstaller\.AcknowledgeStartup\(args\)/);
  assert.match(read('app/use-app-updates.ts'), /boot\.origin !== location\.origin/);
  assert.doesNotMatch(read('app/use-app-updates.ts'), /github\.com/);
});
test('release version, pinned workflow, draft verification and public source exclusions agree', () => {
  const pkg = JSON.parse(read('package.json')), workflow = read('.github/workflows/release.yml');
  assert.ok(read('native/Version.cs').includes(`Current = "${pkg.version}"`));
  for (const line of workflow.split('\n').filter(l => /uses:/.test(l))) assert.match(line, /@[a-f0-9]{40}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node scripts\/publish-release\.mjs/);
  const publishing = read('scripts/publish-release.mjs');
  assert.match(publishing, /Published releases are never overwritten/);
  assert.match(publishing, /Uploaded asset verification failed/);
  assert.ok(publishing.indexOf('verifyAssets(release, files)') < publishing.indexOf("'PATCH', { draft: false"));
  assert.doesNotMatch(workflow, /pull_request_target|id_ed25519|PRIVATE KEY/);
  for (const path of ['/Vector-data/', '/outputs/', '/.vite/', '/Vector.html', '/Vector.exe']) assert.ok(read('.gitignore').includes(path));
});
