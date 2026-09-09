import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fonts, verifyFont } from './warthunder-fonts.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('app/globals.css');
const theme = css.slice(css.indexOf('/* War Thunder web styling'));
const tokens = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*(#[a-f0-9]{3,6})\s*;/g)].map(m => [m[1], m[2]]));

function table(data, name) {
  const count = data.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16;
    if (data.toString('ascii', p, p + 4) !== name) continue;
    const offset = data.readUInt32BE(p + 8), length = data.readUInt32BE(p + 12);
    assert.ok(offset + length <= data.length);
    return data.subarray(offset, offset + length);
  }
  throw new Error(`Missing font table: ${name}`);
}
function nameRecords(data) {
  const names = table(data, 'name'), records = [], strings = names.readUInt16BE(4);
  for (let i = 0; i < names.readUInt16BE(2); i++) {
    const p = 6 + i * 12;
    if (names.readUInt16BE(p) !== 3) continue;
    const start = strings + names.readUInt16BE(p + 10), length = names.readUInt16BE(p + 8);
    records.push([names.readUInt16BE(p + 6), Buffer.from(names.subarray(start, start + length)).swap16().toString('utf16le')]);
  }
  return records;
}
function hasGlyph(data, code) {
  const cmap = table(data, 'cmap');
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4), sub = cmap.subarray(offset);
    if (sub.readUInt16BE(0) !== 4) continue;
    const count = sub.readUInt16BE(6) / 2, starts = 16 + count * 2, deltas = starts + count * 2, ranges = deltas + count * 2;
    for (let s = 0; s < count; s++) {
      if (code < sub.readUInt16BE(starts + s * 2) || code > sub.readUInt16BE(14 + s * 2)) continue;
      const range = sub.readUInt16BE(ranges + s * 2), delta = sub.readInt16BE(deltas + s * 2);
      if (!range) return ((code + delta) & 65535) !== 0;
      const address = ranges + s * 2 + range + (code - sub.readUInt16BE(starts + s * 2)) * 2;
      const glyph = sub.readUInt16BE(address);
      return glyph !== 0 && ((glyph + delta) & 65535) !== 0;
    }
  }
  return false;
}

test('four bundled fonts exactly match the verified official-site binaries and include Cyrillic', () => {
  assert.equal(fonts.length, 4);
  for (const font of fonts) {
    const data = readFileSync(new URL(`../app/assets/fonts/${font.file}`, import.meta.url));
    verifyFont(data, font.sha256);
    const names = nameRecords(data);
    assert.ok(names.some(([id, text]) => id === 1 && /^Roboto(?: Condensed)?$/.test(text)));
    assert.ok(names.some(([id, text]) => id === 0 && /Copyright 2011 Google Inc/.test(text)));
    assert.ok(names.some(([id, text]) => id === 13 && /Apache License, Version 2.0/.test(text)));
    for (const character of 'Vector0123456789ЯякСуЁё') assert.ok(hasGlyph(data, character.codePointAt(0)), `${font.file}: ${character}`);
  }
});

test('font maintenance fails closed on corrupt or changed assets', () => {
  const data = readFileSync(new URL('../app/assets/fonts/roboto-regular.ttf', import.meta.url));
  const changed = Buffer.from(data); changed[100] ^= 1;
  for (const value of [Buffer.from('<html>error</html>'), data.subarray(0, 500), changed, Buffer.alloc(1_000_001)]) {
    assert.throws(() => verifyFont(value, fonts[0].sha256));
  }
});

