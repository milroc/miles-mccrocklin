// Edit mode is build-time gated. Bun replaces `process.env.NODE_ENV`
// with `"production"` for `bun build` (when invoked from the `build`
// script with NODE_ENV=production), so this evaluates to `false` in
// the production bundle and every `if (EDIT_ENABLED)` branch tree-shakes
// out. Dev runs with NODE_ENV=development → `true`.
export const EDIT_ENABLED = process.env.NODE_ENV !== 'production';
