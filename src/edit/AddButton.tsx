// "+ add bullet" / "+ add skill" / "+ add project" affordance for an
// editable array. Pushes one `add` change record per click; the new
// item appears immediately at the end of the array via applyChanges.
//
// `template` is the shape of a freshly-added item. Default placeholders
// are intentional ("New bullet", "New skill") so the user has something
// to click into and overwrite — empty strings render as nothing and are
// hard to discover.
//
// Conditional-assignment on the literal EDIT_ENABLED constant →
// `Stub` in prod, `Add` declaration unreferenced and DCE'd.
import { EDIT_ENABLED } from './edit';
import type { JsonValue } from '../utils/json';
import { useEdit } from './EditContext';
import s from './edit.module.css';

interface AddButtonProps {
  // Path to the array the new item is appended to.
  path: string;
  // The shape of the new item — string or any JSON object the
  // surrounding schema accepts.
  template: JsonValue;
  // Button label (e.g. "+ add bullet").
  label: string;
}

const Stub = (_: AddButtonProps): null => null;

function Add({ path, template, label }: AddButtonProps) {
  const { active, pushAdd } = useEdit();
  if (!active) return null;
  return (
    <button
      type="button"
      className={s.addButton}
      onClick={() => pushAdd(path, template)}
      title={`Append a new item to ${path}`}
    >
      {label}
    </button>
  );
}

export const AddButton = EDIT_ENABLED ? Add : Stub;
