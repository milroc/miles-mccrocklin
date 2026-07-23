// Single source for the splash's desktop breakpoint. Splash.module.css's
// `@media (min-width: 900px)` block must use the same number (CSS can't
// read TS constants — if you change one, change both). The WebGL globe
// mounts on every viewport (mobile included) — see effects.tsx.
export const SPLASH_DESKTOP_MIN_WIDTH = 900;
