import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Windows icon has all eight resolutions with complete, non-overlapping frames', () => {
  const ico = readFileSync(new URL('../public/vector.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
  assert.equal(ico.readUInt16LE(4), sizes.length);
  let next = 6 + sizes.length * 16;
  for (const [i, size] of sizes.entries()) {
    const entry = 6 + i * 16;
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    assert.equal(ico.readUInt16LE(entry + 6), 32);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.equal(offset, next);
    assert.ok(offset + length <= ico.length);
    if (size === 256) {
      assert.equal(ico.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(ico.readUInt32BE(offset + 16), size);
      assert.equal(ico.readUInt32BE(offset + 20), size);
    } else {
      assert.equal(ico.readUInt32LE(offset), 40);
      assert.equal(ico.readInt32LE(offset + 4), size);
      assert.equal(ico.readInt32LE(offset + 8), size * 2);
      assert.equal(length, 40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
    }
    next += length;
  }
  assert.equal(next, ico.length);
});

test('app icon matches Vector colors and replaces the starter favicon', () => {
  const svg = read('public/favicon.svg');
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /fill="#101311"/);
  assert.match(svg, /fill="#b8ef46"/);
  assert.doesNotMatch(svg, /#68C4FF|#0C79D8/);
});

test('Windows shell and tray receive the same embedded icon, disposed on exit', () => {
  const build = read('scripts/build-windows.ps1');
  const native = read('native/Vector.cs');
  assert.match(build, /\/win32icon:\$vectorIcon/);
  assert.match(build, /\/resource:\$vectorIcon,Vector\.ico/);
  assert.match(native, /VectorBrand\.LoadIcon\(SystemInformation\.SmallIconSize\)/);
  assert.match(native, /new NotifyIcon \{ Icon = trayIcon/);
  assert.match(native, /trayIcon\.Dispose\(\)/);
  assert.doesNotMatch(native, /SystemIcons\.Application/);
});

test('browser metadata and portable inlining reference the Vector icon without new runtime routes', () => {
  const layout = read('app/layout.tsx');
  const inline = read('scripts/inline-portable.mjs');
  assert.match(layout, /url: '\/favicon\.svg'/);
  assert.match(layout, /url: '\/vector\.ico'/);
  assert.match(inline, /readFile\(resolve\(projectRoot, 'public\/favicon\.svg'\)\)/);
  assert.match(inline, /data:image\/svg\+xml;base64,/);
});
