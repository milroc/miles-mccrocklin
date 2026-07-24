// Curator review panel. Only rendered by MasonryWall when ?meta=1 is
// in the URL — shows the classifier output for one photo (story /
// caption / themes / entities / species / country) plus the raw JSON.
import type { PhotographyEntry } from '../types';
import s from './MetaPanel.module.css';

export function MetaPanel({ photo }: { photo: PhotographyEntry }): JSX.Element {
  // Pull a curator-friendly view out of the entry. Story renders on top
  // as italic prose, then the tag/entity lines, then the raw JSON
  // dump for anything else (album_url, featured, graphic, aspect, etc.).
  const tags = (photo.theme ?? []).join(' · ');
  const entities = (photo.entities ?? []).join(' · ');
  return (
    <div className={s.root}>
      {photo.story && <p className={s.story}>{photo.story}</p>}
      {photo.caption && (
        <p className={s.tags}>
          <span className={s.label}>caption</span>
          {photo.caption}
        </p>
      )}
      {tags && (
        <p className={s.tags}>
          <span className={s.label}>themes</span>
          {tags}
        </p>
      )}
      {entities && (
        <p className={s.tags}>
          <span className={s.label}>entities</span>
          {entities}
        </p>
      )}
      {photo.species && (
        <p className={s.tags}>
          <span className={s.label}>species</span>
          {photo.species}
        </p>
      )}
      {photo.country && (
        <p className={s.tags}>
          <span className={s.label}>country</span>
          {photo.country}
        </p>
      )}
      <pre>{JSON.stringify(photo, null, 2)}</pre>
    </div>
  );
}
