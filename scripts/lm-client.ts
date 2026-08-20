// Shared LM Studio client. Used by:
//   - classify-photography.ts (raw structured-label generation per photo)
//   - photography-crit.ts     (per-photo critique scores + notes)
//   - merge-labels.ts          (notes → refined-labels prompt at merge time)
//
// Both invoke an OpenAI-compatible chat-completions endpoint with a
// single vision-input message and parse the JSON the model returns out
// of the response text. The domain-specific bits (which prompt, which
// fields to validate, country-slug constraints) stay in the caller.
//
// PRIVACY INVARIANT: vision calls are local-only. chatVision asserts
// the endpoint is a loopback address before sending any image bytes,
// so raw photo content never reaches a third-party lab where it could
// be retained or used for training. Text-only calls (chatText) may use
// the Claude CLI; vision calls may not.

import { spawn, spawnSync } from 'node:child_process';
import { isJsonObject, isNumber, isString } from '../src/utils/json';
import type { JsonObject, JsonValue } from '../src/utils/json';
import sharp from 'sharp';

// Maximum long-edge size (px) sent to the model. 1280 is the largest
// thumbnail that changes Qwen2.5-VL's behavior — anything larger gets
// downsampled internally by the model's image processor (max_pixels
// default ≈ 1,003,520, which corresponds to ~1000×1000). Some squares
// at 1280×1280 will be gently downsampled by the processor; non-square
// shapes (the majority of photos) stay under the cap and benefit from
// the extra resolution for technical-quality judgments (sharpness,
// noise, oversharpening halos). Both dimensions are bounded — see
// imageToDataUrl below — so portrait photos don't blow past the cap.
export const VISION_THUMB_MAX = 1280;
// JPEG quality. 90 preserves fine detail (grain, sharpness halos,
// catchlight texture) the model can actually use at this resolution.
// At smaller thumbnails 80 was fine; at 1280 long-edge quality 80 leaves
// visible blocking the model could read as a flaw it would penalize.
export const VISION_THUMB_QUALITY = 90;

// Per-photo network timeout. Local models can stall on first load;
// 5 minutes is generous for a cold-cache 32B model on Apple Silicon.
export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export const DEFAULT_ENDPOINT = 'http://localhost:1234/v1';

// Context length requested every time we (re)load a model via `lms`.
// Picked to be safely above what we actually use — vision prompts at
// 1280 px are ~1500 prompt tokens + ~600 completion + image tokens, so
// the practical floor is ~6K. Default 32768 covers Qwen2.5-VL (32K
// native) and gives Qwen2.5 / Llama-3 text models comfortable headroom
// for chain-of-thought + long curator notes. LM Studio clamps to the
// model's actual ceiling if asked for more, so over-requesting is
// safe; the only cost is KV cache memory (~5GB at 16K, ~10GB at 32K
// for a 72B model). Override via LMS_CONTEXT_LENGTH if you need to
// tune for tight VRAM.
export const MAX_CONTEXT_LENGTH = Number(process.env.LMS_CONTEXT_LENGTH ?? 32768);

// Guard for any code path that sends raw image bytes. Throws unless the
// endpoint host is loopback (localhost / 127.0.0.1 / [::1]). Called from
// chatVision so every vision caller — current and future — inherits the
// "photos stay on this machine" invariant. Deleting this assertion to
// route vision traffic somewhere else must be a conscious, reviewable
// change.
export function assertLocalEndpoint(endpoint: string, callsite: string): void {
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    throw new Error(
      `${callsite}: refusing to send images to malformed endpoint "${endpoint}". ` +
      `Vision calls must target a local LM Studio server (http://localhost:1234/v1).`,
    );
  }
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]';
  if (!isLocal) {
    throw new Error(
      `${callsite}: refusing to send images to non-local endpoint "${endpoint}" ` +
      `(host=${host}). Vision calls are local-only by policy — photo bytes ` +
      `must not leave this machine. Use http://localhost:1234/v1 (LM Studio).`,
    );
  }
}

// Returns the data URL together with the post-resize dimensions, so
// callers that care about diagnostics (correlating per-photo timing
// with input size) don't need a second sharp pass to read them back.
// Width/height are the actual pixel dims of the JPEG that gets sent
// to the model — after `fit: 'inside'` capping and any EXIF rotation.
export interface ImageEncoded {
  dataUrl: string;
  width: number;
  height: number;
}

