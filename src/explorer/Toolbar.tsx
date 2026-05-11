// Toolbar — Explorer's top-left chrome: a back link to the splash and
// a rotation on/off toggle that drives Globe's setRotationLocked. The
// toggle is purely a UI control; the rotation lock state lives in the
// Explorer page so it can plumb it into the globe handle.

import s from './Toolbar.module.css';

interface ToolbarProps {
  rotationOn: boolean;
  onToggleRotation: () => void;
}

export function Toolbar({ rotationOn, onToggleRotation }: ToolbarProps): JSX.Element {
  return (
    <div className={s.root}>
      <a className={s.back} href="/" aria-label="Back to home">← back</a>
      <button
        type="button"
        className={s.rotateToggle}
        onClick={onToggleRotation}
        aria-pressed={rotationOn}
        aria-label={rotationOn ? 'Pause rotation' : 'Resume rotation'}
        data-active={rotationOn}
      >
        <span className={s.rotateIcon} aria-hidden="true">↻</span>
        {rotationOn ? 'rotate: on' : 'rotate: off'}
      </button>
    </div>
  );
}
