// Public surface of the edit module. Production tree-shakes everything
// because EDIT_ENABLED is `false` and the gate inside each component
// short-circuits before the heavy code runs.
export { EDIT_ENABLED } from './edit';
export { EditProvider, useEdit } from './EditContext';
export { EditToolbar } from './EditToolbar';
export { EditableText } from './EditableText';
export { VisibilityChip } from './VisibilityChip';
export { NoteBubble } from './NoteBubble';
export { HighLevelFeedback } from './HighLevelFeedback';
export { AddButton } from './AddButton';
export { joinPath } from './path';
