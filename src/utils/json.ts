// The shape of anything that came out of `JSON.parse` — a leaf, a list,
// or a string-keyed record. Both halves of the repo walk parsed JSON
// (`src/edit` over the resume tree, `scripts/` over me.json and the
// label event log), so the union lives here where both can reach it.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

// Guards for reading a JsonValue. Each one puts its `typeof` behind a
// type predicate — the point where a representation check becomes a
// contract — so callers narrow by asking a named question instead of
// re-deriving the shape at every field.

export function isString(value: JsonValue): value is string {
  return typeof value === 'string';
}

export function isNumber(value: JsonValue): value is number {
  return typeof value === 'number';
}

export function isBoolean(value: JsonValue): value is boolean {
  return typeof value === 'boolean';
}

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Field readers: the value when it is of that type, otherwise undefined.
// `asString(o.caption)` replaces `typeof o.caption === 'string' ? o.caption : undefined`.

export function asString(value: JsonValue): string | undefined {
  return isString(value) ? value : undefined;
}

export function asNumber(value: JsonValue): number | undefined {
  return isNumber(value) ? value : undefined;
}

export function asBoolean(value: JsonValue): boolean | undefined {
  return isBoolean(value) ? value : undefined;
}

export function asJsonObject(value: JsonValue): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function asStringArray(value: JsonValue): string[] | undefined {
  return Array.isArray(value) && value.every(isString) ? value : undefined;
}

// A string with something in it, trimmed — the recurring "did the
// curator or the model actually say anything" test.
export function asNonEmptyString(value: JsonValue): string | undefined {
  const text = asString(value)?.trim();
  return text ? text : undefined;
}
