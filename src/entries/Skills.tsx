import { Fragment, useContext } from 'react';
import { ModeContext, visible, pickText, isArchived as isArchivedItem } from '../utils/mode';
import {
  AddButton, EDIT_ENABLED, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import type { SkillSet } from '../types';
import s from './Skills.module.css';

const SKILL_LABELS = {
  domains: 'Domains',
  stack: 'Stack',
  force_multipliers: 'Force Multipliers',
} satisfies Record<keyof SkillSet, string>;
const SKILL_ORDER: (keyof SkillSet)[] = ['domains', 'stack', 'force_multipliers'];

interface SkillsProps {
  skills: SkillSet;
  path?: string;
}

export function Skills({ skills, path }: SkillsProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  return (
    <dl className={s.skillsGrid}>
      {SKILL_ORDER.map((k) => {
        const list = skills[k] ?? [];
        const renderable = list
          .map((item, i) => ({ item, i }))
          .filter(({ item }) => editActive || visible(item, mode));
        const showAdd = editActive && !!path;
        // Skip rendering when there's nothing to show AND no add affordance.
        if (renderable.length === 0 && !showAdd) return null;
        const skillPath = path ? joinPath(path, k) : '';
        return (
          <Fragment key={k}>
            <dt>{SKILL_LABELS[k]}</dt>
            <dd>
              {editActive && path ? (
                // In edit mode each skill item gets its own chip + note,
                // so we render them as inline tokens instead of a comma-
                // joined string. The visual register still reads as a
                // sentence at a glance.
                <>
                  {renderable.map(({ item, i }, j) => {
                    const itemPath = joinPath(path, k, i);
                    const archived = isArchivedItem(item);
                    const text = pickText(item, mode);
                    return (
                      <span
                        key={i}
                        data-archived={archived || undefined}
                        style={{ display: 'inline-block', marginRight: 6 }}
                      >
                        {text}
                        <VisibilityChip path={itemPath} />
                        <NoteBubble path={itemPath} />
                        {j < renderable.length - 1 && ', '}
                      </span>
                    );
                  })}
                  {showAdd && skillPath && (
                    <AddButton
                      path={skillPath}
                      template={{ text: 'New skill' }}
                      label="+ add skill"
                    />
                  )}
                </>
              ) : (
                renderable.map(({ item }) => pickText(item, mode)).join(', ')
              )}
            </dd>
          </Fragment>
        );
      })}
    </dl>
  );
}
