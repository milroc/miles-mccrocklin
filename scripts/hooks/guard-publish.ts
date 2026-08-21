// Claude Code PreToolUse hook. Blocks an agent from publishing work that
// does not pass the linters.
//
// The pre-push hook already covers a normal `git push`, but a hook an
// agent can step around is not a gate: `--no-verify` skips it, and
// `gh pr create` on an already-pushed branch never touches it at all.
// This sits one level up, on the tool call itself, and is the reason
// both exist.
//
// Contract: Claude Code sends the tool call as JSON on stdin. Exit 2
// blocks the call and feeds stderr back to the model, which is what
// makes the agent fix the errors rather than silently continue.
import { spawnSync } from 'node:child_process';

interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string };
}

// Commands that put work in front of a human. `git push` is here for the
// --no-verify case; the pre-push hook handles the ordinary one, and
// running preflight twice on a clean tree costs a few seconds.
const PUBLISHES = [
  /\bgh\s+pr\s+create\b/,
  /\bgh\s+pr\s+ready\b/,
  /\bgit\s+push\b/,
];

// A push that only deletes a branch, or that targets a scratch ref, has
// no tree to lint. Cleaning up merged branches should not run a linter.
const HARMLESS = [
  /\bgit\s+push\b[^|;]*--delete\b/,
  /\bgit\s+push\b[^|;]*\s:\S/,
];

const raw = await new Response(Bun.stdin.stream()).text();

let input: HookInput = {};
try {
  // SAFETY: the shape is checked at every read below — tool_name is
  // compared to a literal and tool_input?.command is defaulted — so a
  // payload that does not match simply falls through and allows the
  // call. Claude Code owns this format; guessing wrong fails open.
  input = JSON.parse(raw) as HookInput;
} catch {
  // A hook that fails open on malformed input is better than one that
  // wedges every Bash call in the session.
  process.exit(0);
}

const command = input.tool_input?.command ?? '';
if (input.tool_name !== 'Bash' || !command) process.exit(0);
if (HARMLESS.some((pattern) => pattern.test(command))) process.exit(0);
if (!PUBLISHES.some((pattern) => pattern.test(command))) process.exit(0);

const result = spawnSync('bash', ['scripts/preflight.sh'], {
  cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  encoding: 'utf8',
});

if (result.status === 0) process.exit(0);

const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
process.stderr.write(
  [
    'BLOCKED: this branch does not pass the linters, so publishing it would',
    'open a pull request that is red on arrival.',
    '',
    detail,
    '',
    'Fix the errors above and try again. Do not pass --no-verify, and do not',
    'edit this hook to get past it — if the rule itself is wrong, say so and',
    'let a human decide.',
  ].join('\n'),
);
process.exit(2);
