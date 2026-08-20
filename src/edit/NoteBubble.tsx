// Inline LLM-feedback note. Renders next to each editable item as
// `// <comment-text>` — the leading slashes are static, the comment
// text is a contentEditable span that pushes/replaces a `feedback`
// change record on input. Empty input → clearFeedback so the change
// log doesn't carry blank entries.
//
// Conditional-assignment on the literal EDIT_ENABLED constant →
// `Stub` in prod, `Bubble` declaration unreferenced and DCE'd.
import { useEffect, useRef } from 'react';
import { EDIT_ENABLED } from './edit';
import { useEdit } from './EditContext';
import s from './edit.module.css';

interface NoteBubbleProps {
  path: string;
}

const Stub = (_: NoteBubbleProps): null => null;

function Bubble({ path }: NoteBubbleProps) {
  const { active, changes, pushFeedback, clearFeedback } = useEdit();
  const ref = useRef<HTMLSpanElement | null>(null);
  const existing = changes.find((c) => c.kind === 'feedback' && c.path === path);
  const value = existing && existing.kind === 'feedback' ? existing.value : '';
  const has = value.length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  if (!active) return null;

  return (
    <span className={s.noteRoot}>
      <span className={s.noteSlashes}>{'// '}</span>
      <span
        ref={ref}
        className={`${s.noteInput} ${has ? s.noteInputFilled : ''}`.trim()}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-label={has ? `LLM note for ${path}` : `Add LLM note for ${path}`}
        data-placeholder="add a note"
        onInput={(e) => {
          const next = (e.currentTarget.textContent ?? '').trim();
          if (!next) clearFeedback(path);
          else pushFeedback(path, next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}

export const NoteBubble = EDIT_ENABLED ? Bubble : Stub;
