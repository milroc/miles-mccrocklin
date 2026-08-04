// BuilderTagline — the splash tagline restated under the /builder/
// header, so the page opens with the same one-line identity frame the
// front door uses. Sourced from the generated splash-content module
// (single source of truth: data/splash.json), never hand-copied.
// Referential register, so "FB" stays "FB" here — see DESIGN.md
// "Naming".

import { SPLASH_TAGLINE } from '../generated/splash-content';
import s from './BuilderTagline.module.css';

export function BuilderTagline(): JSX.Element {
  return <p className={s.root}>{SPLASH_TAGLINE}</p>;
}
