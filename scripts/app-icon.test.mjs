import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentLoader } from './component-test-loader.mjs';

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

test('original Vector emblem uses the War Thunder theme palette and safe, scalable artwork', () => {
  const svg = read('public/favicon.svg');
  assert.match(svg, /viewBox="0 0 64 64"/);
  for (const color of ['#13191b', '#31424a', '#cfd8dc', '#e53935']) assert.ok(svg.includes(color));
  assert.doesNotMatch(svg, /#b8ef46|#68C4FF|#0C79D8|<script|<image|<text|<foreignObject|\bon\w+=|\bhref=/i);
});

test('the smallest Windows frame includes the red emblem and transparent cut corners', () => {
  const ico = readFileSync(new URL('../public/vector.ico', import.meta.url));
  const start = ico.readUInt32LE(18) + 40;
  let red = 0, transparent = 0, silver = 0;
  for (let i = 0; i < 16 * 16; i++) {
    const [b, g, r, a] = ico.subarray(start + i * 4, start + i * 4 + 4);
    if (a === 0) transparent++;
    if (a > 128 && r > 120 && r > g * 1.5 && r > b * 1.5) red++;
    if (a > 128 && Math.min(r, g, b) > 140) silver++;
  }
  assert.ok(red > 0 && silver > 8 && transparent > 4);
});

test('sidebar and browser share identical embedded artwork without a new asset request', () => {
  const brand = JSON.parse(read('app/lib/vector-brand.json'));
  assert.ok(brand.src.startsWith('data:image/svg+xml;base64,'));
  assert.equal(Buffer.from(brand.src.split(',')[1], 'base64').toString('utf8'), read('public/favicon.svg').replace(/\r\n/g, '\n'));
  const Component = componentLoader()('vector-mark.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Component));
  assert.match(html, /aria-hidden="true"/);
  assert.ok(html.includes(brand.src));
  assert.match(read('app/page.tsx'), /className="brand-mark" role="img" aria-label=\{t\("Vector tactical map"\)\}><VectorMark \/>/);
});

test('control artwork is consistent, decorative, distinct and independent of emoji fonts', () => {
  const Component = componentLoader()('control-icon.tsx').default;
  const names = ['contrast', 'fullscreen', 'zoomIn', 'zoomOut', 'fitAircraft', 'fitBattle', 'center', 'close', 'external', 'restart'];
  const shapes = new Set();
  for (const name of names) {
    const html = renderToStaticMarkup(React.createElement(Component, { name }));
    assert.match(html, /viewBox="0 0 24 24"/); assert.match(html, /aria-hidden="true"/); assert.match(html, /focusable="false"/);
    assert.match(html, /stroke="currentColor"/); assert.doesNotMatch(html, /<text|<image|<title|tabindex=/);
    shapes.add([...html.matchAll(/ d="([^"]+)"/g)].map(m => m[1]).join('|'));
  }
  assert.equal(shapes.size, names.length);
  const page = read('app/page.tsx');
  assert.doesNotMatch(page, />[◐⛶⤢⌖×]<|>B<|>−<|>\+</);
  for (const name of names.filter(n => n !== 'restart')) assert.ok(page.includes(`<ControlIcon name="${name}" />`));
  assert.match(read('app/app-update-notice.tsx'), /<ControlIcon name="restart" \/>/);
  assert.match(read('app/globals.css'), /\.control-icon\s*\{[^}]*width: 1\.35rem;[^}]*height: 1\.35rem;[^}]*pointer-events: none/);
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
