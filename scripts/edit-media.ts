// Throwaway editor for media in data/me.json.
// Drag thumbnails within a carousel to reorder items in their parent array
// (the array order IS the priority). Edit text fields inline.
// Run: `bun scripts/edit-media.ts` then open http://localhost:4318

import { serve } from "bun";
import type { JsonValue } from "../src/utils/json";

const PORT = Number(process.env.PORT ?? 4318);
const ROOT = new URL("..", import.meta.url).pathname;
const RESUME_PATH = `${ROOT}data/me.json`;

type MediaItem = {
  path: (string | number)[];
  src: string;
  fields: Record<string, string>;
};

function findMedia(node: JsonValue, path: (string | number)[], out: MediaItem[]): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => findMedia(v, [...path, i], out));
    return;
  }
  if (node && typeof node === "object") {
    if (typeof node.src === "string" && node.src.startsWith("media/")) {
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === "string") fields[k] = v;
      }
      out.push({ path, src: node.src, fields });
    }
    for (const [k, v] of Object.entries(node)) {
      findMedia(v, [...path, k], out);
    }
  }
}

function setAtPath(root: any, path: (string | number)[], key: string, value: JsonValue): void {
  let cur = root;
  for (const p of path) cur = cur[p];
  cur[key] = value;
}

function deleteAtPath(root: any, path: (string | number)[], key: string): void {
  let cur = root;
  for (const p of path) cur = cur[p];
  delete cur[key];
}

function getAtPath(root: any, path: (string | number)[]): any {
  let cur = root;
  for (const p of path) cur = cur[p];
  return cur;
}

type Update = {
  path: (string | number)[];
  fields?: Record<string, string>;
};

// Reorder a media items[] array in place. parentPath points at the array
// itself (e.g. ["summary_media", "items"]). originalIndices is the new
// order expressed as a permutation of the original index list.
type Reorder = {
  parentPath: (string | number)[];
  originalIndices: number[];
};

const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(HTML, { headers: { "content-type": "text/html" } });
    }

    if (url.pathname === "/api/media") {
      const json = JSON.parse(await Bun.file(RESUME_PATH).text());
      const items: MediaItem[] = [];
      findMedia(json, [], items);
      return Response.json({ items });
    }

    if (url.pathname === "/api/save" && req.method === "POST") {
      const { updates, reorders } = (await req.json()) as {
        updates: Update[];
        reorders: Reorder[];
      };
      const json = JSON.parse(await Bun.file(RESUME_PATH).text());
      // Field updates first — paths are still valid because no array has
      // been touched yet.
      for (const u of updates) {
        if (u.fields) {
          for (const [k, v] of Object.entries(u.fields)) {
            if (v === "" && k !== "src") deleteAtPath(json, u.path, k);
            else setAtPath(json, u.path, k, v);
          }
        }
      }
      // Then reorders: replace each parent array with a permutation.
      for (const r of reorders || []) {
        const arr = getAtPath(json, r.parentPath);
        if (!Array.isArray(arr)) continue;
        const next = r.originalIndices.map((i) => arr[i]);
        arr.length = 0;
        arr.push(...next);
      }
      await Bun.write(RESUME_PATH, JSON.stringify(json, null, 2) + "\n");
      return Response.json({ ok: true });
    }

    // Static fallback for media/
    const path = ROOT + decodeURIComponent(url.pathname).replace(/^\//, "");
    const file = Bun.file(path);
    if (await file.exists()) return new Response(file);
    return new Response("not found", { status: 404 });
  },
});

