// Optional asset-authoring step; normal builds use the committed ICO and inline brand.
// Usage: node scripts/build-icon.mjs [absolute path to a sharp module]
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = (await import(pathToFileURL(process.argv[2] ?? require.resolve('sharp')).href)).default;
// Keep the generated data URI stable across Windows and Linux checkouts.
const source = Buffer.from((await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')).replace(/\r\n/g, '\n'));
const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(async (size) => {
  const raster = sharp(source, { density: 384 }).resize(size, size);
  if (size === 256) return raster.png().toBuffer();
  // Classic 32-bit DIB frames are required for reliable .NET Framework
  // Icon.ToBitmap support at small sizes. Windows uses PNG for the 256px frame.
  const rgba = await raster.ensureAlpha().raw().toBuffer();
  const maskStride = Math.ceil(size / 32) * 4;
  const pixelsLength = size * size * 4;
  const dib = Buffer.alloc(40 + pixelsLength + maskStride * size);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8); // XOR bitmap plus the AND transparency mask.
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(pixelsLength + maskStride * size, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const bottomY = size - 1 - y;
      const to = 40 + (bottomY * size + x) * 4;
      dib[to] = rgba[from + 2];
      dib[to + 1] = rgba[from + 1];
      dib[to + 2] = rgba[from];
      dib[to + 3] = rgba[from + 3];
      if (rgba[from + 3] === 0) dib[40 + pixelsLength + bottomY * maskStride + (x >> 3)] |= 0x80 >> (x % 8);
    }
  }
  return dib;
}));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); // Windows icon, not a cursor.
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  header[entry] = header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frames[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frames[i].length;
}
await writeFile(new URL('../public/vector.ico', import.meta.url), Buffer.concat([header, ...frames]));
await writeFile(new URL('../app/lib/vector-brand.json', import.meta.url), JSON.stringify({
  src: `data:image/svg+xml;base64,${source.toString('base64')}`,
}) + '\n');
process.stdout.write(`Vector icon created (${sizes.join(', ')} px).\n`);
