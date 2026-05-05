// Lightning strikes: brief jagged typographic bolts arc from the cursor
// toward fixed anchors on the resume page, like the resume is a Faraday
// cage and the cursor is a charged surface discharging onto it. Each
// marquee carries a thematic phrase list (names, roles, teams, products,
// tools); each strike spells fragments of one of those phrases along its
// jagged path. Strikes are short flashes with a fast peak and a slower
// fade, separated by random quiet gaps. Five marquees fire on staggered
// cadences so the storm reads as organic, not synchronized.
//
// The whole bundle hides under prefers-reduced-motion and on print.

import './lightning.css';
import { LIGHTNING_MARQUEES as MARQUEES } from './me';

// Fixed viewport-Y fractions per marquee — same as before, anchors live
// in screen space so they never converge regardless of scroll.
const ANCHOR_Y_VIEWPORT = [0.10, 0.30, 0.50, 0.70, 0.90];

// Strike envelope. Total visible lifetime = peak + hold + decay.
//   peak: rapid ramp 0 → 1 (the snap of the bolt appearing)
//   hold: brief plateau at full brightness (the channel)
//   decay: linear fade 1 → 0 (the afterimage)
const STRIKE_PEAK_MS  = 60;
const STRIKE_HOLD_MS  = 80;
const STRIKE_DECAY_MS = 380;
const STRIKE_TOTAL_MS = STRIKE_PEAK_MS + STRIKE_HOLD_MS + STRIKE_DECAY_MS;

// Quiet gap between successive strikes for one marquee.
const GAP_MS_MIN  = 320;
const GAP_MS_RAND = 1200;

// Word-chain path: instead of a smooth polyline that text follows letter
// by letter (which curves the words and hurts readability), each WORD is
// a single straight segment. The sharp angle changes happen only between
// words, at the gaps. Within one word, characters are colinear and
// readable. Overall the bolt is still jagged because each word turns at
// a sharp angle from the previous one.
//
//   MAX_WORDS:   safety cap on chain length
//   MAX_TURN:    upper bound on angle change between words (radians)
//   MIN_TURN:    minimum turn so the bolt doesn't drift smoothly — it MUST
//                kink at every word boundary
//   ALT_PROB:    chance the next turn flips side (zig-then-zag); 1.0 forces
//                strict alternation, 0.5 randomizes, 0 always-same-side
//   PATH_OVERSHOOT_FACTOR: stop adding words when total path length exceeds
//                          (cursor→anchor distance) × this factor
const MAX_WORDS              = 18;
const MAX_TURN               = 1.20;   // ~70°
const MIN_TURN               = 0.45;   // ~26°
const ALT_PROB               = 0.78;   // strong alternation, occasional double-zig
const PATH_OVERSHOOT_FACTOR  = 1.45;

