// Optional asset maintenance, never run by the app or its build.
// These exact, unmodified Apache-2.0 fonts are served by the official WT site.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const fonts = [
  { file: 'roboto-regular.ttf', source: 'Roboto/regular', sha256: '017c0be9aaa6d0359737e1fa762ad304c0e0107927faff5a6c1f415c7f5244ed' },
  { file: 'roboto-bold.ttf', source: 'Roboto/bold', sha256: 'c9cc991deb5d27f267830a19f2301eb164d9e61ec08669c1a1a291c5620ff40a' },
  { file: 'roboto-condensed-regular.ttf', source: 'RobotoCondensed/regular', sha256: 'f05ab6c1eade444bbf4e3e00710756e95c2a1d09a10425967149802219c0c0cb' },
  { file: 'roboto-condensed-bold.ttf', source: 'RobotoCondensed/bold', sha256: 'd1ab7a9092d779eb7eb97f3f7d4563c857e86572fb829c42f2972a8e232ec67d' },
];

export function verifyFont(data, expectedHash) {
  if (data.length < 1000 || data.length > 1_000_000 || data.readUInt32BE(0) !== 0x00010000 ||
    createHash('sha256').update(data).digest('hex') !== expectedHash) throw new Error('Font content differs from the verified official-site asset.');
}

if (process.argv.includes('--download')) {
  const directory = new URL('../app/assets/fonts/', import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const font of fonts) {
    const target = new URL(font.file, directory);
    try { verifyFont(await readFile(target), font.sha256); continue; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const response = await fetch(`https://warthunder.com/assets/fonts/${font.source}.ttf`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Font download failed (${response.status}).`);
    const data = Buffer.from(await response.arrayBuffer());
    verifyFont(data, font.sha256);
    await writeFile(target, data, { flag: 'wx' });
    console.log(`Bundled ${font.file} (${data.length} bytes)`);
  }
}