test('both app entry points use the same local fonts without remote CSS or Google Fonts', () => {
  assert.equal((css.match(/@font-face/g) ?? []).length, 4);
  assert.equal((css.match(/font-display: swap/g) ?? []).length, 4);
  for (const font of fonts) assert.ok(css.includes(`url('./assets/fonts/${font.file}')`));
  assert.match(css, /--font-geist-sans: 'Vector Roboto'/);
  assert.match(css, /--font-geist-mono: 'Vector Roboto Condensed'/);
  assert.doesNotMatch(read('app/layout.tsx'), /next\/font|Geist\(/);
  assert.match(read('app/layout.tsx'), /import '\.\/globals\.css'/);
  assert.match(read('build-src/main.tsx'), /import '\.\.\/app\/globals\.css'/);
  assert.doesNotMatch(css, /(?:url\(|@import\s*)["']?(?:https?:)?\/\//);
});

test('official palette, condensed hierarchy and square panels reach all primary surfaces', () => {
  assert.equal(tokens['--ink'], '#13191b'); assert.equal(tokens['--panel-raised'], '#263238');
  assert.equal(tokens['--line'], '#31424a'); assert.equal(tokens['--line-strong'], '#546e7a');
  assert.equal(tokens['--cream'], '#cfd8dc'); assert.equal(tokens['--accent'], '#e53935');
  for (const selector of ['.intel-panel h2', '.topbar h1', '.session-header h1', '.session-recent h2',
    '.intel-tabs button', '.activity-view button', '.results-ratios', '.enemy-table', '.session-table', '.results-date-range input']) assert.ok(theme.includes(selector));
  assert.match(theme, /font-family: var\(--font-heading\)[^}]*text-transform: uppercase/);
  assert.match(theme, /\.session-empty \{ border-radius: 0; \}/);
  assert.match(theme, /\.session-metrics \{[^}]*border-top: 3px solid var\(--accent\)/);
});

function luminance(hex) {
  const full = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
  const [r, g, b] = full.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(a, b) { const [hi, lo] = [luminance(a), luminance(b)].sort((a, b) => b - a); return (hi + .05) / (lo + .05); }
test('reading text and active controls retain readable contrast on all main surfaces', () => {
  for (const foreground of ['--cream', '--muted', '--activity-ink', '--activity-muted', '--ally', '--hostile']) {
    for (const background of ['--ink', '--panel', '--panel-raised']) {
      assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, `${foreground} on ${background}`);
    }
  }
  for (const background of ['--accent-fill', '--accent-hover']) assert.ok(contrast(tokens['--accent-text'], tokens[background]) >= 4.5);
  assert.ok(contrast(tokens['--focus'], tokens['--panel-raised']) >= 3);
});

test('brand red does not replace tactical semantics or change marker geometry and name casing', () => {
  const expected = { '--signal': '#b8ef46', '--ally': '#82d9ff', '--hostile': '#ff6b55', '--air-ally': '#74d1ff',
    '--air-enemy': '#ff6559', '--ground-ally': '#aaa2ff', '--ground-enemy': '#ffb35c', '--base-friendly': '#74b6e8', '--base-enemy': '#e67b73' };
  for (const [name, color] of Object.entries(expected)) assert.equal(tokens[name], color);
  assert.doesNotMatch(theme, /\.map-marker|\.aircraft-symbol|\.game-target-reticle|\.runway|\.base-symbol/);
  assert.doesNotMatch(theme, /\.combat-(?:ally|enemy|self|unknown)\s*\{/);
  assert.match(css, /\.aircraft-title\s*\{[^}]*text-transform: none/);
  assert.match(theme, /\.tactical-shell :is\(button, input, select, \[tabindex\]\):focus-visible/);
  assert.match(theme, /@media \(prefers-reduced-motion: reduce\)/);
});

test('font licensing is carried into the standalone HTML and the executable workflow', () => {
  const notice = read('public/font-notices.txt');
  assert.match(notice, /Copyright 2011 Google Inc/);
  assert.match(notice, /Apache License[\s\S]+Version 2\.0, January 2004/);
  assert.match(notice, /END OF TERMS AND CONDITIONS/);
  for (const font of fonts) assert.ok(notice.includes(`https://warthunder.com/assets/fonts/${font.source}.ttf`));
  assert.match(read('scripts/inline-portable.mjs'), /readFile\(resolve\(projectRoot, 'public\/font-notices\.txt'\)/);
  assert.match(read('vite.portable.config.ts'), /assetsInlineLimit: 100_000_000/);
  assert.match(read('scripts/build-windows.ps1'), /\/resource:\$vectorHtml,Vector\.html/);
});