console.log(`media editor → ${server.url}`);

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Media editor</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font: 14px/1.45 -apple-system, system-ui, sans-serif;
    margin: 0; padding: 24px 24px 120px;
    background: #f7f6f3; color: #222;
  }
  h1 { font-size: 18px; margin: 0; }
  .toolbar {
    position: sticky; top: 0; z-index: 20;
    background: #f7f6f3; padding: 12px 0;
    display: flex; gap: 12px; align-items: center;
    border-bottom: 1px solid #e5e2dc; margin-bottom: 16px;
  }
  button {
    font: inherit; padding: 6px 14px; border: 1px solid #444;
    background: #222; color: white; border-radius: 4px; cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  button.secondary { background: white; color: #222; }
  input[type="search"] {
    flex: 1; max-width: 300px;
    font: inherit; padding: 6px 10px;
    border: 1px solid #ccc; border-radius: 4px;
  }
  .status { font-size: 12px; color: #666; margin-left: auto; }
  .status.dirty { color: #b85a00; font-weight: 600; }
  .status.saved { color: #2a7a2a; }

  .group {
    background: white; border: 1px solid #e5e2dc;
    border-radius: 8px; margin-bottom: 24px; overflow: hidden;
  }
  .group-head {
    padding: 10px 14px; background: #fafaf7;
    border-bottom: 1px solid #e5e2dc;
    display: flex; gap: 12px; align-items: center;
  }
  .group-head .label {
    font-family: ui-monospace, monospace; font-size: 12px;
    color: #555; flex: 1;
  }
  .group-head .count {
    font-size: 11px; color: #888;
    padding: 2px 8px; background: #ece9e2; border-radius: 10px;
  }
  .group-list {
    padding: 14px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }

  .card {
    border: 1px solid #e5e2dc; border-radius: 6px;
    background: white; cursor: grab; user-select: none;
    display: flex; flex-direction: column;
    transition: transform 0.08s ease, box-shadow 0.08s ease;
    position: relative;
  }
  .card:active { cursor: grabbing; }
  .card.dragging { opacity: 0.4; }
  .card.drop-target {
    box-shadow: 0 0 0 2px #2a7a2a inset;
  }
  .card.dirty {
    border-color: #b85a00;
    box-shadow: 0 0 0 2px #fde9d3;
  }
  .card-thumb {
    width: 100%; aspect-ratio: 1;
    background: #f0ede6; overflow: hidden;
    border-radius: 6px 6px 0 0;
    position: relative;
  }
  .card-thumb img, .card-thumb video {
    width: 100%; height: 100%;
    object-fit: cover; display: block;
  }
  .card-rank {
    position: absolute; top: 6px; left: 6px;
    background: rgba(0, 0, 0, 0.7); color: white;
    font-family: ui-monospace, monospace; font-size: 11px;
    font-weight: 600; padding: 2px 6px; border-radius: 10px;
    min-width: 22px; text-align: center;
  }
  .card-handle {
    position: absolute; top: 6px; right: 6px;
    background: rgba(0, 0, 0, 0.5); color: white;
    font-size: 11px; padding: 2px 6px; border-radius: 4px;
    pointer-events: none;
  }
  .card-meta { padding: 8px 10px; }
  .card-src {
    font-family: ui-monospace, monospace; font-size: 10px;
    color: #999; word-break: break-all;
  }
  .card-caption {
    font-size: 12px; color: #555; margin-top: 4px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-edit {
    margin-top: 6px;
    font-size: 11px; color: #2057a3;
    background: none; border: none; padding: 0;
    cursor: pointer; text-decoration: underline;
  }

  .editor {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: none; align-items: center; justify-content: center;
    z-index: 100;
  }
  .editor.open { display: flex; }
  .editor-panel {
    background: white; border-radius: 8px;
    padding: 20px; width: min(640px, 90vw);
    max-height: 90vh; overflow: auto;
  }
  .editor-panel h3 {
    margin: 0 0 12px; font-size: 14px;
    font-family: ui-monospace, monospace;
  }
  .editor-media { width: 100%; max-height: 240px; object-fit: contain;
    background: #f0ede6; border-radius: 4px; margin-bottom: 12px; }
  .field { display: grid; grid-template-columns: 90px 1fr;
    gap: 8px; margin-bottom: 8px; align-items: start; }
  .field label { font-size: 12px; color: #555; padding-top: 6px;
    font-weight: 500; }
  .field textarea, .field input[type="text"] {
    font: inherit; padding: 6px 8px; border: 1px solid #ccc;
    border-radius: 4px; resize: vertical; width: 100%;
    font-family: ui-monospace, monospace; font-size: 13px;
  }
  .field textarea { min-height: 38px; }
  .field.readonly input { background: #f7f6f3; color: #888; }
  .add-field { font-size: 11px; cursor: pointer;
    background: none; border: 1px dashed #ccc; color: #555;
    padding: 4px 8px; border-radius: 4px; margin-right: 4px; }
  .editor-actions {
    display: flex; gap: 8px; justify-content: flex-end;
    margin-top: 12px; padding-top: 12px;
    border-top: 1px solid #e5e2dc;
  }

  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #ddd; }
    .toolbar { background: #1a1a1a; border-bottom-color: #333; }
    .group { background: #222; border-color: #333; }
    .group-head { background: #1f1f1f; border-bottom-color: #333; }
    .group-head .count { background: #2a2a2a; color: #aaa; }
    .card { background: #2a2a2a; border-color: #3a3a3a; }
    .card.dirty { border-color: #d97a2c; box-shadow: 0 0 0 2px #3a2818; }
    .card-thumb { background: #111; }
    .editor-panel { background: #222; }
    .field textarea, .field input[type="text"] {
      background: #2a2a2a; border-color: #444; color: #ddd;
    }
    .field.readonly input { background: #1a1a1a; color: #777; }
    button.secondary { background: #2a2a2a; color: #ddd; border-color: #555; }
    .card-src { color: #888; }
    .card-caption { color: #bbb; }
    .group-head .label { color: #aaa; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <h1>Media editor</h1>
  <input type="search" id="search" placeholder="filter by src or text…" />
  <span class="status" id="status">loading…</span>
  <button id="save" disabled>Save all</button>
</div>
<div id="groups"></div>

<div class="editor" id="editor">
  <div class="editor-panel" id="editor-panel"></div>
</div>

<script type="module">
const groupsEl = document.getElementById('groups');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');
const search = document.getElementById('search');
const editor = document.getElementById('editor');
const editorPanel = document.getElementById('editor-panel');

let items = [];           // server snapshot, never mutated
let dirtyFields = new Map();  // index -> Record<string,string> (override of .fields)
let order = new Map();        // groupKey -> number[] of item indices in display order
let originalOrder = new Map(); // groupKey -> number[] (snapshot at load time)

function setStatus(text, cls) {
  status.textContent = text;
  status.className = 'status' + (cls ? ' ' + cls : '');
}

function dirtyOrderGroups() {
  const out = [];
  for (const [k, cur] of order) {
    const orig = originalOrder.get(k);
    if (!orig || cur.length !== orig.length) continue;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] !== orig[i]) { out.push(k); break; }
    }
  }
  return out;
}

function dirtyCount() {
  return dirtyFields.size + dirtyOrderGroups().length;
}

function refreshSaveBtn() {
  const n = dirtyCount();
  saveBtn.disabled = n === 0;
  if (n === 0) {
    setStatus(\`\${items.length} items\`);
  } else {
    setStatus(\`\${n} unsaved\`, 'dirty');
  }
}

function isVideo(src) { return /\\.(mp4|mov|webm)$/i.test(src); }

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function groupKeyOf(path) {
  return path.slice(0, -1).join('.');
}

function effectiveFields(i) {
  return dirtyFields.get(i) ?? items[i].fields;
}

function buildGroups() {
  order.clear();
  originalOrder.clear();
  const groups = new Map();
  items.forEach((item, i) => {
    const k = groupKeyOf(item.path);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  // Array order in me.json IS the priority. Sort by trailing path
  // index so the display matches the JSON's authored order.
  for (const [k, idxs] of groups) {
    idxs.sort((a, b) => {
      const la = items[a].path[items[a].path.length - 1];
      const lb = items[b].path[items[b].path.length - 1];
      return Number(la) - Number(lb);
    });
    order.set(k, idxs);
    originalOrder.set(k, [...idxs]);
  }
  return groups;
}

function isOrderDirty(k) {
  const cur = order.get(k);
  const orig = originalOrder.get(k);
  if (!cur || !orig || cur.length !== orig.length) return false;
  for (let i = 0; i < cur.length; i++) if (cur[i] !== orig[i]) return true;
  return false;
}

function render() {
  const q = search.value.trim().toLowerCase();
  groupsEl.innerHTML = '';
  for (const [k, idxs] of order) {
    const filtered = q
      ? idxs.filter(i => {
          const f = effectiveFields(i);
          const hay = [items[i].src, ...Object.values(f)].join(' ').toLowerCase();
          return hay.includes(q);
        })
      : idxs;
    if (filtered.length === 0) continue;

    const groupEl = document.createElement('div');
    groupEl.className = 'group';
    groupEl.dataset.gk = k;
    groupEl.innerHTML = \`
      <div class="group-head">
        <div class="label">\${escape(k)}</div>
        <div class="count">\${idxs.length} items</div>
      </div>
      <div class="group-list" data-gk="\${escape(k)}"></div>
    \`;
    const listEl = groupEl.querySelector('.group-list');

    const groupDirty = isOrderDirty(k);
    idxs.forEach((i, displayIdx) => {
      if (!filtered.includes(i)) return;
      const f = effectiveFields(i);
      const isDirty = dirtyFields.has(i) || groupDirty;
      const card = document.createElement('div');
      card.className = 'card' + (isDirty ? ' dirty' : '');
      card.draggable = true;
      card.dataset.i = i;
      card.dataset.gk = k;
      const thumb = isVideo(items[i].src)
        ? \`<video src="/\${items[i].src}" muted preload="metadata" playsinline></video>\`
        : \`<img src="/\${items[i].src}" loading="lazy" alt="" />\`;
      const caption = f.caption || f.alt || f.description || '';
      card.innerHTML = \`
        <div class="card-thumb">
          \${thumb}
          <div class="card-rank">#\${displayIdx + 1}</div>
          <div class="card-handle">⠿</div>
        </div>
        <div class="card-meta">
          <div class="card-src">\${escape(items[i].src.replace(/^media\\//, ''))}</div>
          \${caption ? \`<div class="card-caption">\${escape(caption)}</div>\` : ''}
          <button class="card-edit" data-edit="\${i}">edit fields</button>
        </div>
      \`;
      listEl.appendChild(card);
    });

    groupsEl.appendChild(groupEl);
  }
  refreshSaveBtn();
}

// --- Drag and drop within a group ---
let dragSrcIdx = null;
let dragSrcGk = null;

groupsEl.addEventListener('dragstart', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  dragSrcIdx = +card.dataset.i;
  dragSrcGk = card.dataset.gk;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragSrcIdx));
});

groupsEl.addEventListener('dragend', e => {
  const card = e.target.closest('.card');
  if (card) card.classList.remove('dragging');
  document.querySelectorAll('.card.drop-target').forEach(c =>
    c.classList.remove('drop-target')
  );
  dragSrcIdx = null;
  dragSrcGk = null;
});

groupsEl.addEventListener('dragover', e => {
  if (dragSrcIdx == null) return;
  const card = e.target.closest('.card');
  if (!card) return;
  if (card.dataset.gk !== dragSrcGk) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.card.drop-target').forEach(c =>
    c.classList.remove('drop-target')
  );
  card.classList.add('drop-target');
});

groupsEl.addEventListener('drop', e => {
  if (dragSrcIdx == null) return;
  const card = e.target.closest('.card');
  if (!card) return;
  if (card.dataset.gk !== dragSrcGk) return;
  e.preventDefault();
  const targetIdx = +card.dataset.i;
  if (targetIdx === dragSrcIdx) return;
  reorderWithin(dragSrcGk, dragSrcIdx, targetIdx, e);
});

function reorderWithin(gk, fromIdx, toIdx, e) {
  const arr = order.get(gk);
  if (!arr) return;
  const fromPos = arr.indexOf(fromIdx);
  const toPos = arr.indexOf(toIdx);
  if (fromPos < 0 || toPos < 0) return;

  // Determine before/after based on cursor position relative to target card
  const card = e.target.closest('.card');
  const rect = card.getBoundingClientRect();
  const isHoriz = rect.width > rect.height * 1.2;
  const before = isHoriz
    ? e.clientX < rect.left + rect.width / 2
    : e.clientY < rect.top + rect.height / 2;

  arr.splice(fromPos, 1);
  let insertAt = arr.indexOf(toIdx);
  if (!before) insertAt += 1;
  arr.splice(insertAt, 0, fromIdx);

  // The order Map is now the single source of truth for this group.
  // Dirty status is derived by comparing against originalOrder.
  render();
}

// --- Field editor modal ---
let editIdx = null;

groupsEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-edit]');
  if (!btn) return;
  editIdx = +btn.dataset.edit;
  openEditor();
});

function openEditor() {
  if (editIdx == null) return;
  const item = items[editIdx];
  const f = { ...effectiveFields(editIdx) };
  const thumb = isVideo(item.src)
    ? \`<video class="editor-media" src="/\${item.src}" controls muted preload="metadata"></video>\`
    : \`<img class="editor-media" src="/\${item.src}" alt="" />\`;
  const fieldRows = Object.entries(f).map(([k, v]) => {
    const ro = k === 'src' || k === 'type' || k === 'poster';
    const isLong = k === 'caption' || k === 'description' || k === 'alt';
    const inputEl = isLong
      ? \`<textarea data-k="\${k}"\${ro ? ' readonly' : ''}>\${escape(v)}</textarea>\`
      : \`<input type="text" data-k="\${k}" value="\${escape(v)}"\${ro ? ' readonly' : ''} />\`;
    return \`<div class="field\${ro ? ' readonly' : ''}"><label>\${k}</label>\${inputEl}</div>\`;
  }).join('');
  const hasCaption = 'caption' in f;
  const hasAlt = 'alt' in f;
  const addBtns = [
    !hasCaption && '<button class="add-field" data-add="caption">+ caption</button>',
    !hasAlt && '<button class="add-field" data-add="alt">+ alt</button>',
  ].filter(Boolean).join(' ');
  editorPanel.innerHTML = \`
    <h3>\${escape(item.path.join(' · '))}</h3>
    \${thumb}
    <div id="editor-fields">\${fieldRows}</div>
    \${addBtns ? \`<div style="margin-top:8px">\${addBtns}</div>\` : ''}
    <div class="editor-actions">
      <button class="secondary" data-act="cancel">Close</button>
    </div>
  \`;
  editor.classList.add('open');
}

function closeEditor() {
  editor.classList.remove('open');
  editIdx = null;
}

editor.addEventListener('click', e => {
  if (e.target === editor) closeEditor();
  if (e.target.dataset.act === 'cancel') closeEditor();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && editor.classList.contains('open')) closeEditor();
});

editorPanel.addEventListener('input', e => {
  const t = e.target;
  if (!t.dataset.k || editIdx == null) return;
  const k = t.dataset.k;
  const current = dirtyFields.get(editIdx) ?? { ...items[editIdx].fields };
  current[k] = t.value;
  // If the new state matches the snapshot exactly, drop the dirty entry
  const snap = items[editIdx].fields;
  const same = Object.keys(current).length === Object.keys(snap).length &&
    Object.entries(current).every(([kk, vv]) => snap[kk] === vv);
  if (same) dirtyFields.delete(editIdx);
  else dirtyFields.set(editIdx, current);
  refreshSaveBtn();
  // Update the underlying card without closing modal
  updateCardCaption(editIdx);
});

editorPanel.addEventListener('click', e => {
  const btn = e.target.closest('[data-add]');
  if (!btn || editIdx == null) return;
  const k = btn.dataset.add;
  const current = dirtyFields.get(editIdx) ?? { ...items[editIdx].fields };
  if (!(k in current)) current[k] = '';
  dirtyFields.set(editIdx, current);
  refreshSaveBtn();
  openEditor(); // re-render with new field
});

function updateCardCaption(i) {
  const card = groupsEl.querySelector(\`.card[data-i="\${i}"]\`);
  if (!card) return;
  const f = effectiveFields(i);
  const caption = f.caption || f.alt || f.description || '';
  const cap = card.querySelector('.card-caption');
  if (caption) {
    if (cap) cap.textContent = caption;
    else {
      const meta = card.querySelector('.card-meta');
      const editBtn = meta.querySelector('.card-edit');
      const div = document.createElement('div');
      div.className = 'card-caption';
      div.textContent = caption;
      meta.insertBefore(div, editBtn);
    }
  } else if (cap) cap.remove();
  const k = groupKeyOf(items[i].path);
  card.classList.toggle('dirty', dirtyFields.has(i) || isOrderDirty(k));
}

search.addEventListener('input', render);

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  setStatus('saving…');
  const updates = [...dirtyFields.keys()].map(i => ({
    path: items[i].path,
    fields: dirtyFields.get(i),
  }));
  const dirtyGroups = dirtyOrderGroups();
  const reorders = dirtyGroups.map(k => {
    // Build the parent path: the group key is path.slice(0, -1).join('.'),
    // so any item in the group exposes the parent path via its own path.
    const sample = order.get(k)[0];
    const parentPath = items[sample].path.slice(0, -1);
    // originalIndices: for each new position, the item's ORIGINAL index in
    // the parent array (the trailing path segment at load time).
    const originalIndices = order.get(k).map(i =>
      Number(items[i].path[items[i].path.length - 1])
    );
    return { parentPath, originalIndices };
  });
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ updates, reorders }),
  });
  if (!res.ok) {
    setStatus('save failed', 'dirty');
    saveBtn.disabled = false;
    return;
  }
  // After a save that reordered groups, the on-disk paths have shifted.
  // Easiest correct path: refetch from the server so items[].path matches
  // disk again. Same for the originalOrder snapshot.
  for (const i of dirtyFields.keys()) {
    const merged = { ...dirtyFields.get(i) };
    for (const k of Object.keys(merged)) {
      if (merged[k] === '' && k !== 'src') delete merged[k];
    }
    items[i].fields = merged;
  }
  dirtyFields.clear();
  if (dirtyGroups.length) {
    setStatus('saved, reloading…', 'saved');
    await load();
  } else {
    setStatus('saved', 'saved');
    setTimeout(refreshSaveBtn, 800);
    render();
  }
});

async function load() {
  const res = await fetch('/api/media');
  const data = await res.json();
  items = data.items;
  buildGroups();
  setStatus(\`\${items.length} items\`);
  render();
}
load();
</script>
</body>
</html>`;
