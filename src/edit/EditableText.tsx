// Wraps a single string field. When edit is active, the wrapping element
// becomes contentEditable and writes its text content back as an `edit`
// change record on blur. Conditional-assignment + literal flag → DCE in
// prod.
import { useEffect, useRef } from 'react';
import { EDIT_ENABLED } from './edit';
import { useEdit } from './EditContext';
import s from './edit.module.css';

interface EditableTextProps {
  // JSON-pointer to the string this element edits, e.g.
  // "/experience/0/achievements/2/text".
  path: string;
  // Current rendered value — comes from displayResume in edit mode.
  value: string;
}

// Both branches return a fragment rather than the bare string: a
// component's contract is JSX, and React renders `<>{value}</>` to the
// same text node with no wrapper element.
const Passthrough = ({ value }: EditableTextProps): JSX.Element => <>{value}</>;

function Editable({ path, value }: EditableTextProps) {
  const { active, pushEdit } = useEdit();
  const ref = useRef<HTMLSpanElement | null>(null);

  // Sync DOM text → React state on the next external value change.
  // Skip while focused so we don't fight the user's caret.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  if (!active) return <>{value}</>;

  return (
    <span
      ref={ref}
      className={s.editable}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onBlur={(e) => {
        const next = e.currentTarget.textContent ?? '';
        if (next !== value) pushEdit(path, next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
      }}
    />
  );
}

export const EditableText = (EDIT_ENABLED ? Editable : Passthrough) as React.FC<EditableTextProps>;
