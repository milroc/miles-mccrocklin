// SearchBox — free-text filter input for the photography page. State
// lives upstream in Photography.tsx; this component is a controlled
// input that emits `onChange` on every keystroke. The actual filter
// algebra (which fields each token searches against) lives in
// Photography.tsx so the URL-sync + applyFilters stays in one place.

import s from './SearchBox.module.css';

interface SearchBoxProps {
  value: string;
  onChange: (next: string) => void;
}

export function SearchBox({ value, onChange }: SearchBoxProps): JSX.Element {
  const active = value.trim().length > 0;
  return (
    <div className={s.root}>
      <input
        type="search"
        className={`${s.input} ${active ? s.inputActive : ''}`}
        placeholder="Search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search photos"
        autoComplete="off"
        spellCheck={false}
      />
      {active && (
        <button
          type="button"
          className={s.clear}
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}
