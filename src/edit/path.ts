// Tiny JSON-pointer helpers for path-addressed edits. Paths look like
// `/experience/0/achievements/2/text`. We deep-clone along the path on
// `setAtPath` so the upstream React state stays immutable.

type Json = unknown;

export function getAtPath(obj: Json, path: string): Json {
  if (!path || path === '/') return obj;
  const segs = path.split('/').filter(Boolean);
  let cur: Json = obj;
  for (const s of segs) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(s)];
    else if (typeof cur === 'object') cur = (cur as Record<string, Json>)[s];
    else return undefined;
  }
  return cur;
}

export function setAtPath<T>(obj: T, path: string, value: Json): T {
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return value as T;
  return cloneSet(obj as Json, segs, 0, value) as T;
}

function cloneSet(node: Json, segs: string[], i: number, value: Json): Json {
  if (i === segs.length) return value;
  const seg = segs[i]!;
  if (Array.isArray(node)) {
    const idx = Number(seg);
    const next = node.slice();
    next[idx] = cloneSet(node[idx], segs, i + 1, value);
    return next;
  }
  const obj = (node ?? {}) as Record<string, Json>;
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
export function deleteAtPath<T>(obj: T, path: string): T {
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return obj;
  return cloneDelete(obj as unknown, segs, 0) as T;
}

function cloneDelete(node: unknown, segs: string[], i: number): unknown {
  const seg = segs[i]!;
  // Last segment — perform the delete on this container.
  if (i === segs.length - 1) {
    if (Array.isArray(node)) {
      const idx = Number(seg);
      const next = node.slice();
      next.splice(idx, 1);
      return next;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const { [seg]: _drop, ...rest } = obj;
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
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    return { ...obj, [seg]: cloneDelete(obj[seg], segs, i + 1) };
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
