// A thrown value is only conventionally an Error — a string, or anything
// else, can arrive in a catch. Reading `.message` off an assertion gets
// `undefined` for those; this checks instead.
//
// The parameter is named `cause` because that is what it is: the value
// that caused the failure, in the sense `new Error(msg, { cause })` uses.
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
