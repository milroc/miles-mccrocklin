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
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { MediaCtx, prefersReducedMotion, mediaSrc, isUiItem } from '../utils/media';
import type { MediaItem } from '../types';
import s from './MediaProvider.module.css';

interface MediaProviderProps {
  children: ReactNode;
}

// The slide list is rendered three times so we can shift scrollLeft by one
// "set width" whenever the active position crosses out of the middle copy.
// The jump lands on a visually identical slide, so navigation feels infinite.
const COPIES = 3;

export function MediaProvider({ children }: MediaProviderProps) {
  // openIdx is an index into the *rendered* track (which contains COPIES ×
  // scope.length slides). null when the lightbox is closed. The logical
  // photo index (used for counter, caption, video play) is `openIdx % N`.
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [scope, setScope] = useState<MediaItem[] | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  // Per-session set of graphic-content photo ids the viewer revealed
  // from inside the lightbox. Resets when the page reloads — matches
  // the conservative default in MasonryWall. Not shared with the
  // masonry's own set; the masonry strips graphic=true on items it
  // already revealed before passing them to the lightbox.
  const [lightboxRevealed, setLightboxRevealed] = useState<Set<string>>(
    () => new Set(),
  );
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

  // Loop landmarks (re-measured on open and on resize). copyBStart is the
  // offsetLeft of the first slide in the middle copy; copyCStart is the
  // first slide of the right clone. setWidth is the distance between
  // identical slides one copy apart.
  const setWidthRef = useRef(0);
  const copyBStartRef = useRef(0);
  const copyCStartRef = useRef(0);
  const jumpingRef = useRef(false);

  const list = scope ?? [];
  const N = list.length;
  const logicalIdx = openIdx == null ? null : ((openIdx % N) + N) % N;
  const cur = logicalIdx != null ? list[logicalIdx] ?? null : null;

  const open = (scopeItems: MediaItem[], id: string): void => {
    // Drop embeds from the lightbox scope — the lightbox renders <img> /
    // <video>, so an embed (Facebook plugin, YouTube, etc.) shows up as a
    // broken image while its iframe in the page beneath the modal keeps
    // playing. Embed cards are non-clickable divs, so id is always an
    // image/video and survives the filter.
    const filtered = scopeItems.filter((p) => p.type !== 'embed');
    const i = filtered.findIndex((x) => x.id === id);
    if (i >= 0) {
      const active = (typeof document !== 'undefined' ? document.activeElement : null);
      triggerRef.current = active instanceof HTMLElement ? active : null;
      setScope(filtered);
      // Open into the middle copy so the user can swipe in either
      // direction immediately without hitting an edge.
      setOpenIdx(filtered.length + i);
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

  // Render the slide list three times. Stable identity per copy via a
  // prefixed key so React reuses DOM nodes across re-renders.
  const renderedSlides = useMemo(() => {
    const out: { p: MediaItem; key: string; renderedIdx: number }[] = [];
    for (let c = 0; c < COPIES; c++) {
      list.forEach((p, i) => {
        out.push({ p, key: `${c}-${p.id}`, renderedIdx: c * list.length + i });
      });
    }
    return out;
  }, [list]);

  // Measure the loop landmarks. Called after the track is sized and any
  // time it resizes. Returns false if the track isn't laid out yet.
  const measureLoop = (): boolean => {
    const track = trackRef.current;
    if (!track || !N) return false;
    const slides = track.children;
    if (slides.length < N * COPIES) return false;
    const a = (slides[0] as HTMLElement).offsetLeft;
    copyBStartRef.current = (slides[N] as HTMLElement).offsetLeft;
    copyCStartRef.current = (slides[2 * N] as HTMLElement).offsetLeft;
    setWidthRef.current = copyBStartRef.current - a;
    return setWidthRef.current > 0;
  };

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
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
      measureLoop();
    });
    // Only re-anchor when the lightbox first opens — subsequent index
    // changes are driven BY scroll (or arrow keys, which scroll
    // programmatically with smooth behavior, also gated by
    // programmaticScrollRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIdx == null]);

  // Re-measure on viewport resize while open so the loop boundaries stay
  // accurate as the user rotates a device or resizes the window.
  useEffect(() => {
    if (openIdx == null) return;
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => measureLoop());
    ro.observe(track);
    return () => ro.disconnect();
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

  // Sync openIdx ← scroll position, then loop-normalize. The slide-width
  // assumption (slide == viewport) is only true on mobile; on desktop
  // slides are 72vw with 14vw peek. So instead of `Math.round(scrollLeft
  // / clientWidth)`, find the slide whose center is closest to the
  // viewport's snap-center. After picking the active slide, if the scroll
  // position has crossed out of the middle copy, shift scrollLeft by one
  // set width so we land on the visually identical slide back in copy B.
  const onScroll = (): void => {
    if (programmaticScrollRef.current || jumpingRef.current) return;
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
    const setWidth = setWidthRef.current;
    const left = track.scrollLeft;
    let nextIdx = closest;
    let nextLeft: number | null = null;
    if (setWidth) {
      if (left >= copyCStartRef.current) {
        nextLeft = left - setWidth;
        nextIdx = closest - N;
      } else if (left < copyBStartRef.current) {
        nextLeft = left + setWidth;
        nextIdx = closest + N;
      }
    }
    if (nextLeft != null) {
      jumpingRef.current = true;
      // Disable snap during the jump so mandatory scroll-snap doesn't try
      // to re-snap to the position we just left.
      const prevSnap = track.style.scrollSnapType;
      track.style.scrollSnapType = 'none';
      track.scrollLeft = nextLeft;
      requestAnimationFrame(() => {
        track.style.scrollSnapType = prevSnap;
        jumpingRef.current = false;
      });
    }
    if (nextIdx !== openIdx && nextIdx >= 0 && nextIdx < N * COPIES) {
      setOpenIdx(nextIdx);
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

  // Smooth-scroll the track to a given rendered index. Same fix as the
  // initial useLayoutEffect: scrollIntoView against the actual slide
  // element, not arithmetic on track.clientWidth (which doesn't match
  // slide width on desktop). The destination may briefly land in copy A
  // or C (one slide off either edge of B); after the smooth scroll
  // settles, the onScroll loop normalizer pulls it back into B. The
  // pre/post slides are visually identical so the snap-back is invisible.
  const navigateTo = (next: number): void => {
    const track = trackRef.current;
    if (!track) return;
    if (next < 0 || next >= track.children.length) return;
    const slide = track.children[next] as HTMLElement | undefined;
    if (!slide) return;
    programmaticScrollRef.current = true;
    slide.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    setOpenIdx(next);
    setChromeVisible(true);
    armChromeTimer();
    // Smooth scroll completes around the next animation frame batch; run
    // the normalizer once it does.
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
      onScroll();
    }, 400);
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

  // UI items get a dedicated about-text panel beside the screenshot instead
  // of the photo-style bottom gradient overlay. Driven by `subtype: 'ui'`
  // in me.json — see isUiItem in src/utils/media.ts.
  const isUi = isUiItem(cur);
  const lightboxClass = `${s.lightbox} ${chromeVisible ? s.chromeVisible : s.chromeHidden}${isUi ? ` ${s.ui}` : ''}`;

  return (
    <MediaCtx.Provider value={{ open }}>
      {children}
      {cur && openIdx != null && logicalIdx != null && (
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
            <span className={s.counter} aria-label={`Photo ${logicalIdx + 1} of ${N}`}>
              {logicalIdx + 1} / {N}
            </span>
          </div>
          <div
            className={s.track}
            ref={trackRef}
            onScroll={onScroll}
            onClick={onTrackClick}
          >
            {renderedSlides.map(({ p, key, renderedIdx }) => {
              // Graphic-content gate: re-uses the same UX as the masonry
              // tile — image blurred behind a centered "Reveal"
              // overlay. The masonry strips graphic=true for items it
              // already revealed there, so the lightbox only sees this
              // for photos the viewer hasn't yet opted into.
              const isGated = !!p.graphic && !lightboxRevealed.has(p.id);
              // The video here has no `controls`, so aria-hidden on the
              // slide wrapper does not strand focusable descendants. If
              // controls are ever added, this aria-hidden has to move or
              // the inactive slides need `inert` instead.
              // Inner media is wrapped in a .mediaBox for gated slides so
              // the graphic overlay can anchor to the actual displayed
              // image bounds (aspect-constrained, letterboxed by the
              // flex parent) rather than the entire slide. Aspect
              // ratio is taken from the photo's metadata; we fall back
              // to plain {img|video} when aspect is missing OR the
              // slide isn't gated, to keep the non-gated render path
              // structurally unchanged.
              const aspect = p.aspect && p.aspect > 0 ? p.aspect : undefined;
              const renderMedia = (): JSX.Element =>
                p.type === 'video' ? (
                  <video
                    src={mediaSrc(p.src)}
                    poster={mediaSrc(p.poster)}
                    autoPlay={renderedIdx === openIdx && !prefersReducedMotion()}
                    loop={!prefersReducedMotion()}
                    playsInline
                    muted
                  />
                ) : (
                  <img src={mediaSrc(p.src)} alt={p.caption || ''} draggable={false} />
                );
              return (
                <div
                  key={key}
                  className={`${s.slide} ${isGated ? s.slideGated : ''}`}
                  data-idx={renderedIdx}
                  aria-hidden={renderedIdx !== openIdx}
                >
                  {isGated && aspect ? (
                    <div
                      className={s.mediaBox}
                      style={{ aspectRatio: String(aspect) }}
                    >
                      {renderMedia()}
                      {renderedIdx === openIdx && (
                        // Only render the reveal CTA on the active slide.
                        // Gated peek slides stay blurred but pass clicks
                        // through to the track's navigation handler so the
                        // viewer can swipe past them without revealing.
                        <button
                          type="button"
                          className={s.graphicOverlay}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxRevealed((cur) => {
                              const next = new Set(cur);
                              next.add(p.id);
                              return next;
                            });
                          }}
                          aria-label="Reveal graphic content"
                        >
                          <span className={s.graphicBadge}>Graphic content</span>
                          <span className={s.graphicHint}>Reveal</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    renderMedia()
                  )}
                </div>
              );
            })}
          </div>
          {N > 1 && (
            <>
              <button
                type="button"
                className={`${s.nav} ${s.prev}`}
                onClick={(e) => { e.stopPropagation(); navigateTo(openIdx - 1); }}
                aria-label="Previous photo"
              >‹</button>
              <button
                type="button"
                className={`${s.nav} ${s.next}`}
                onClick={(e) => { e.stopPropagation(); navigateTo(openIdx + 1); }}
                aria-label="Next photo"
              >›</button>
            </>
          )}
          {(cur.caption || cur.tag || cur.album_url) && (
            isUi ? (
              // UI mode: about-text in a dedicated panel beside (desktop) or
              // below (mobile) the screenshot. Stays visible while topbar +
              // nav fade with the chrome-idle timer.
              <aside className={s.panel} aria-label="About this surface">
                {cur.tag && <span className={s.panelTag}>{cur.tag}</span>}
                {cur.caption && <p className={s.panelText}>{cur.caption}</p>}
              </aside>
            ) : (
              <div className={s.caption}>
                {cur.caption && <span className={s.captionText}>{cur.caption}</span>}
                {cur.prose_provenance?.caption && (
                  <span className={s.byAi}>Caption by AI</span>
                )}
                {cur.tag && <span className={s.captionTag}>{cur.tag}</span>}
                {cur.album_url && (
                  <a
                    className={s.albumCta}
                    href={cur.album_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View full album →
                  </a>
                )}
              </div>
            )
          )}
        </div>
      )}
    </MediaCtx.Provider>
  );
}
