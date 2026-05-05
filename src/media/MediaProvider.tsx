// Lightbox + media-context provider. Wrap the app so any Figure can open
// its scope into the global overlay. The overlay is a single instance;
// every Figure passes its own items as the lightbox scope when opening.
//
// The lightbox is a native scroll-snap carousel — the browser owns swipes,
// momentum, and rubber-band edges; this file owns chrome (close, counter,
// nav, caption, focus management).
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { MediaCtx, prefersReducedMotion } from '../utils/media';
import type { MediaItem } from '../types';
import s from './MediaProvider.module.css';

interface MediaProviderProps {
  children: ReactNode;
}

export function MediaProvider({ children }: MediaProviderProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [scope, setScope] = useState<MediaItem[] | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const trackRef = useRef<HTMLDivElement | null>(null);
  // True while a programmatic scroll is in flight. Suppresses the scroll
  // listener's "snap into a new index" path so we don't fight ourselves.
  const programmaticScrollRef = useRef(false);
  const chromeTimerRef = useRef<number | null>(null);
  // Pending 500ms timer to show chrome when the mouse moves while hidden.
  // Filters out incidental cursor motion: chrome only re-appears if the
  // user actually keeps the cursor inside the lightbox for half a second.
  const showChromeTimerRef = useRef<number | null>(null);
  // Modal a11y plumbing: remember what triggered the open so we can
  // restore focus on close.
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const open = (scopeItems: MediaItem[], id: string): void => {
    // Drop embeds from the lightbox scope — the lightbox renders <img> /
    // <video>, so an embed (Facebook plugin, YouTube, etc.) shows up as a
    // broken image while its iframe in the page beneath the modal keeps
    // playing. Embed cards are non-clickable divs, so id is always an
    // image/video and survives the filter.
    const list = scopeItems.filter((p) => p.type !== 'embed');
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) {
      const active = (typeof document !== 'undefined' ? document.activeElement : null);
      triggerRef.current = active instanceof HTMLElement ? active : null;
      setScope(list);
      setOpenIdx(i);
      setChromeVisible(true);
    }
  };

  const close = (): void => {
    setOpenIdx(null);
    setScope(null);
    setChromeVisible(true);
    if (chromeTimerRef.current != null) {
      window.clearTimeout(chromeTimerRef.current);
      chromeTimerRef.current = null;
    }
    if (showChromeTimerRef.current != null) {
      window.clearTimeout(showChromeTimerRef.current);
      showChromeTimerRef.current = null;
    }
    const el = triggerRef.current;
    triggerRef.current = null;
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus());
    }
  };

  const list = scope ?? [];

  // Place the track at the active slide on first render. We can't compute
  // `openIdx * track.clientWidth` because on desktop the slides are 72vw
  // while the track's clientWidth is 100vw — that mismatch makes mandatory
  // scroll-snap land on the wrong slide. Use `scrollIntoView` against the
  // actual slide element so the math is the browser's problem, not ours.
  useLayoutEffect(() => {
    if (openIdx == null) return;
    const track = trackRef.current;
    if (!track) return;
    const slide = track.children[openIdx] as HTMLElement | undefined;
    if (!slide) return;
    programmaticScrollRef.current = true;
    slide.scrollIntoView({ behavior: 'instant' as ScrollBehavior, inline: 'center', block: 'nearest' });
    requestAnimationFrame(() => { programmaticScrollRef.current = false; });
    // Only re-anchor when the lightbox first opens — subsequent index
    // changes are driven BY scroll (or arrow keys, which scroll
    // programmatically with smooth behavior, also gated by
    // programmaticScrollRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIdx == null]);

  // Video playback follows the active slide. The HTML `autoPlay` attribute
  // only fires on initial mount and doesn't react to subsequent prop
  // changes, so we drive play imperatively here. Videos are muted (a hard
  // requirement for autoplay in modern browsers).
  useEffect(() => {
    if (openIdx == null) return;
    const track = trackRef.current;
    if (!track) return;
    const slides = track.querySelectorAll<HTMLDivElement>(`.${s.slide}`);
    slides.forEach((slide, i) => {
      const video = slide.querySelector<HTMLVideoElement>('video');
      if (!video) return;
      if (i === openIdx) {
        // Resume from current position on re-visit instead of restarting.
        video.play().catch(() => {/* autoplay rejected — silent */});
      } else {
        if (!video.paused) video.pause();
      }
    });
  }, [openIdx]);

  // Auto-hide chrome 1.2s after the mouse becomes idle. Each mouse move
  // re-arms the timer, so the countdown only runs while the cursor is
  // still — same model as a video player.
  const armChromeTimer = (): void => {
    if (chromeTimerRef.current != null) window.clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = window.setTimeout(() => setChromeVisible(false), 1200);
  };
  useEffect(() => {
    if (openIdx == null) return;
    setChromeVisible(true);
    armChromeTimer();
    return () => {
      if (chromeTimerRef.current != null) window.clearTimeout(chromeTimerRef.current);
      if (showChromeTimerRef.current != null) window.clearTimeout(showChromeTimerRef.current);
    };
  }, [openIdx]);

  // Mouse activity inside the lightbox.
  // - Visible: every move re-arms the hide timer, so the chrome only fades
  //   when the cursor has actually been still for that long.
  // - Hidden: schedule a one-shot 500ms timer that brings chrome back. The
  //   delay filters incidental cursor motion (scroll-jiggle, autoscroll,
  //   pointer drift) — only intentional dwell triggers the re-show.
  // mousemove (not pointermove) is intentional: touch users keep the
  // tap-to-toggle gesture and shouldn't trigger this auto-show path.
  const onLightboxMouseMove = (): void => {
    if (chromeVisible) {
      armChromeTimer();
      return;
    }
    if (showChromeTimerRef.current != null) return;
    showChromeTimerRef.current = window.setTimeout(() => {
      showChromeTimerRef.current = null;
      setChromeVisible(true);
      armChromeTimer();
    }, 500);
  };

  // Sync openIdx ← scroll position. The slide-width assumption (slide ==
  // viewport) is only true on mobile; on desktop slides are 72vw with 14vw
  // peek. So instead of `Math.round(scrollLeft / clientWidth)`, find the
  // slide whose center is closest to the viewport's snap-center.
  const onScroll = (): void => {
    if (programmaticScrollRef.current) return;
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const trackCenter = track.scrollLeft + track.clientWidth / 2;
    let closest = 0;
    let bestDist = Infinity;
    for (let i = 0; i < track.children.length; i++) {
      const el = track.children[i] as HTMLElement;
      const slideCenter = el.offsetLeft + el.offsetWidth / 2;
      const d = Math.abs(slideCenter - trackCenter);
      if (d < bestDist) { bestDist = d; closest = i; }
    }
    if (closest !== openIdx && closest >= 0 && closest < list.length) {
      setOpenIdx(closest);
    }
  };

  // Tap on photo (not a swipe) toggles chrome visibility. Browsers only
  // fire 'click' when pointer movement was below the drag threshold, so
  // swipes don't accidentally trigger this.
  // Click on a peek slide (the partial neighbor on either side) navigates
  // to that slide — turns the peeks themselves into the prev/next hit area.
  const onTrackClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement | null;
    const slide = target?.closest(`.${s.slide}`) as HTMLElement | null;
    const idxAttr = slide?.dataset.idx;
    const idx = idxAttr != null ? Number.parseInt(idxAttr, 10) : NaN;
    if (Number.isFinite(idx) && idx !== openIdx) {
      navigateTo(idx);
      return;
    }
    setChromeVisible((v) => {
      const next = !v;
      if (next) armChromeTimer();
      else if (chromeTimerRef.current != null) {
        window.clearTimeout(chromeTimerRef.current);
        chromeTimerRef.current = null;
      }
      return next;
    });
  };

  // Smooth-scroll the track to a given index. Same fix as the initial
  // useLayoutEffect: scrollIntoView against the actual slide element, not
  // arithmetic on track.clientWidth (which doesn't match slide width on
  // desktop).
  const navigateTo = (next: number): void => {
    const track = trackRef.current;
    if (!track) return;
    if (next < 0 || next >= list.length) return;
    const slide = track.children[next] as HTMLElement | undefined;
    if (!slide) return;
    programmaticScrollRef.current = true;
    slide.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    setOpenIdx(next);
    setChromeVisible(true);
    armChromeTimer();
    // Smooth scroll completes around the next animation frame batch.
    window.setTimeout(() => { programmaticScrollRef.current = false; }, 400);
  };

  useEffect(() => {
    if (openIdx == null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowRight') { navigateTo(openIdx + 1); return; }
      if (e.key === 'ArrowLeft')  { navigateTo(openIdx - 1); return; }
      if (e.key === 'Tab') {
        // Trap focus inside the dialog so keyboard users can't tab into the
        // (visually obscured) page beneath the modal.
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!focusables.length) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (!active || !dialog.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIdx, list.length]);

  // Background `inert` while the lightbox is open: removes the page beneath
  // from the focus order and AT tree, so Tab can't escape the modal and SR
  // users don't read through the resume content while the dialog is up.
  useEffect(() => {
    if (openIdx == null) return;
    const app = document.querySelector('.app') as HTMLElement | null;
    if (!app) return;
    app.setAttribute('inert', '');
    return () => app.removeAttribute('inert');
  }, [openIdx == null]);

  // Focus the close button when the lightbox opens so keyboard users land
  // inside the dialog.
  useEffect(() => {
    if (openIdx == null) return;
    const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [openIdx == null]);

  // Keep chrome visible while focus is inside the dialog. The 1.2s
  // auto-hide is for tap-driven mobile sessions; keyboard users can't tap
  // the photo to bring chrome back, so we keep nav/close visible whenever
  // they're focused.
  useEffect(() => {
    if (openIdx == null) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onFocusIn = (): void => {
      // Keyboard activity (tab into a control) is treated like mouse
      // activity: surface the chrome and re-arm the idle timer.
      setChromeVisible(true);
      armChromeTimer();
    };
    dialog.addEventListener('focusin', onFocusIn);
    return () => dialog.removeEventListener('focusin', onFocusIn);
  }, [openIdx == null]);

  const cur = openIdx != null ? list[openIdx] ?? null : null;
  const lightboxClass = `${s.lightbox} ${chromeVisible ? s.chromeVisible : s.chromeHidden}`;

  return (
    <MediaCtx.Provider value={{ open }}>
      {children}
      {cur && openIdx != null && (
        <div
          className={lightboxClass}
          role="dialog"
          aria-modal="true"
          aria-label={cur.caption ? `Media viewer — ${cur.caption}` : 'Media viewer'}
          ref={dialogRef}
          onMouseMove={onLightboxMouseMove}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        >
          <div className={s.topbar}>
            <button
              ref={closeBtnRef}
              className={s.close}
              onClick={close}
              aria-label="Close"
            >
              <span aria-hidden="true">×</span>
            </button>
            <span className={s.counter} aria-label={`Photo ${openIdx + 1} of ${list.length}`}>
              {openIdx + 1} / {list.length}
            </span>
          </div>
          <div
            className={s.track}
            ref={trackRef}
            onScroll={onScroll}
            onClick={onTrackClick}
          >
            {list.map((p, i) => (
              // The video here has no `controls`, so aria-hidden on the
              // slide wrapper does not strand focusable descendants. If
              // controls are ever added, this aria-hidden has to move or
              // the inactive slides need `inert` instead.
              <div key={p.id} className={s.slide} data-idx={i} aria-hidden={i !== openIdx}>
                {p.type === 'video' ? (
                  <video
                    src={p.src}
                    poster={p.poster}
                    autoPlay={i === openIdx && !prefersReducedMotion()}
                    loop={!prefersReducedMotion()}
                    playsInline
                    muted
                  />
                ) : (
                  <img src={p.src} alt={p.caption || ''} draggable={false} />
                )}
              </div>
            ))}
          </div>
          {list.length > 1 && (
            <>
              <button
                type="button"
                className={`${s.nav} ${s.prev}`}
                onClick={(e) => { e.stopPropagation(); navigateTo(openIdx - 1); }}
                aria-label="Previous photo"
                disabled={openIdx === 0}
              >‹</button>
              <button
                type="button"
                className={`${s.nav} ${s.next}`}
                onClick={(e) => { e.stopPropagation(); navigateTo(openIdx + 1); }}
                aria-label="Next photo"
                disabled={openIdx === list.length - 1}
              >›</button>
            </>
          )}
          {(cur.caption || cur.tag) && (
            <div className={s.caption}>
              {cur.caption && <span className={s.captionText}>{cur.caption}</span>}
              {cur.tag && <span className={s.captionTag}>{cur.tag}</span>}
            </div>
          )}
        </div>
      )}
    </MediaCtx.Provider>
  );
}
