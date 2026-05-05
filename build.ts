// Production build.
//
// Uses Bun's JS bundler API instead of `bun build --minify` because the
// CLI's `--minify` umbrella flag emits a broken JSX-runtime binding
// (`h=void 0`) for our entry, which crashes on first render. Passing the
// granular `minify: { ... }` options to Bun.build() avoids that path.

import { rmSync, cpSync, writeFileSync } from 'node:fs';

rmSync('./dist', { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ['./index.html'],
  outdir: './dist',
  minify: { whitespace: true, identifiers: true, syntax: true },
  sourcemap: 'linked',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

cpSync('./media', './dist/media', { recursive: true });
cpSync('./favicon-32.png', './dist/favicon-32.png');
writeFileSync('./dist/CNAME', 'miles.mccrockl.in');
writeFileSync('./dist/.nojekyll', '');

for (const out of result.outputs) {
  console.log('  ' + out.path.replace(process.cwd() + '/', ''));
}
