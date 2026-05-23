// One-shot: downsize existing committed photos in media/photography/ to
// the new MAX_WIDTH. Run after lowering MAX_WIDTH in
// scripts/ingest-photography.ts. Idempotent: files already at or below
// the target width are left alone.
//
// After running this, also nuke media/portfolio/derived/ so the build
// regenerates variants at the new sizes:
//
//   bun run scripts/downsize-photography.ts
//   rm -rf media/portfolio/derived
//   bun run build
//
// Run:
//   bun run scripts/downsize-photography.ts            # uses MAX_WIDTH = 1280
//   bun run scripts/downsize-photography.ts 1600       # override

import { readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dir, '..');
const DIR = join(ROOT, 'media', 'photography');
const TARGET = Number(process.argv[2] ?? 1280);
const QUALITY = 92;

if (!Number.isFinite(TARGET) || TARGET < 200 || TARGET > 6000) {
  console.error(`downsize-photography: invalid target width ${process.argv[2]}`);
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => /\.jpe?g$/i.test(f)).sort();
console.log(`downsize-photography: ${files.length} files in ${DIR}, target ${TARGET}w`);

let downsized = 0;
let skipped = 0;
let bytesBefore = 0;
let bytesAfter = 0;

for (const file of files) {
  const abs = join(DIR, file);
  const sizeBefore = statSync(abs).size;
  const { width } = await sharp(abs).metadata();

  if (!width) {
    console.warn(`  ${file}: no width metadata, skipping`);
    skipped += 1;
    continue;
  }

  if (width <= TARGET) {
    skipped += 1;
    continue;
  }

  const tmp = `${abs}.tmp`;
  await sharp(abs)
    .resize({ width: TARGET, withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(tmp);

  unlinkSync(abs);
  renameSync(tmp, abs);

  const sizeAfter = statSync(abs).size;
  bytesBefore += sizeBefore;
  bytesAfter += sizeAfter;
  downsized += 1;

  if (downsized % 20 === 0) {
    console.log(`  ...${downsized} downsized`);
  }
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
console.log(
  `downsize-photography: done. downsized=${downsized} skipped=${skipped} ` +
    `before=${mb(bytesBefore)} MB after=${mb(bytesAfter)} MB ` +
    `(saved ${mb(bytesBefore - bytesAfter)} MB)`,
);
console.log('next: rm -rf media/portfolio/derived && bun run build');
