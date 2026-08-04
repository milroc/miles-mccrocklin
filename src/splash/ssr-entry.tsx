// Splash SSR entry — bundler entrypoint for build.ts's prerender pass.
//
// This file exists so renderToString(<Splash />) runs against BUNDLER
// module resolution, not Bun-runtime resolution: the Bun runtime loads
// `*.module.css` imports as raw CSS source strings, so importing Splash
// directly from build.ts renders class="undefined" everywhere (the
// failure that killed the first SSR pass — commit aa94552; this is
// option (b) from build.ts's postmortem of that pass). build.ts
// bundles this entry to a scratch dir, imports the emitted JS, and
// injects renderSplash()'s markup into dist/index.html.
//
// Class-name parity with the client bundle is asserted by build.ts
// after injection, so a Bun upgrade that changes the hashing scheme
// fails the build instead of shipping a hydration mismatch.

import { renderToString } from 'react-dom/server';
import { Splash } from './Splash';

export function renderSplash(): string {
  return renderToString(<Splash />);
}
