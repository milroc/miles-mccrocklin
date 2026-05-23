// Toolbar — Explorer's top-left chrome: a rotation on/off toggle that
// drives Globe's setRotationLocked. The toggle is purely a UI control;
// the rotation lock state lives in the Explorer page so it can plumb
// it into the globe handle. The previous "← back" link lived here too;
// it's now redundant because the shared SiteNav brand (top of page)
// already routes home.

import s from './Toolbar.module.css';

interface ToolbarProps {
  rotationOn: boolean;
  onToggleRotation: () => void;
  // Fades with the SiteNav so the globe goes uncluttered when idle.
  // Any cursor or keyboard activity brings both back together.
  visible: boolean;
}

export function Toolbar({
  rotationOn,
  onToggleRotation,
  visible,
}: ToolbarProps): JSX.Element {
  return (
    <div
      className={`${s.root} ${visible ? '' : s.rootHidden}`}
      aria-hidden={!visible}
    >
      <button
        type="button"
        className={s.rotateToggle}
        onClick={onToggleRotation}
        aria-pressed={rotationOn}
        aria-label={rotationOn ? 'Pause rotation' : 'Resume rotation'}
        data-active={rotationOn}
        tabIndex={visible ? 0 : -1}
      >
        <span className={s.rotateIcon} aria-hidden="true">↻</span>
        {rotationOn ? 'rotate: on' : 'rotate: off'}
      </button>
    </div>
  );
}
