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
