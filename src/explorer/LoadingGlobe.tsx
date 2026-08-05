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
      {/* Both failure notes render; the mount container's
          data-globe-failed VALUE ('webgl' | 'load') picks which shows,
          so the copy always names the actual cause. Retry only appears
          for load failures — reloading can't conjure WebGL. */}
      <p className={s.failure}>
        <span className={`${s.failureNote} ${s.whenWebgl}`}>the interactive globe needs WebGL</span>
        <span className={`${s.failureNote} ${s.whenLoad}`}>the globe's map data didn't load</span>
        <span className={s.failureCtas}>
          <a className={`${s.failureCta} ${s.whenLoad}`} href="">try again →</a>
          <a className={s.failureCta} href="/photographer/">the photos live here →</a>
        </span>
      </p>
    </>
  );
}
