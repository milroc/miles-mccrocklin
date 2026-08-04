// LoadingGlobe — explorer's pre-WebGL loading state. Wraps the shared
// <WireGlobe> (src/globe/WireGlobe.tsx — same sphere the splash hero
// uses, so splash → explorer reads as a continuation) in an
// explorer-sized scene with a pulsing "loading" label. Shown inside
// Explorer's mount div until the WebGL canvas fades in over it.
//
// Failure state: when mountGlobe() rejects, Explorer sets
// data-globe-failed on the mount container. CSS in the module swaps
// the pulsing label for .failure — a quiet mono note that the WebGL
// globe isn't coming, plus a door out to /photographer/. The failure
// block is display:none in both the loading and mounted states, so it
// can never flash during a normal load.

import { WireGlobe } from '../globe/WireGlobe';
import s from './LoadingGlobe.module.css';

export function LoadingGlobe(): JSX.Element {
  return (
    <>
      <div className={s.scene} aria-hidden="true">
        <WireGlobe />
      </div>
      <span className={s.label}>loading</span>
      <p className={s.failure}>
        <span className={s.failureNote}>the interactive globe needs WebGL</span>
        <a className={s.failureCta} href="/photographer/">the photos live here →</a>
      </p>
    </>
  );
}
