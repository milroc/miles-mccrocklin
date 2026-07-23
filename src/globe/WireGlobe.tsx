// WireGlobe — the CSS 3D wireframe globe (meridians + parallels)
// spinning around a slightly-tilted polar axis. Owned here because two
// pages consume it: the splash renders it as the hero's base state
// (and the permanent state when WebGL never mounts), and
// /explorer/'s LoadingGlobe wraps it as the pre-WebGL loading state.
// One implementation is what makes splash → explorer read as a
// continuation.
//
// Sizing contract: fills 100% of its parent. The parent supplies the
// square (aspect-ratio: 1) and any entrance animation; WireGlobe only
// owns the sphere. Decorative — always aria-hidden.

import s from './WireGlobe.module.css';

export function WireGlobe(): JSX.Element {
  return (
    <div className={s.root} aria-hidden="true">
      <div className={s.sphere}>
        <div className={s.meridian} />
        <div className={s.meridian} />
        <div className={s.meridian} />
        <div className={s.meridian} />
        <div className={s.meridian} />
        <div className={s.meridian} />
        <div className={`${s.parallel} ${s.parallelEq}`} />
        <div className={`${s.parallel} ${s.parallel30N}`} />
        <div className={`${s.parallel} ${s.parallel30S}`} />
        <div className={`${s.parallel} ${s.parallel60N}`} />
        <div className={`${s.parallel} ${s.parallel60S}`} />
      </div>
    </div>
  );
}
