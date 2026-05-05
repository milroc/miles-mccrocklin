// Top-of-page feedback note that targets the resume as a whole rather
// than any specific item. Stored as a `feedback` change record at the
// root JSON-pointer path (`/`) — the prompt's record-kind notes
// explain that root-path feedback is a holistic instruction.
//
// Visually styled as a multi-line C-style block comment (`/* ... */`)
// to read like a high-level intent annotation in source code.
import { useEffect, useRef } from 'react';
import { EDIT_ENABLED } from './edit';
import { useEdit } from './EditContext';
import s from './edit.module.css';

const ROOT_PATH = '/';
const Stub = (): null => null;

function FeedbackBlock() {
  const { active, changes, pushFeedback, clearFeedback } = useEdit();
  const ref = useRef<HTMLDivElement | null>(null);
  const existing = changes.find((c) => c.kind === 'feedback' && c.path === ROOT_PATH);
  const value = existing && existing.kind === 'feedback' ? existing.value : '';

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  if (!active) return null;

  return (
    <aside className={s.blockNote} aria-label="High-level feedback for the LLM">
      <span className={s.blockNoteOpen}>{'/*'}</span>
      <div
        ref={ref}
        className={s.blockNoteContent}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-multiline="true"
        aria-label="High-level feedback"
        data-placeholder="high-level feedback for the LLM…"
        onInput={(e) => {
          const next = (e.currentTarget.textContent ?? '').trim();
          if (!next) clearFeedback(ROOT_PATH);
          else pushFeedback(ROOT_PATH, next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          }
          // Enter inserts a newline (block comments are multi-line).
          // Cmd/Ctrl+Enter blurs to commit.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          }
        }}
      />
      <span className={s.blockNoteClose}>{'*/'}</span>
    </aside>
  );
}

export const HighLevelFeedback = EDIT_ENABLED ? FeedbackBlock : Stub;
