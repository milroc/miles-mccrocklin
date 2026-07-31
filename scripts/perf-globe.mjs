// Globe paint/FPS benchmark. Loads a page, watches the first N seconds,
// and reports paint timings, long tasks, and rAF frame-time stats split
// into three windows: startup (nav -> globe reveal), photo drip (reveal
// -> +5s), and steady state (+5s -> end).
//
// Usage:
//   bun scripts/perf-globe.mjs <url> [runs]
//
//   bun scripts/perf-globe.mjs http://localhost:8123        # dist mirror
//   bun scripts/perf-globe.mjs https://miles.mccrockl.in 3  # live, 3 runs
//
// Uses playwright-core with the installed Google Chrome (no bundled
// browser download). Each run gets a fresh browser context (cold cache).
// Headed by default so the GPU path matches real usage; set HEADLESS=1
// for headless (relative comparisons stay valid, absolute numbers may
// differ from a real session).

import { chromium } from 'playwright-core';

const url = process.argv[2];
const runs = Number(process.argv[3] ?? 3);
const WATCH_MS = 12_000;

if (!url) {
  console.error('usage: bun scripts/perf-globe.mjs <url> [runs]');
  process.exit(1);
}

// Injected before any page script runs. Collects:
//  - paint entries (first-paint / first-contentful-paint)
//  - long tasks (>50ms main-thread blocks)
//  - rAF timestamps (frame deltas)
//  - globe reveal time: the WebGL mount is a div with an inline
//    `transition: opacity ...` style that flips opacity 0 -> 1 once the
//    scene has real content (works on both the old and new code).
const COLLECTOR = `
  window.__globePerf = { longTasks: [], frames: [], paints: {}, revealAt: null };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__globePerf.longTasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__globePerf.paints[e.name] = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  let last = null;
  const tick = (ts) => {
    if (last !== null) window.__globePerf.frames.push([ts, ts - last]);
    last = ts;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const findMount = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    for (let el = canvas.parentElement; el; el = el.parentElement) {
      const style = el.getAttribute('style') ?? '';
      if (style.includes('transition') && style.includes('opacity')) return el;
    }
    return null;
  };
  const poll = setInterval(() => {
    const el = findMount();
    if (el && el.style.opacity === '1' && window.__globePerf.revealAt === null) {
      window.__globePerf.revealAt = performance.now();
      clearInterval(poll);
    }
  }, 50);
`;

function frameStats(frames, from, to) {
  const deltas = frames.filter(([t]) => t >= from && t < to).map(([, d]) => d);
  if (deltas.length === 0) return { fps: 0, worst: 0, over33: 0, over50: 0, n: 0 };
  const total = deltas.reduce((a, b) => a + b, 0);
  return {
    fps: Math.round((1000 * deltas.length) / total),
    worst: Math.round(Math.max(...deltas)),
    over33: deltas.filter((d) => d > 33).length,
    over50: deltas.filter((d) => d > 50).length,
    n: deltas.length,
  };
}

function summarize(perf) {
  const reveal = perf.revealAt ?? WATCH_MS;
  const end = perf.frames.length ? perf.frames[perf.frames.length - 1][0] : WATCH_MS;
  const longAfterReveal = perf.longTasks.filter((t) => t.start >= reveal);
  return {
    fcp: Math.round(perf.paints['first-contentful-paint'] ?? -1),
    reveal: perf.revealAt === null ? -1 : Math.round(reveal),
    longCount: perf.longTasks.length,
    longTotal: Math.round(perf.longTasks.reduce((a, t) => a + t.dur, 0)),
    longMax: Math.round(Math.max(0, ...perf.longTasks.map((t) => t.dur))),
    longAfterReveal: longAfterReveal.length,
    longAfterRevealMax: Math.round(Math.max(0, ...longAfterReveal.map((t) => t.dur))),
    startup: frameStats(perf.frames, 0, reveal),
    drip: frameStats(perf.frames, reveal, reveal + 5000),
    steady: frameStats(perf.frames, reveal + 5000, end),
  };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// CPU_THROTTLE=4 emulates a ~4x slower machine (DevTools-style CPU
// throttling) — useful to see stutter this hardware is too fast to show.
// VIEWPORT=1920x1080 and DSF=2 (deviceScaleFactor) emulate bigger
// displays — canvas raster cost scales with viewport × DSF².
const throttle = Number(process.env.CPU_THROTTLE ?? 1);
const [vw, vh] = (process.env.VIEWPORT ?? '1440x900').split('x').map(Number);
const dsf = Number(process.env.DSF ?? 1);

async function run(browser) {
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf });
  const page = await context.newPage();
  if (throttle > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.addInitScript(COLLECTOR);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(WATCH_MS);
  const perf = await page.evaluate(() => window.__globePerf);
  await context.close();
  return summarize(perf);
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !!process.env.HEADLESS,
});

const results = [];
for (let i = 0; i < runs; i++) {
  const r = await run(browser);
  results.push(r);
  console.log(
    `run ${i + 1}: fcp=${r.fcp}ms reveal=${r.reveal}ms ` +
      `longTasks=${r.longCount} (${r.longTotal}ms total, max ${r.longMax}ms, ${r.longAfterReveal} after reveal) ` +
      `| startup ${r.startup.fps}fps worst ${r.startup.worst}ms ` +
      `| drip ${r.drip.fps}fps worst ${r.drip.worst}ms >33ms:${r.drip.over33} ` +
      `| steady ${r.steady.fps}fps worst ${r.steady.worst}ms`,
  );
}
await browser.close();

console.log(`\n== median of ${runs} run(s) — ${url} ==`);
console.table({
  'FCP (ms)': median(results.map((r) => r.fcp)),
  'globe reveal (ms)': median(results.map((r) => r.reveal)),
  'long tasks (count)': median(results.map((r) => r.longCount)),
  'long tasks total (ms)': median(results.map((r) => r.longTotal)),
  'longest task (ms)': median(results.map((r) => r.longMax)),
  'long tasks after reveal': median(results.map((r) => r.longAfterReveal)),
  'startup FPS': median(results.map((r) => r.startup.fps)),
  'startup worst frame (ms)': median(results.map((r) => r.startup.worst)),
  'photo-drip FPS': median(results.map((r) => r.drip.fps)),
  'photo-drip worst frame (ms)': median(results.map((r) => r.drip.worst)),
  'photo-drip frames >33ms': median(results.map((r) => r.drip.over33)),
  'steady FPS': median(results.map((r) => r.steady.fps)),
  'steady worst frame (ms)': median(results.map((r) => r.steady.worst)),
});