export async function imageToDataUrl(
  absPath: string,
  maxLongEdge: number = VISION_THUMB_MAX,
  quality: number = VISION_THUMB_QUALITY,
): Promise<ImageEncoded> {
  // fit: 'inside' bounds BOTH dimensions, so the long edge is always
  // ≤ maxLongEdge regardless of orientation. The previous code bounded
  // width only, which silently inflated portrait photos (a 4000×6000
  // source became 768×1152 — long edge 1152, not 768 — and pushed tall
  // portraits past Qwen2.5-VL's image-processor cap, triggering a
  // second internal downsample on every such photo).
  const { data, info } = await sharp(absPath)
    .rotate()
    .resize({
      width: maxLongEdge,
      height: maxLongEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`,
    width: info.width,
    height: info.height,
  };
}

// Regex matching model ids that hint at vision capability. Used by
// auto-detect and the auto-load helper.
export const VISION_HINTS_RE = /vl|vision|llava|minicpm-?v|qwen.*v|cogvlm|moondream/i;

// Preference order for text-only models. Earlier entries are picked
// first when multiple text models are available. Qwen and DeepSeek
// follow OpenAI JSON-mode reliably; Gemma is deprioritized because
// it often returns empty content or unparseable wrappers when asked
// for structured output.
//
// Patterns are anchored to start-of-id or after-slash so that a
// distilled model like `deepseek/deepseek-r1-0528-qwen3-8b` doesn't
// false-match `qwen3` and outrank the actual `qwen/qwen3.5-9b`.
const TEXT_MODEL_PREFERENCE: RegExp[] = [
  /(?:^|\/)qwen3/i,
  /(?:^|\/)qwen2(?!.*-vl)/i,     // Qwen2 text models, NOT the vision variants.
  /(?:^|\/)deepseek/i,
  /(?:^|\/)llama/i,
  /(?:^|\/)mistral/i,
  /(?:^|\/)phi/i,
];
const TEXT_MODEL_AVOID = /(?:^|\/)gemma/i;

function pickByPreference(ids: string[], pred: (id: string) => boolean): string | null {
  // First try preference order.
  for (const pref of TEXT_MODEL_PREFERENCE) {
    const hit = ids.find((id) => pred(id) && pref.test(id));
    if (hit) return hit;
  }
  // Then anything matching the predicate that we don't avoid.
  const fallback = ids.find((id) => pred(id) && !TEXT_MODEL_AVOID.test(id));
  if (fallback) return fallback;
  // Last resort: any match including avoided models.
  return ids.find((id) => pred(id)) ?? null;
}

// Probe LM Studio's /v1/models endpoint with a short timeout. Returns
// true if it responds with 2xx. Used as the readiness check before
// trying to start the server.
async function probeLmStudio(endpoint: string, timeoutMs: number): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint}/models`, { signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// Make sure LM Studio's local server is up. If it isn't, shell out to
// the `lms` CLI to start it. Throws a clear error if `lms` isn't on
// PATH so the user knows what to install.
//
// `lms server start` typically blocks until the server is ready, but
// we poll afterwards anyway in case the CLI returns early.
export async function ensureLmStudioRunning(
  endpoint: string = DEFAULT_ENDPOINT,
  timeoutMs = 30_000,
): Promise<void> {
  if (await probeLmStudio(endpoint, 2000)) return;

  const which = spawnSync('which', ['lms']);
  if (which.status !== 0) {
    throw new Error(
      `LM Studio is not running at ${endpoint} and the \`lms\` CLI is not on PATH.\n` +
      `  Install LM Studio (https://lmstudio.ai), open it once, and run \`lms bootstrap\`,\n` +
      `  or start LM Studio manually before re-running this script.`,
    );
  }

  console.log(`lm-client: LM Studio not responding — starting via \`lms server start\`…`);
  const start = spawnSync('lms', ['server', 'start'], { stdio: 'inherit' });
  if (start.status !== 0) {
    throw new Error('`lms server start` exited non-zero');
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeLmStudio(endpoint, 1500)) {
      console.log('lm-client: LM Studio server is responding');
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`LM Studio server did not respond within ${timeoutMs}ms`);
}

// Look for an installed model matching a predicate. Used by both the
// vision (classify-photography) and text-only (merge-labels) flows.
// When applyTextPreference is true, scans through the text-preference
// order first so we pick a known-good model rather than the first
// matching line in `lms ls`.
function findInstalledModel(
  predicate: (id: string) => boolean,
  applyTextPreference = false,
): string | null {
  const ls = spawnSync('lms', ['ls'], { encoding: 'utf8' });
  if (ls.status !== 0) return null;
  const lines = (ls.stdout ?? '').split('\n');
  const candidates: string[] = [];
  for (const line of lines) {
    if (!/\bLocal\b/.test(line)) continue;
    const m = line.match(/^([^\s]+)/);
    if (!m) continue;
    if (m[1].toUpperCase().includes('PARAMS')) continue;
    if (predicate(m[1]) || predicate(line)) candidates.push(m[1]);
  }
  if (candidates.length === 0) return null;
  if (!applyTextPreference) return candidates[0];
  return pickByPreference(candidates, () => true) ?? candidates[0];
}

async function fetchLoadedModelIds(endpoint: string): Promise<string[]> {
  const res = await fetch(`${endpoint}/models`);
  if (!res.ok) return [];
  // SAFETY: the OpenAI-compatible /models response shape. Every read of
  // it below is optional-chained, so a provider that answers differently
  // yields an empty model list rather than a crash.
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).map((m) => m.id);
}

// Match a "preferred" model id against the loaded set. Accepts either
// an exact match or a fully-qualified id whose tail matches the
// preferred bare id. Lets callers pass either "qwen2.5-vl-72b-instruct"
// or "lmstudio-community/qwen2.5-vl-72b-instruct" and have either
// resolve when the other is what LM Studio reports.
function loadedMatchesPreferred(ids: string[], preferred: string): string | null {
  const exact = ids.find((id) => id === preferred);
  if (exact) return exact;
  const tail = ids.find((id) => id.endsWith('/' + preferred));
  return tail ?? null;
}

// Unload every loaded model, then load `modelId` with the maximum
// reasonable context length. This is the ONE place we shell out to
// `lms load`, so every model-load path (vision, text, upgrade) gets the
// same context-length treatment.
//
// Why unload-all first: LM Studio's OpenAI-compatible /v1/models
// endpoint reports whichever model happens to be loaded, and the
// previous behavior silently used that — so a script asking for the
// 72B model could end up running against a leftover 32B from a prior
// session. Unloading guarantees the caller's preferred model is the
// one that ends up serving requests.
//
// Why --context-length on every load: LM Studio's load-time defaults
// can be conservatively small (we've seen 4K and 8K), which trips the
// "Context size has been exceeded" error on vision prompts that include
// ~1500 image tokens + a long structured prompt. Setting it explicitly
// on every load makes the behavior predictable.
async function forceLoadModel(
  modelId: string,
  contextLength: number,
  parallel?: number,
): Promise<boolean> {
  console.log(`lm-client: unloading all models...`);
  const unload = spawnSync('lms', ['unload', '--all'], { stdio: 'inherit' });
  if (unload.status !== 0) {
    // Non-fatal: maybe nothing was loaded, or maybe the CLI version
    // doesn't support --all. The subsequent load will succeed either
    // way; we just won't have freed unrelated state.
    console.warn('lm-client: `lms unload --all` exited non-zero (continuing)');
  }
  // Build the load args:
  //   -y                    auto-approve (skip the "multiple matches" prompt)
  //   --context-length N    pin the context window so we don't inherit
  //                         LM Studio's small default (often 4K)
  //   --parallel N          configure the model's server-side concurrent
  //                         prediction slots. Without this, client-side
  //                         concurrency just queues at the LM Studio
  //                         server (single slot is the default), which is
  //                         the root cause of "GPU at 60% with same RAM
  //                         at concurrency=4" — the GPU has headroom but
  //                         the server isn't batching.
  const args = [
    'load', modelId, '-y',
    '--context-length', String(contextLength),
  ];
  if (parallel != null && parallel > 0) {
    args.push('--parallel', String(parallel));
  }
  const desc = `--context-length ${contextLength}` +
    (parallel != null && parallel > 0 ? ` --parallel ${parallel}` : '');
  console.log(`lm-client: loading "${modelId}" (${desc})...`);
  const load = spawnSync('lms', args, { stdio: 'inherit' });
  if (load.status === 0) return true;
  // Older `lms` builds may not recognize --context-length or --parallel.
  // Retry with the bare model id so we degrade to load-time defaults
  // rather than hard-failing.
  console.warn(
    `lm-client: \`lms ${args.join(' ')}\` failed; retrying with bare \`lms load ${modelId} -y\` ` +
    `(lms CLI may be old).`,
  );
  const fallback = spawnSync('lms', ['load', modelId, '-y'], { stdio: 'inherit' });
  if (fallback.status !== 0) {
    console.warn(`lm-client: \`lms load ${modelId}\` failed with status ${fallback.status}`);
    return false;
  }
  return true;
}

// Ensure a model satisfying `predicate` is loaded in LM Studio.
//
// Two paths:
//
//   1. preferredModel SET (caller asked for a specific model):
//      authoritative — if the preferred model is exactly loaded, use
//      it; otherwise unload everything and load it. The previous
//      behavior silently used whichever model happened to be in
//      memory, which let stale state from prior sessions sneak in.
//      Now the caller's intent wins.
//
//   2. preferredModel NULL (auto-detect):
//      respect whatever is already loaded if it matches the predicate;
//      only touch state if nothing matches or only an avoid-listed
//      model is loaded.
//
// Every model load goes through forceLoadModel (unload --all + load
// --context-length MAX) so context length is consistent and predictable.
async function ensureModelLoadedMatching(
  endpoint: string,
  predicate: (id: string) => boolean,
  preferredModel: string | null,
  kindLabel: 'vision' | 'text',
  parallel?: number,
): Promise<string | null> {
  let ids = await fetchLoadedModelIds(endpoint);

  // ── Path 1: preferred model specified — it wins, and we ALWAYS
  // reload it.
  //
  // The "model is already loaded" shortcut is unsafe because LM Studio
  // remembers a model's previously-loaded *context length* across
  // server restarts. A manual `lms load qwen2.5-vl-72b-instruct` (no
  // --context-length) leaves the model in memory with whatever default
  // LM Studio picked (we've seen 4K) — and the OpenAI-compat
  // /v1/models endpoint doesn't surface that, so we can't tell from
  // outside whether the loaded state matches our intent. Forcing a
  // reload guarantees the context length is exactly what we asked for.
  //
  // The cost is ~30-90s per script invocation for a 72B model. The
  // mitigation is to leave the UI server running between iterations
  // (it holds the loaded state) rather than restarting the script
  // every time you want to look at results.
  if (preferredModel) {
    const alreadyLoaded = loadedMatchesPreferred(ids, preferredModel);
    if (alreadyLoaded) {
      console.log(
        `lm-client: preferred ${kindLabel} model "${preferredModel}" appears loaded, ` +
        `but reloading to guarantee context length = ${MAX_CONTEXT_LENGTH.toLocaleString()}.`,
      );
    } else {
      console.log(
        `lm-client: preferred ${kindLabel} model "${preferredModel}" is not loaded; ` +
        `switching models.`,
      );
    }
    const ok = await forceLoadModel(preferredModel, MAX_CONTEXT_LENGTH, parallel);
    if (!ok) return null;
    ids = await fetchLoadedModelIds(endpoint);
    return loadedMatchesPreferred(ids, preferredModel)
      ?? (kindLabel === 'text'
        ? pickByPreference(ids, predicate)
        : (ids.find((id) => predicate(id)) ?? null));
  }

  // ── Path 2: auto-detect — respect existing state when reasonable.
  //
  // For text models, walk the preference order so we don't pick a
  // brittle one (Gemma) when a known-good one (Qwen / DeepSeek) is
  // already in memory. Vision uses straight predicate match — there's
  // usually only one vision model loaded.
  const pickExisting = kindLabel === 'text'
    ? pickByPreference(ids, predicate)
    : (ids.find((id) => predicate(id)) ?? null);
  // Escape hatch: if the ONLY thing loaded is on the avoid list, try
  // to load something better from disk before falling back to it.
  if (
    pickExisting && kindLabel === 'text' && TEXT_MODEL_AVOID.test(pickExisting)
  ) {
    const upgrade = findInstalledModel(predicate, true);
    if (upgrade && !TEXT_MODEL_AVOID.test(upgrade) && upgrade !== pickExisting) {
      console.log(
        `lm-client: upgrading text model from "${pickExisting}" to "${upgrade}" ` +
        `(loaded model returns brittle structured output)…`,
      );
      const ok = await forceLoadModel(upgrade, MAX_CONTEXT_LENGTH, parallel);
      if (ok) {
        ids = await fetchLoadedModelIds(endpoint);
        const next = pickByPreference(ids, predicate);
        if (next) return next;
      }
    }
  }
  if (pickExisting) return pickExisting;

  // Nothing matching loaded — scan installed and load the first match.
  const target = findInstalledModel(predicate, kindLabel === 'text');
  if (!target) {
    console.warn(
      `lm-client: no ${kindLabel} model loaded and none found locally. ` +
      `Pass --model <id> or run \`lms load <model>\` manually.`,
    );
    return null;
  }
  const ok = await forceLoadModel(target, MAX_CONTEXT_LENGTH, parallel);
  if (!ok) return null;
  ids = await fetchLoadedModelIds(endpoint);
  return kindLabel === 'text'
    ? pickByPreference(ids, predicate)
    : (ids.find((id) => predicate(id)) ?? null);
}

// Ensure a VISION model is loaded. Used by classify-photography.
export async function ensureVisionModelLoaded(
  endpoint: string = DEFAULT_ENDPOINT,
  preferredModel: string | null = null,
  parallel?: number,
): Promise<string | null> {
  return ensureModelLoadedMatching(
    endpoint,
    (id) => VISION_HINTS_RE.test(id),
    preferredModel,
    'vision',
    parallel,
  );
}

// Ensure a TEXT-ONLY model is loaded. Used by merge-labels, where
// curator-notes refinement and dupe-merge are text-in/text-out — a
// vision model is overkill and slower. "Text-only" here just means
// "not a vision model" (anything that isn't vision-tagged).
export async function ensureTextModelLoaded(
  endpoint: string = DEFAULT_ENDPOINT,
  preferredModel: string | null = null,
  parallel?: number,
): Promise<string | null> {
  return ensureModelLoadedMatching(
    endpoint,
    (id) => !VISION_HINTS_RE.test(id),
    preferredModel,
    'text',
    parallel,
  );
}

// Pick a model id from the loaded set. LM Studio returns OpenAI-shape
// metadata. If multiple models are loaded, prefer one whose id name
// hints at vision (vl/vision/llava/minicpm-v); otherwise pick the first.
export async function autoDetectModel(endpoint: string): Promise<string> {
  const res = await fetch(`${endpoint}/models`);
  if (!res.ok) {
    throw new Error(
      `Could not list models at ${endpoint}/models (HTTP ${res.status}). ` +
      `Is LM Studio's server running?`,
    );
  }
  // SAFETY: as above — the /models response shape, read defensively.
  const body = await res.json() as { data?: Array<{ id: string }> };
  const ids = (body.data ?? []).map((m) => m.id);
  if (ids.length === 0) {
    throw new Error(`No model is loaded in LM Studio. Load one in the Developer tab and retry.`);
  }
  const visionHints = /vl|vision|llava|minicpm-?v|qwen.*v|cogvlm|moondream/i;
  const visionId = ids.find((id) => visionHints.test(id));
  return visionId ?? ids[0];
}

export interface ChatVisionOptions {
  endpoint: string;
  model: string;
  prompt: string;
  // One or more images for the model to consider. Single-image callers
  // pass `imageUrl`; multi-image callers (e.g. the dupe-merge pass)
  // pass `imageUrls` to send a cluster of photos in one call.
  imageUrl?: string;
  imageUrls?: string[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  // Streaming callback. When set, the request runs in SSE mode and
  // every content delta is forwarded as it arrives. Used by
  // photography-crit to relay generation progress to the live UI and
  // to keep the socket busy so Bun's HTTP idle timeout doesn't fire
  // during long 72B completions. The accumulated content is still
  // returned synchronously in ChatVisionResult.content.
  onDelta?: (chunk: string) => void;
}

// Token-usage shape LM Studio (and any OpenAI-compatible server) returns
// alongside the completion. May be absent on servers that don't surface
// it; callers should treat as optional.
export interface ChatVisionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// Detailed result of a vision call. Carries the assistant content plus
// per-request diagnostics callers can log to correlate latency with
// input size, output size, etc. `requestMs` is wall-clock from fetch
// kickoff through JSON-body parse — i.e. the same window the
// AbortController is guarding. This is the right number to compare
// against the configured timeout when debugging.
export interface ChatVisionResult {
  content: string;
  usage?: ChatVisionUsage;
  requestMs: number;
}

// Detailed variant of chatVision. Returns the full result shape with
// timing + token usage. Use this when you want diagnostics; the
// classic `chatVision` (below) delegates here and discards the extras
// for callers that only want the content string.
export async function chatVisionDetailed(opts: ChatVisionOptions): Promise<ChatVisionResult> {
  const {
    endpoint, model, prompt, imageUrl, imageUrls,
    temperature = 0.2, maxTokens,
    timeoutMs = REQUEST_TIMEOUT_MS,
    onDelta,
  } = opts;
  // PRIVACY: photo bytes never leave this machine. Enforced here so
  // every vision caller (classify, crit, dupe-merge, future) inherits
  // the guarantee without having to remember it.
  assertLocalEndpoint(endpoint, 'chatVision');
  const urls = imageUrls && imageUrls.length > 0
    ? imageUrls
    : (imageUrl ? [imageUrl] : []);
  if (urls.length === 0) {
    throw new Error('chatVision requires at least one image (imageUrl or imageUrls)');
  }
  const content: Array<JsonObject> = [{ type: 'text', text: prompt }];
  for (const url of urls) {
    content.push({ type: 'image_url', image_url: { url } });
  }
  const body: JsonObject = {
    model,
    temperature,
    messages: [{ role: 'user', content }],
    // Always stream. SSE deltas keep the socket flushing every
    // ~100ms during long completions, which prevents Bun's HTTP
    // idle-read timeout (~5min) from firing on 72B vision passes
    // and lets onDelta callers relay progress to a UI. Token usage
    // arrives in the final chunk via stream_options.include_usage.
    stream: true,
    stream_options: { include_usage: true },
  };
  if (isNumber(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const startedAt = performance.now();
  let res: Response;
  try {
    res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
  if (!res.ok) {
    clearTimeout(t);
    const detail = await res.text().catch(() => '');
    throw new Error(`Vision request failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  if (!res.body) {
    clearTimeout(t);
    throw new Error('Vision request returned no body (stream mode requires a readable body)');
  }
  // Consume the SSE stream. Each event is one or more lines starting
  // with "data: <json>"; events are separated by a blank line. We
  // buffer across chunks so an event split mid-line still parses.
  // Final "data: [DONE]" terminates the stream. Usage (when the
  // server obeys include_usage) lands on the very last chunk before
  // [DONE], with delta.content empty.
  let content_acc = '';
  let usage: ChatVisionUsage | undefined;
  let buf = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Process complete lines from the buffer; leave a trailing
      // partial line for the next chunk to complete.
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        if (!payload) continue;
        try {
          // SAFETY: one SSE data frame from a chat-completions stream. Every
          // field below is optional-chained; a frame that doesn't match
          // contributes nothing to the accumulated text.
          const evt = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: ChatVisionUsage;
          };
          const chunk = evt.choices?.[0]?.delta?.content;
          if (isString(chunk) && chunk.length > 0) {
            content_acc += chunk;
            if (onDelta) {
              // Don't let a misbehaving callback kill the stream.
              try { onDelta(chunk); } catch { /* swallow */ }
            }
          }
          if (evt.usage) usage = evt.usage;
        } catch {
          // Drop malformed lines silently — LM Studio occasionally
          // emits keepalive comments or empty events.
        }
      }
    }
  } finally {
    clearTimeout(t);
    try { reader.releaseLock(); } catch { /* */ }
  }
  const requestMs = Math.round(performance.now() - startedAt);
  return {
    content: content_acc,
    ...(usage && { usage }),
    requestMs,
  };
}

// Single chat-completions call with one user message containing the
// prompt text + 1..N images. Returns the raw assistant content string —
// callers parse JSON / extract fields themselves. For diagnostics
// (timing, token usage), use chatVisionDetailed directly.
export async function chatVision(opts: ChatVisionOptions): Promise<string> {
  const result = await chatVisionDetailed(opts);
  return result.content;
}

// Default Claude model used by the Claude-CLI backend. Sonnet is the
// right cost/quality balance for text refinement — generous quota on
// the Max subscription, and reliable JSON output. Callers can override
// via --model.
export const DEFAULT_CLAUDE_MODEL = 'sonnet';

export type ChatBackend = 'claude' | 'lmstudio';

export interface ChatTextOptions {
  endpoint: string;
  model: string;
  prompt: string;
  // Which backend to send the request to. "claude" shells out to the
  // user's logged-in `claude --print` CLI (bills against the Max
  // subscription, no API key needed). "lmstudio" hits the local
  // OpenAI-compatible server.
  backend?: ChatBackend;
  temperature?: number;
  // Omit (or pass 0/undefined) to leave max_tokens off the request,
  // which on the OpenAI-compatible LM Studio API means "no cap" —
  // the model runs until its natural stop or the context limit.
  // Pass an explicit positive number to clamp a single call.
  maxTokens?: number;
  timeoutMs?: number;
  // When true, sets response_format: { type: 'json_object' }. Defaults
  // to FALSE because many LM Studio runtimes silently return empty
  // content when the loaded model's chat template doesn't fully
  // implement OpenAI JSON-mode (observed on qwen3.5, gemma-4, others).
  // The prompts already demand "JSON only" explicitly, and the
  // extractor handles fences/thinking tags — so relying on the prompt
  // is far more robust across local models. Opt in only when you've
  // verified the model handles it.
  jsonMode?: boolean;
}

// True when the `claude` CLI is on PATH. Cached so we don't shell out
// to `which` every call.
let _claudeAvailable: boolean | null = null;
export function isClaudeCliAvailable(): boolean {
  if (_claudeAvailable !== null) return _claudeAvailable;
  const w = spawnSync('which', ['claude']);
  _claudeAvailable = w.status === 0;
  return _claudeAvailable;
}

// Pipe the prompt to `claude --print` via stdin and capture the
// assistant's text response from stdout. Uses the user's existing
// Claude Code auth → bills against their Max subscription.
async function chatTextClaude(opts: ChatTextOptions): Promise<string> {
  const model = opts.model || DEFAULT_CLAUDE_MODEL;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return new Promise<string>((resolve, reject) => {
    const args = ['--print', '--model', model, '--output-format', 'text'];
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`claude CLI failed to spawn: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 400)}`));
      } else {
        resolve(stdout);
      }
    });
    child.stdin.write(opts.prompt);
    child.stdin.end();
  });
}

// Text-only chat-completions call (no images). Used by merge-labels
// where curator-notes refinement and dupe-merge merge structured-label
// text without needing the photo as context — a vision model would
// just be slower for no gain.
//
// Dispatches between the Claude CLI (backend="claude") and the local
// LM Studio server (backend="lmstudio"). When backend is omitted,
// defaults to Claude if the CLI is on PATH, else LM Studio.
export async function chatText(opts: ChatTextOptions): Promise<string> {
  const backend: ChatBackend = opts.backend
    ?? (isClaudeCliAvailable() ? 'claude' : 'lmstudio');
  if (backend === 'claude') return chatTextClaude(opts);
  return chatTextLmStudio(opts);
}

// LM Studio's OpenAI-compatible text endpoint. Kept as a fallback for
// when Claude CLI isn't available (or the operator pins --backend
// lmstudio for offline / privacy reasons).
async function chatTextLmStudio(opts: ChatTextOptions): Promise<string> {
  const {
    endpoint, model, prompt,
    temperature = 0.2, maxTokens,
    timeoutMs = REQUEST_TIMEOUT_MS,
    jsonMode = false,
  } = opts;

  // Qwen3 ships with "thinking mode" on by default — the model emits a
  // long <think>…</think> preamble that can ramble without ever
  // reaching the actual answer. Suppressing thinking takes a
  // belt-and-suspenders approach because each runtime accepts a
  // different switch:
  //   1. A system message containing "/no_think" (Qwen's documented hint).
  //   2. `chat_template_kwargs: { enable_thinking: false }` on the
  //      request (vLLM / Transformers chat-template convention; LM Studio
  //      passes it through to the template).
  // On non-Qwen3 models these are harmless: the system message reads as
  // a normal instruction, and unknown chat_template_kwargs get ignored.
  const isQwen3 = /(?:^|\/)qwen3/i.test(model);
  const messages: Array<{ role: string; content: string }> = [];
  if (isQwen3) {
    messages.push({
      role: 'system',
      content: '/no_think\nYou are a strict JSON-only output assistant. Do not produce a thinking preamble, reasoning, or commentary. Reply with exactly one JSON object and nothing else.',
    });
  }
  messages.push({ role: 'user', content: prompt });

  const callOnce = async (useJsonMode: boolean): Promise<{ ok: true; content: string } | { ok: false; status: number; detail: string }> => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const body: JsonObject = {
      model,
      temperature,
      messages,
    };
    if (isQwen3) {
      // Different runtimes accept the disable-thinking switch in
      // different fields. Spray all three known variants so LM Studio
      // picks up whichever one matches its template.
      body.chat_template_kwargs = { enable_thinking: false };
      body.enable_thinking = false;
      body.extra_body = { chat_template_kwargs: { enable_thinking: false } };
    }
    // LM Studio's OpenAI-compat endpoint applies an internal default
    // when max_tokens is omitted, which has cut off long responses
    // mid-string in practice. Set a large explicit cap so the model
    // can actually complete its JSON. Callers can pass a smaller
    // explicit clamp if they want; -1 turns it off entirely.
    if (maxTokens === -1) {
      // explicit "no cap" sentinel — leave field off the request.
    } else if (isNumber(maxTokens) && maxTokens > 0) {
      body.max_tokens = maxTokens;
    } else {
      body.max_tokens = 32768;
    }
    if (useJsonMode) body.response_format = { type: 'json_object' };
    let res: Response;
    try {
      res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctl.signal,
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail };
    }
    // SAFETY: the chat-completions response shape. The fields are checked
    // before use, and a response that doesn't match raises the explicit
    // error below rather than propagating undefined.
    const parsed = await res.json() as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    const msg = parsed.choices?.[0]?.message ?? {};
    // Some runtimes split reasoning-model output between `content` and
    // `reasoning_content`. Read both and let the extractor strip the
    // reasoning portion via the <think> regex if needed.
    const content = (msg.content ?? '').trim();
    if (content) return { ok: true, content };
    const reasoning = (msg.reasoning_content ?? '').trim();
    if (reasoning) return { ok: true, content: reasoning };
    if (process.env.LM_CLIENT_DEBUG) {
      console.error('lm-client: empty response body for diagnosis:', JSON.stringify(parsed).slice(0, 500));
    }
    return { ok: true, content: '' };
  };

  let result = await callOnce(jsonMode);
  // Some runtimes 400 on unknown params. Retry without JSON mode so
  // the script doesn't dead-end on an older LM Studio.
  if (!result.ok && jsonMode && result.status === 400) {
    result = await callOnce(false);
  }
  if (!result.ok) {
    throw new Error(`Text request failed: HTTP ${result.status} ${result.detail.slice(0, 200)}`);
  }
  // Empty content recovery: local runtimes occasionally drop the first
  // request after a model load (warmup) or when JSON mode is on. Retry
  // once with json_mode off and a slightly stronger instruction. If
  // it's STILL empty, propagate so the caller fails loudly.
  if (result.content.trim().length === 0) {
    const retry = await callOnce(false);
    if (retry.ok && retry.content.trim().length > 0) return retry.content;
  }
  return result.content;
}

// Forward scan: find every top-level balanced JSON object in the text.
// Handles strings + escapes so braces inside string literals don't
// confuse the depth counter. Returns each as a raw substring; callers
// can JSON.parse and pick the right one.
function findBalancedJsonObjects(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { i += 1; continue; }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    let closed = false;
    for (; j < text.length; j++) {
      const c = text[j];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = false; }
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) { closed = true; break; }
      }
    }
    if (closed) {
      out.push(text.slice(i, j + 1));
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

// Score a candidate JSON object by how many of the expected refinement
// fields it has. The model usually emits multiple JSON-shaped fragments
// in its reasoning preamble ("here's an example: {...}" etc); the
// real answer is the one whose top-level keys actually match.
const REFINEMENT_KEYS = new Set([
  'caption', 'alt', 'country', 'theme', 'species', 'story', 'entities',
]);
function scoreCandidate(parsed: JsonValue): number {
  if (!isJsonObject(parsed)) return -1;
  // SAFETY: isJsonObject on the line above.
  const obj = parsed as JsonObject;
  let score = 0;
  for (const k of Object.keys(obj)) {
    if (REFINEMENT_KEYS.has(k)) score += 1;
  }
  return score;
}

// Models wrap JSON in many flavours: markdown fences ("```json … ```"),
// "Here is the JSON:" prefaces, plain-text "Thinking Process:" rambles,
// or formal <think>…</think> reasoning blocks. Strip what we can and
// then search for the best matching balanced JSON object in what's
// left. Returns the parsed object; throws with the raw response on
// failure so the operator can see what went wrong.
export function extractJsonObject(raw: string): JsonObject {
  const original = raw;
  // Drop formal <think>…</think> blocks first.
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // If there's a fenced ```json block, prefer it.
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) cleaned = fence[1].trim();

  // Find every balanced JSON object in the cleaned text. The model may
  // emit example JSON inside its reasoning preamble; the real answer
  // is whichever one has the most expected refinement keys.
  const candidates = findBalancedJsonObjects(cleaned);
  let bestParsed: JsonObject | null = null;
  let bestScore = -1;
  let lastError: Error | null = null;
  for (const c of candidates) {
    try {
      // SAFETY: JSON.parse returns any; JsonValue is the honest type. The
      // candidate is scored, not trusted.
      const parsed = JSON.parse(c) as JsonValue;
      const score = scoreCandidate(parsed);
      if (score > bestScore) {
        bestScore = score;
        // SAFETY: scoreCandidate returned >= 0, which it only does for an
        // object (it returns -1 otherwise).
        bestParsed = parsed as JsonObject;
      }
    } catch (e) {
      // SAFETY: the only thing thrown in this try is JSON.parse's SyntaxError.
      lastError = e as Error;
    }
  }
  if (bestParsed && bestScore >= 0) return bestParsed;

  // Nothing parsed — surface the most informative error we can.
  const snippet = original.trim().length === 0
    ? '(empty response — the model returned nothing)'
    : original.slice(0, 400);
  if (lastError) {
    throw new Error(`Invalid JSON from model: ${lastError.message}\nRaw: ${snippet}`);
  }
  throw new Error(`Model did not return JSON. Got: ${snippet}`);
}
