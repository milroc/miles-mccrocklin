// LoadingGlobe — CSS 3D wireframe globe (meridians + parallels)
// shown inside Explorer's mount div until the WebGL canvas fades in
// over it. No JS; pure CSS animation. Same visual register as the
// splash's static wireframe so the transition between pages reads as
// a continuation.

import s from './LoadingGlobe.module.css';

export function LoadingGlobe(): JSX.Element {
  return (
    <>
      <div className={s.scene} aria-hidden="true">
        <div className={s.globe}>
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
      <span className={s.label}>loading</span>
    </>
  );
}
