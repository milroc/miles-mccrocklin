#!/usr/bin/env bun
// Edit captions and tags for UI items in data/me.json.
//
// Finds every media item with `subtype: "ui"`, dumps the editable
// fields into a temp file, opens it in $EDITOR, then merges the changes
// back into me.json. Save and quit to apply; quit without saving (or
// delete a block) to skip an item.
//
// Usage:
//   bun scripts/edit-ui-copy.ts            # uses $EDITOR / $VISUAL / vi
//   EDITOR="cursor --wait" bun scripts/...  # open the file in Cursor
//   bun scripts/edit-ui-copy.ts --dry-run  # show parsed changes, don't write
//
// File format (text, opens with no language):
//   # comments allowed (any line starting with #)
//   === <id> ===              ← read-only marker
//   tag: <one-line tag>
//   caption:
//   <multi-line caption — line breaks inside a paragraph collapse to a
//    single space; a blank line introduces a literal newline>
//
// Delete a whole `=== <id> ===` block to leave that item alone.

import { spawnSync } from "node:child_process";
import type { JsonObject } from '../src/utils/json';
import type { JsonValue } from "../src/utils/json";
import {
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const RESUME_PATH = `${ROOT}data/me.json`;

interface UiItem {
  id: string;
  src: string;
  tag?: string;
  caption?: string;
  subtype?: string;
  // ref kept so we can mutate in place
  _ref: JsonObject;
}

function findUiItems(node: JsonValue, out: UiItem[] = []): UiItem[] {
  if (Array.isArray(node)) {
    for (const v of node) findUiItems(v, out);
  } else if (node && typeof node === "object") {
    if (
      node.subtype === "ui" &&
      typeof node.id === "string" &&
      typeof node.src === "string"
    ) {
      out.push({
        id: node.id,
        src: node.src,
        tag: typeof node.tag === "string" ? node.tag : undefined,
        caption: typeof node.caption === "string" ? node.caption : undefined,
        subtype: "ui",
        _ref: node,
      });
    }
    for (const v of Object.values(node)) findUiItems(v, out);
  }
  return out;
}

function dump(items: UiItem[]): string {
  const header = [
    "# UI copy editor — save and exit to apply changes to data/me.json.",
    "#",
    "# Edit `tag:` (one line) and the `caption:` body (free-form, multi-line).",
    "# Inside a caption, a wrap-only line break joins with a single space; a",
    "# blank line becomes a real newline in the JSON. Delete a block to skip.",
    "",
  ].join("\n");
  const blocks = items.map((it) => {
    const cap = (it.caption ?? "").trim();
    return [
      `=== ${it.id} ===`,
      `# src: ${it.src}`,
      `tag: ${(it.tag ?? "").trim()}`,
      "caption:",
      cap,
      "",
    ].join("\n");
  });
  return header + "\n" + blocks.join("\n");
}

interface Parsed {
  tag: string;
  caption: string;
}

function parse(text: string): Map<string, Parsed> {
  const out = new Map<string, Parsed>();
  const lines = text.split(/\r?\n/);
  let i = 0;

  const isComment = (l: string) => /^\s*#/.test(l);
  const isHeader = (l: string) => /^===\s+\S.*\s+===\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (isComment(line) || line.trim() === "") {
      i++;
      continue;
    }
    const m = line.match(/^===\s+(\S.*?)\s+===\s*$/);
    if (!m) {
      i++;
      continue;
    }
    const id = m[1]!;
    i++;

    let tag = "";
    let captionRaw: string[] = [];
    let inCaption = false;

    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (isHeader(l)) break;
      if (!inCaption && isComment(l)) {
        i++;
        continue;
      }
      if (!inCaption) {
        const tagMatch = l.match(/^tag:\s*(.*)$/i);
        if (tagMatch) {
          tag = tagMatch[1]!.trim();
          i++;
          continue;
        }
        if (/^caption:\s*$/i.test(l)) {
          inCaption = true;
          i++;
          continue;
        }
        // unknown non-comment line — ignore
        i++;
        continue;
      }
      // inCaption: collect until next header
      captionRaw.push(l);
      i++;
    }

    // Caption normalization. Treat a blank line as a paragraph break (real
    // \n in the output); inside a paragraph, fold wrap-only line breaks
    // into a single space. Trim leading/trailing whitespace overall.
    const paragraphs = captionRaw
      .join("\n")
      .replace(/\s+$/g, "") // strip trailing whitespace
      .replace(/^\s+/g, "") // strip leading whitespace
      .split(/\n\s*\n/);
    const caption = paragraphs
      .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
      .filter((p) => p.length > 0)
      .join("\n");

    out.set(id, { tag, caption });
  }
  return out;
}

function diffSummary(before: UiItem, parsed: Parsed): string[] {
  const changes: string[] = [];
  const beforeTag = (before.tag ?? "").trim();
  const beforeCap = (before.caption ?? "").trim();
  if (beforeTag !== parsed.tag) {
    changes.push(`tag: "${beforeTag}" → "${parsed.tag}"`);
  }
  if (beforeCap !== parsed.caption) {
    const before80 = beforeCap.slice(0, 80) + (beforeCap.length > 80 ? "…" : "");
    const after80 =
      parsed.caption.slice(0, 80) + (parsed.caption.length > 80 ? "…" : "");
    changes.push(`caption: "${before80}"\n         → "${after80}"`);
  }
  return changes;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const raw = readFileSync(RESUME_PATH, "utf8");
  const data = JSON.parse(raw);
  const items = findUiItems(data);

  if (items.length === 0) {
    console.error(
      'No UI items found. Mark items with `"subtype": "ui"` in data/me.json first.',
    );
    process.exit(1);
  }

  const dir = mkdtempSync(join(tmpdir(), "ui-copy-"));
  const file = join(dir, "ui-copy.txt");
  writeFileSync(file, dump(items), "utf8");

  const editorEnv = process.env.VISUAL || process.env.EDITOR || "vi";
  // Allow `EDITOR="cursor --wait"` or similar.
  const [cmd, ...rest] = editorEnv.split(/\s+/);
  console.log(`Opening ${items.length} UI item(s) in ${editorEnv}…`);
  const r = spawnSync(cmd!, [...rest, file], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("Editor exited non-zero. Aborting.");
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
    process.exit(1);
  }

  const edited = readFileSync(file, "utf8");
  const updates = parse(edited);
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }

  let changed = 0;
  for (const it of items) {
    const u = updates.get(it.id);
    if (!u) continue; // user removed the block
    const changes = diffSummary(it, u);
    if (changes.length === 0) continue;

    console.log(`\n${it.id}`);
    for (const c of changes) console.log(`  • ${c}`);

    if (!dryRun) {
      if (u.tag) it._ref.tag = u.tag;
      else delete it._ref.tag;
      if (u.caption) it._ref.caption = u.caption;
      else delete it._ref.caption;
    }
    changed++;
  }

  if (changed === 0) {
    console.log("\nNo changes detected.");
    return;
  }

  if (dryRun) {
    console.log(`\n[dry-run] Would update ${changed} item(s). No file written.`);
    return;
  }

  writeFileSync(RESUME_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`\n✓ Wrote ${changed} update(s) to ${RESUME_PATH}.`);
  console.log("  Run `bun run typecheck && bun run build` to verify.");
}

main();
