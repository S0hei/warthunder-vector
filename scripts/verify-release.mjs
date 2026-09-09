import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fonts } from './warthunder-fonts.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, `v${pkg.version}`);
const versionSource = await readFile(new URL('native/Version.cs', root), 'utf8');
assert(versionSource.includes(`Current = "${pkg.version}"`));
// An alternate local build can be verified while the installed Vector.exe runs.
// Release asset names stay canonical regardless of that local filename.
const exeName = process.argv[2] ?? 'Vector.exe';
assert(/^[\w .-]+\.exe$/.test(exeName) && !exeName.includes('..'), 'Expected an executable filename');
const exe = await readFile(new URL(exeName, root)), html = await readFile(new URL('Vector.html', root));
assert(exe.includes(html), 'Executable embeds the current portable HTML');
assert(exe.includes(await readFile(new URL('app/lib/translations/ru.json', root))), 'Executable embeds the current tray translations');
for (const text of ['Русский', 'Результаты боёв', 'vector-language']) assert(html.includes(text), `Portable language support: ${text}`);
for (const font of fonts) assert(html.includes((await readFile(new URL(`app/assets/fonts/${font.file}`, root))).toString('base64')));
for (const text of ['Apache License', 'Last damage', 'Custom period', '/api/version']) assert(html.includes(text), text);
assert(!/main\.tsx|<script\b[^>]*\bsrc=/i.test(html.toString()), 'No external app scripts');
assert(exe.length < 64 * 1024 * 1024, 'Executable is within updater size limit');
const digest = data => createHash('sha256').update(data).digest('hex');
await writeFile(new URL('SHA256SUMS', root), `${digest(exe)}  Vector.exe\n${digest(html)}  Vector.html\n`);
console.log(`Verified Vector ${pkg.version}, embedded assets and release checksums.`);
