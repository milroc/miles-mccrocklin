// Shared LM Studio client. Used by:
//   - classify-photography.ts (raw structured-label generation per photo)
//   - merge-labels.ts          (notes → refined-labels prompt at merge time)
//
// Both invoke an OpenAI-compatible chat-completions endpoint with a
// single vision-input message and parse the JSON the model returns out
// of the response text. The domain-specific bits (which prompt, which
// fields to validate, country-slug constraints) stay in the caller.

import { spawn, spawnSync } from 'node:child_process';
import sharp from 'sharp';

// Thumbnail size sent to the model. 768px on the long edge is enough
// for any vision model to identify subjects + setting without burning
// VRAM on giant inputs. Keeps a single base64 payload under ~150 KB.
export const VISION_THUMB_WIDTH = 768;
export const VISION_THUMB_QUALITY = 80;

// Per-photo network timeout. Local models can stall on first load;
// 5 minutes is generous for a cold-cache 32B model on Apple Silicon.
export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export const DEFAULT_ENDPOINT = 'http://localhost:1234/v1';

export async function imageToDataUrl(absPath: string): Promise<string> {
  const buf = await sharp(absPath)
    .rotate()
    .resize({ width: VISION_THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: VISION_THUMB_QUALITY, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
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
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).map((m) => m.id);
}

// Ensure a model satisfying `predicate` is loaded in LM Studio. If one
// already shows in /v1/models, return its id. Otherwise try
// `lms load <preferred>`, falling back to whatever installed model
// `lms ls` reports as a match. Returns the loaded id or null.
async function ensureModelLoadedMatching(
  endpoint: string,
  predicate: (id: string) => boolean,
  preferredModel: string | null,
  kindLabel: 'vision' | 'text',
): Promise<string | null> {
  let ids = await fetchLoadedModelIds(endpoint);
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
      const load = spawnSync('lms', ['load', upgrade], { stdio: 'inherit' });
      if (load.status === 0) {
        ids = await fetchLoadedModelIds(endpoint);
        const next = pickByPreference(ids, predicate);
        if (next) return next;
      }
    }
  }
  if (pickExisting) return pickExisting;

  const target = preferredModel ?? findInstalledModel(predicate, kindLabel === 'text');
  if (!target) {
    console.warn(
      `lm-client: no ${kindLabel} model loaded and none found locally. ` +
      `Pass --model <id> or run \`lms load <model>\` manually.`,
    );
    return null;
  }
  console.log(`lm-client: loading ${kindLabel} model "${target}" via \`lms load\`…`);
  const load = spawnSync('lms', ['load', target], { stdio: 'inherit' });
  if (load.status !== 0) {
    console.warn(`lm-client: \`lms load ${target}\` exited non-zero`);
    return null;
  }
  ids = await fetchLoadedModelIds(endpoint);
  return kindLabel === 'text'
    ? pickByPreference(ids, predicate)
    : (ids.find((id) => predicate(id)) ?? null);
}

// Ensure a VISION model is loaded. Used by classify-photography.
export async function ensureVisionModelLoaded(
  endpoint: string = DEFAULT_ENDPOINT,
  preferredModel: string | null = null,
): Promise<string | null> {
  return ensureModelLoadedMatching(
    endpoint,
    (id) => VISION_HINTS_RE.test(id),
    preferredModel,
    'vision',
  );
}

// Ensure a TEXT-ONLY model is loaded. Used by merge-labels, where
// curator-notes refinement and dupe-merge are text-in/text-out — a
// vision model is overkill and slower. "Text-only" here just means
// "not a vision model" (anything that isn't vision-tagged).
export async function ensureTextModelLoaded(
  endpoint: string = DEFAULT_ENDPOINT,
  preferredModel: string | null = null,
): Promise<string | null> {
  return ensureModelLoadedMatching(
    endpoint,
    (id) => !VISION_HINTS_RE.test(id),
    preferredModel,
    'text',
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
}

// Single chat-completions call with one user message containing the
// prompt text + 1..N images. Returns the raw assistant content string —
// callers parse JSON / extract fields themselves.
export async function chatVision(opts: ChatVisionOptions): Promise<string> {
  const {
    endpoint, model, prompt, imageUrl, imageUrls,
    temperature = 0.2, maxTokens,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = opts;
  const urls = imageUrls && imageUrls.length > 0
    ? imageUrls
    : (imageUrl ? [imageUrl] : []);
  if (urls.length === 0) {
    throw new Error('chatVision requires at least one image (imageUrl or imageUrls)');
  }
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  for (const url of urls) {
    content.push({ type: 'image_url', image_url: { url } });
  }
  const body: Record<string, unknown> = {
    model,
    temperature,
    messages: [{ role: 'user', content }],
  };
  if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = maxTokens;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
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
    throw new Error(`Vision request failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const parsed = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return parsed.choices?.[0]?.message?.content ?? '';
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
    const body: Record<string, unknown> = {
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
    } else if (typeof maxTokens === 'number' && maxTokens > 0) {
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
function scoreCandidate(parsed: unknown): number {
  if (!parsed || typeof parsed !== 'object') return -1;
  const obj = parsed as Record<string, unknown>;
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
export function extractJsonObject(raw: string): Record<string, unknown> {
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
  let bestParsed: Record<string, unknown> | null = null;
  let bestScore = -1;
  let lastError: Error | null = null;
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      const score = scoreCandidate(parsed);
      if (score > bestScore) {
        bestScore = score;
        bestParsed = parsed as Record<string, unknown>;
      }
    } catch (e) {
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
