// Tiny JSON-pointer helpers for path-addressed edits. Paths look like
// `/experience/0/achievements/2/text`. We deep-clone along the path on
// `setAtPath` so the upstream React state stays immutable.

// The tree these helpers walk is `data/me.json`, so a node is a JsonValue
// (src/utils/json.ts). Naming that union is what lets the walk narrow
// structurally instead of asserting its way down, and it tells callers
// what came back — `unknown` made every one of them re-derive a shape
// the walker already knew.
import type { JsonObject, JsonValue } from '../utils/json';
import { isJsonObject } from '../utils/json';

export function getAtPath(obj: JsonValue, path: string): JsonValue {
  if (!path || path === '/') return obj;
  const segs = path.split('/').filter(Boolean);
  let cur: JsonValue = obj;
  for (const s of segs) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(s)];
    else if (isJsonObject(cur)) cur = cur[s];
    else return undefined;
  }
  return cur;
}

export function setAtPath<T extends JsonValue>(obj: T, path: string, value: JsonValue): T {
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return value as T;
  return cloneSet(obj, segs, 0, value) as T;
}

function cloneSet(node: JsonValue, segs: string[], i: number, value: JsonValue): JsonValue {
  if (i === segs.length) return value;
  const seg = segs[i]!;
  if (Array.isArray(node)) {
    const idx = Number(seg);
    const next = node.slice();
    next[idx] = cloneSet(node[idx], segs, i + 1, value);
    return next;
  }
  // A missing or leaf node under a longer path becomes a fresh record —
  // writing `/a/b` into a tree with no `/a` creates it.
  const obj: JsonObject = isJsonObject(node) ? node : {};
  return { ...obj, [seg]: cloneSet(obj[seg], segs, i + 1, value) };
}

// Compose a child path. `joinPath('/experience/0', 'achievements', 2)` →
// `/experience/0/achievements/2`. Numbers become array indices, strings
// become object keys; the slash form is canonical so paths sort and diff
// cleanly.
export function joinPath(base: string, ...parts: (string | number)[]): string {
  const tail = parts.map(String).join('/');
  if (!tail) return base;
  return `${base}/${tail}`;
}

// Remove the value at `path`. For arrays it splices the index out (so
// every later element's index shifts down by one — callers that hold
// stale paths after a delete need to re-derive). For objects it
// deletes the key. Returns a new tree; original is untouched.
export function deleteAtPath<T extends JsonValue>(obj: T, path: string): T {
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return obj;
  return cloneDelete(obj, segs, 0) as T;
}

function cloneDelete(node: JsonValue, segs: string[], i: number): JsonValue {
  const seg = segs[i]!;
  // Last segment — perform the delete on this container.
  if (i === segs.length - 1) {
    if (Array.isArray(node)) {
      const idx = Number(seg);
      const next = node.slice();
      next.splice(idx, 1);
      return next;
    }
    if (isJsonObject(node)) {
      const { [seg]: _drop, ...rest } = node;
      return rest;
    }
    return node;
  }
  // Recurse — clone-on-write along the spine.
  if (Array.isArray(node)) {
    const idx = Number(seg);
    const next = node.slice();
    next[idx] = cloneDelete(node[idx], segs, i + 1);
    return next;
  }
  if (isJsonObject(node)) {
    return { ...node, [seg]: cloneDelete(node[seg], segs, i + 1) };
  }
  return node;
}

// True when `child` is the same as `parent` or sits beneath it. Used
// when a delete record arrives — every other change targeting the
// deleted subtree becomes moot.
export function pathStartsWith(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent + '/');
}
