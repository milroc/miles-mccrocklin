// Single source for the splash's desktop breakpoint. effects.tsx builds
// its WebGL-mount media query from this; Splash.module.css's
// `@media (min-width: 900px)` block must use the same number (CSS can't
// read TS constants — if you change one, change both).
export const SPLASH_DESKTOP_MIN_WIDTH = 900;

// Full predicate for mounting the WebGL globe on the splash: a viewport
// wide enough for the two-column layout AND a real pointer. Landscape
// phones exceed the width alone (iPhone Pro Max: 932px) — hover/pointer
// keeps them on the CSS wireframe, which is the designed mobile state.
export const SPLASH_DESKTOP_GLOBE_MQ =
  `(min-width: ${SPLASH_DESKTOP_MIN_WIDTH}px) and (hover: hover) and (pointer: fine)`;