const FONT_SIZE = 14;
const FONT_FAMILY = 'Georgia, "Times New Roman", serif';
const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`;
const WORD_GAP_PX = 14;
const FADE_NEAR = 28;
const FADE_FAR = 110;

interface Char {
  ch: string;
  x: number;
  y: number;
  angle: number;
}
interface Anchor {
  x: number;
  y: number;
}
interface Marquee {
  phrases: readonly string[];
  viewportY: number;
  spans: HTMLSpanElement[];
  bornAt: number;
  nextAt: number;
  chars: Char[] | null;
  lastPhrase: string | null;
}

const measureCtx = document.createElement('canvas').getContext('2d')!;
measureCtx.font = FONT;
const widthCache = new Map<string, number>();
function charWidth(ch: string): number {
  let w = widthCache.get(ch);
  if (w === undefined) {
    w = measureCtx.measureText(ch).width;
    widthCache.set(ch, w);
  }
  return w;
}

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  init();
}

function init() {
  const container = document.createElement('div');
  container.className = 'lightning';
  container.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(container, document.body.firstChild);

  // ----- Per-marquee state ----------------------------------------------
  const marquees: Marquee[] = MARQUEES.map((phrases, i) => ({
    phrases,
    viewportY: ANCHOR_Y_VIEWPORT[i % ANCHOR_Y_VIEWPORT.length]!,
    spans: [],
    // Strike lifecycle
    bornAt: 0,        // 0 when no active strike
    nextAt: 0,        // when to fire the next strike
    chars: null,      // [{ ch, x, y, angle }] frozen for the strike's duration
    lastPhrase: null,
  }));

  function getSpan(m: Marquee, i: number): HTMLSpanElement {
    while (i >= m.spans.length) {
      const span = document.createElement('span');
      container.appendChild(span);
      m.spans.push(span);
    }
    return m.spans[i]!;
  }
  function trimMarquee(m: Marquee, n: number): void {
    for (let i = n; i < m.spans.length; i++) {
      const s = m.spans[i]!;
      if (s.textContent !== '') s.textContent = '';
      if (s.style.opacity !== '0') s.style.opacity = '0';
    }
  }

  // ----- Lightning word-chain layout ------------------------------------
  // Each word becomes one STRAIGHT segment. The word's chars are all at
  // the same angle (readable). Between words, the path kinks at a sharp
  // angle (the lightning's joints). Overall the chain biases toward the
  // anchor by adjusting each segment's base direction back to the
  // remaining vector to anchor — so the bolt actually arrives, instead
  // of drifting off into space.
  function layWordChain(sx: number, sy: number, ex: number, ey: number, phrase: string): Char[] {
    const words = phrase.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return [];
    const out: Char[] = [];
    let posX = sx, posY = sy;
    const directDist = Math.hypot(ex - sx, ey - sy) || 1;
    const maxLen = directDist * PATH_OVERSHOOT_FACTOR;

    let lastTurnSign = Math.random() < 0.5 ? -1 : 1;
    let lastAngle: number | null = null;
    let totalLen = 0;
    let wIdx = 0;

    while (wIdx < MAX_WORDS && totalLen < maxLen) {
      const word = words[wIdx % words.length]!;
      // Pre-measure word width so we know if it'll fit & advance correctly.
      let wordW = 0;
      for (const ch of word) wordW += charWidth(ch);

      // Direction-to-anchor from current position.
      const dx = ex - posX, dy = ey - posY;
      const distToAnchor = Math.hypot(dx, dy);
      if (distToAnchor < 8) break;
      const dirToAnchor = Math.atan2(dy, dx);

      // Choose this segment's angle: aim broadly at anchor, then add a
      // turn that alternates side (zig-then-zag) most of the time. The
      // turn magnitude is uniformly randomized between MIN_TURN and
      // MAX_TURN so corners are always visibly sharp, never smooth.
      let angle: number;
      if (lastAngle === null) {
        // First segment: just bias toward anchor with a small offset.
        angle = dirToAnchor + (Math.random() - 0.5) * MIN_TURN;
      } else {
        if (Math.random() > ALT_PROB) lastTurnSign = -lastTurnSign;
        else lastTurnSign = -lastTurnSign;
        const turnMag = MIN_TURN + Math.random() * (MAX_TURN - MIN_TURN);
        const turn = lastTurnSign * turnMag;
        // Average between (lastAngle + turn) and dirToAnchor, biased
        // toward anchor so the bolt stays on course. Higher anchor weight
        // when we're far behind on path length.
        const candidate = lastAngle + turn;
        const w = Math.min(0.55, totalLen / (directDist || 1) * 0.4 + 0.15);
        // Circular average between candidate and dirToAnchor.
        const cx = (1 - w) * Math.cos(candidate) + w * Math.cos(dirToAnchor);
        const cy = (1 - w) * Math.sin(candidate) + w * Math.sin(dirToAnchor);
        angle = Math.atan2(cy, cx);
      }

      const cosA = Math.cos(angle), sinA = Math.sin(angle);

      // Upside-down protection: when the bolt segment points leftward
      // (cos < 0), naive per-char rotation makes letters render upside
      // down. Flip the rendered angle by 180° (text upright) AND reverse
      // the character order along the segment, so reading left-to-right
      // still gives the natural word order. The bolt itself still goes
      // in its actual direction — only text orientation changes.
      const flipped = cosA < 0;
      const renderAngle = flipped ? angle + Math.PI : angle;
      const ordered = flipped
        ? Array.from(word).reverse()
        : Array.from(word);

      // Lay this word's chars in a straight line along the segment.
      let cumW = 0;
      for (const ch of ordered) {
        const w = charWidth(ch);
        out.push({
          ch,
          x: posX + cosA * (cumW + w / 2),
          y: posY + sinA * (cumW + w / 2),
          angle: renderAngle,
        });
        cumW += w;
      }

      // Advance to end of word, then add the inter-word gap (still in
      // this word's direction — the next word will kink at the gap end).
      posX += cosA * (wordW + WORD_GAP_PX);
      posY += sinA * (wordW + WORD_GAP_PX);
      totalLen += wordW + WORD_GAP_PX;
      lastAngle = angle;
      wIdx++;
    }
    return out;
  }

  function startStrike(m: Marquee, now: number, cursorX: number, cursorY: number, anchor: Anchor): void {
    let phrase: string | null = m.lastPhrase;
    for (let tries = 0; tries < 6 && phrase === m.lastPhrase; tries++) {
      phrase = m.phrases[Math.floor(Math.random() * m.phrases.length)]!;
    }
    m.lastPhrase = phrase;
    m.chars = layWordChain(cursorX, cursorY, anchor.x, anchor.y, phrase!);
    m.bornAt = now;
  }

  function strikeOpacity(elapsed: number): number {
    if (elapsed < STRIKE_PEAK_MS) return elapsed / STRIKE_PEAK_MS;
    if (elapsed < STRIKE_PEAK_MS + STRIKE_HOLD_MS) return 1;
    const dec = elapsed - STRIKE_PEAK_MS - STRIKE_HOLD_MS;
    if (dec >= STRIKE_DECAY_MS) return 0;
    return 1 - dec / STRIKE_DECAY_MS;
  }

  // ----- Cursor + page state --------------------------------------------
  let cursorX = -9999, cursorY = -9999;
  let pageRect: DOMRect | null = null;
  let toolbarRect: DOMRect | null = null;
  let alive = false;
  let rafId: number | null = null;

  function refreshRects(): void {
    const page = document.querySelector('.page');
    const tb = document.querySelector('.toolbar');
    pageRect = page ? page.getBoundingClientRect() : null;
    toolbarRect = tb ? tb.getBoundingClientRect() : null;
  }
  refreshRects();
  window.addEventListener('scroll', refreshRects, { passive: true });
  window.addEventListener('resize', refreshRects);

  // Lightning is a canvas-mat effect: it should only fire when the cursor
  // is directly over the cream margin around the resume page. Anything
  // else — the page itself, the toolbar, or a fullscreen overlay like the
  // lightbox / browser fullscreen — means the cursor is "on" another
  // component and the storm should stay quiet.
  function shouldFire(x: number, y: number): boolean {
    if (document.fullscreenElement) return false;
    const el = document.elementFromPoint(x, y);
    if (!el) return false;
    if (el.closest('.lightbox')) return false;
    if (el.closest('.page')) return false;
    return !!el.closest('.app');
  }
  function distanceToRect(x: number, y: number, rect: DOMRect | null): number {
    if (!rect) return Infinity;
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function uiProximity(): number {
    const minD = Math.min(distanceToRect(cursorX, cursorY, pageRect),
                          distanceToRect(cursorX, cursorY, toolbarRect));
    if (minD <= FADE_NEAR) return 0;
    if (minD >= FADE_FAR) return 1;
    return (minD - FADE_NEAR) / (FADE_FAR - FADE_NEAR);
  }

  function setAlive(v: boolean): void {
    if (v === alive) return;
    alive = v;
    if (v) {
      // Stagger initial strike timing per marquee so they don't all fire
      // at once on first cursor entry into the mat.
      const now = performance.now();
      for (const m of marquees) {
        m.bornAt = 0;
        m.nextAt = now + Math.random() * 400;
      }
      if (rafId === null) rafId = requestAnimationFrame(render);
    }
  }

  window.addEventListener('mousemove', (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
    setAlive(shouldFire(cursorX, cursorY));
  }, { passive: true });

  document.addEventListener('mouseleave', () => setAlive(false));
  // Re-evaluate when the lightbox opens/closes or fullscreen toggles —
  // mousemove won't fire on its own when the overlay appears under a
  // stationary cursor.
  document.addEventListener('fullscreenchange', () => {
    setAlive(shouldFire(cursorX, cursorY));
  });
  const lbObserver = new MutationObserver(() => {
    setAlive(shouldFire(cursorX, cursorY));
  });
  lbObserver.observe(document.body, { childList: true, subtree: false });

  function viewportAnchor(fraction: number): Anchor {
    const vh = window.innerHeight - 1;
    const r = pageRect!;
    const visTop = Math.max(0, r.top);
    const visBottom = Math.min(vh, r.bottom);
    return {
      x: Math.max(r.left, Math.min(r.right, cursorX)),
      y: Math.max(visTop, Math.min(visBottom, fraction * vh)),
    };
  }

  // ----- Render loop ----------------------------------------------------
  function render(now: number): void {
    if (!alive) {
      for (const m of marquees) trimMarquee(m, 0);
      rafId = null;
      return;
    }
    if (!pageRect) refreshRects();
    if (!pageRect) {
      rafId = requestAnimationFrame(render);
      return;
    }
    const proximity = uiProximity();
    if (proximity <= 0.001) {
      for (const m of marquees) trimMarquee(m, 0);
      rafId = requestAnimationFrame(render);
      return;
    }

    for (const m of marquees) {
      const anchor = viewportAnchor(m.viewportY);
      const dist = Math.hypot(anchor.x - cursorX, anchor.y - cursorY);
      if (dist < 8) { trimMarquee(m, 0); continue; }

      // ---- Strike lifecycle ----
      if (m.bornAt === 0) {
        // No active strike — wait for the gap to elapse, then fire.
        if (now >= m.nextAt) {
          startStrike(m, now, cursorX, cursorY, anchor);
        }
      } else if (now - m.bornAt > STRIKE_TOTAL_MS) {
        // Strike done.
        m.bornAt = 0;
        m.nextAt = now + GAP_MS_MIN + Math.random() * GAP_MS_RAND;
      }

      if (m.bornAt === 0 || !m.chars) { trimMarquee(m, 0); continue; }

      const op = strikeOpacity(now - m.bornAt) * proximity;
      if (op <= 0.001) { trimMarquee(m, 0); continue; }

      // ---- Render frozen path ----
      let i = 0;
      for (const c of m.chars) {
        const angleDeg = c.angle * 180 / Math.PI;
        const span = getSpan(m, i);
        if (span.textContent !== c.ch) span.textContent = c.ch;
        span.style.cssText =
          'position:absolute;left:0;top:0;' +
          `transform:translate3d(${c.x.toFixed(1)}px,${c.y.toFixed(1)}px,0) ` +
            `translate(-50%,-50%) rotate(${angleDeg.toFixed(1)}deg);` +
          `opacity:${op.toFixed(3)};`;
        i++;
      }
      trimMarquee(m, i);
    }

    rafId = requestAnimationFrame(render);
  }
}
