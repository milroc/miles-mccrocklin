// Floating dev-only toolbar. Toggle · status · Copy LLM · Discard.
// No server-side save — the change list lives in client memory + a
// localStorage backup. The only way out is the Copy LLM prompt, which
// the user pastes into an in-repo agent.
//
// The exported `EditToolbar` is a ternary on the literal `EDIT_ENABLED`
// constant — Bun constant-folds this in prod (`= Stub`) and the heavy
// `Toolbar` declaration becomes statically unreferenced.
import { useState } from 'react';
import { EDIT_ENABLED } from './edit';
import { useEdit } from './EditContext';
import s from './edit.module.css';

const Stub = (): null => null;

function Toolbar() {
  const { active, setActive, changes, dirty, discard, copyPrompt } = useEdit();
  const [copied, setCopied] = useState(false);

  const onCopy = async (): Promise<void> => {
    await copyPrompt();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  // Per-kind change counts so the toolbar is a glanceable status line.
  const counts = changes.reduce(
    (acc, c) => { acc[c.kind] = (acc[c.kind] ?? 0) + 1; return acc; },
    {} as Record<string, number>,
  );
  const summary: string[] = [];
  if (counts.edit) summary.push(`${counts.edit} edit${counts.edit === 1 ? '' : 's'}`);
  if (counts.visibility) summary.push(`${counts.visibility} visibility`);
  if (counts.add) summary.push(`${counts.add} add${counts.add === 1 ? '' : 's'}`);
  if (counts.delete) summary.push(`${counts.delete} delete${counts.delete === 1 ? '' : 's'}`);
  if (counts.feedback) summary.push(`${counts.feedback} note${counts.feedback === 1 ? '' : 's'}`);

  return (
    <div className={s.toolbar} role="toolbar" aria-label="Edit mode">
      <span className={s.badge}>EDIT</span>
      <button
        type="button"
        className={s.button}
        onClick={() => setActive(!active)}
        title="Toggle edit chrome"
      >
        {active ? 'Off' : 'On'}
      </button>
      {active && (
        <>
          <span
            className={dirty ? s.dirty : ''}
            title="Pending change records (client-only, persisted to localStorage)"
          >
            {summary.length ? summary.join(' · ') : '○ no changes'}
          </span>
          <button
            type="button"
            className={`${s.button} ${s.primary}`}
            onClick={onCopy}
            title="Copy an LLM prompt with all pending changes to the clipboard"
          >
            {copied ? 'Copied ✓' : 'Copy LLM'}
          </button>
          <button
            type="button"
            className={s.button}
            onClick={discard}
            disabled={!dirty}
            title="Drop all pending changes (clears localStorage too)"
          >
            Discard
          </button>
        </>
      )}
    </div>
  );
}

export const EditToolbar = EDIT_ENABLED ? Toolbar : Stub;
