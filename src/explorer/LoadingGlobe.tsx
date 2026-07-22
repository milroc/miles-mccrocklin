// LoadingGlobe — explorer's pre-WebGL loading state. Wraps the shared
// <WireGlobe> (src/globe/WireGlobe.tsx — same sphere the splash hero
// uses, so splash → explorer reads as a continuation) in an
// explorer-sized scene with a pulsing "loading" label. Shown inside
// Explorer's mount div until the WebGL canvas fades in over it.

import { WireGlobe } from '../globe/WireGlobe';
import s from './LoadingGlobe.module.css';

export function LoadingGlobe(): JSX.Element {
  return (
    <>
      <div className={s.scene} aria-hidden="true">
        <WireGlobe />
      </div>
      <span className={s.label}>loading</span>
    </>
  );
}
