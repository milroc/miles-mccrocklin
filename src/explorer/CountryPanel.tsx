// CountryPanel — right-edge slide-in (or bottom sheet on mobile) that
// shows photo + album + visit history for a clicked country. Opened
// from Explorer when the globe fires onCountryClick; dismissed via the
// close button, Escape, or by selecting a different country.

import s from './CountryPanel.module.css';
import type { AtlasAlbum, CountrySelection, Visit } from '../splash/Globe';

interface CountryPanelProps {
  selection: CountrySelection;
  onClose: () => void;
}

// Format one visit as a short human string:
//   same month + year         → "Jun 2001"
//   same year, diff months    → "Jun – Sep 2001"
//   diff years                → "Jun 2001 – Sep 2003"
// Long-running spans (USA, lived) collapse to the year range when one
// month is missing. "lived" gets a tag suffix; "visited" stays bare.
function formatVisit(v: Visit): string {
  const sM = v.startMonth, sY = v.startYear, eM = v.endMonth, eY = v.endYear;
  let core: string;
  if (sM && sY && eM && eY) {
    if (sY === eY && sM === eM) core = `${sM} ${sY}`;
    else if (sY === eY) core = `${sM} – ${eM} ${eY}`;
    else core = `${sM} ${sY} – ${eM} ${eY}`;
  } else if (sY && eY) {
    core = sY === eY ? `${sY}` : `${sY} – ${eY}`;
  } else {
    core = `${sY ?? eY ?? ''}`;
  }
  return v.kind === 'lived' ? `${core} (lived)` : core;
}

export function CountryPanel({ selection, onClose }: CountryPanelProps): JSX.Element {
  const { name, entry, visits } = selection;
  // Hero stays the country-level photo (primary album cover when we
  // have one, otherwise the textured globe image). Visited-only
  // countries (no entry) skip the media band entirely.
  const hero =
    entry?.primary_album?.source_image_url
    ?? (entry ? `/${entry.image}` : null);
  // All albums in one flat list — the primary isn't special anymore,
  // it's just the first one. Currently only the primary carries
  // `source_image_url`; others render with a placeholder cover.
  const albums: AtlasAlbum[] = entry
    ? [
        ...(entry.primary_album ? [entry.primary_album] : []),
        ...(entry.secondary_albums ?? []),
      ]
    : [];
  return (
    <aside
      className={s.root}
      role="dialog"
      aria-modal="false"
      aria-label={name}
      // Stop clicks from bubbling to the globe canvas behind the panel.
      onClick={(e) => e.stopPropagation()}
      key={name}
    >
      <button
        type="button"
        className={s.close}
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      <div className={s.scrollArea}>
        {hero ? (
          <div className={s.media}>
            <img src={hero} alt={name} loading="eager" />
          </div>
        ) : null}
        <div className={s.body}>
          <p className={s.kicker}>{name}</p>
          {visits.length > 0 ? (
            <div className={s.visits}>
              <p className={s.sectionLabel}>
                {visits.length > 1 ? `${visits.length} trips` : 'Visited'}
              </p>
              <ul className={s.visitList}>
                {visits.map((v, i) => (
                  <li key={i}>{formatVisit(v)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {albums.length > 0 ? (
            <div className={s.albumsSection}>
              <p className={s.sectionLabel}>
                {albums.length > 1 ? `${albums.length} albums` : 'Album'}
              </p>
              <ul className={s.albums}>
                {albums.map((a) => (
                  <li key={a.url}>
                    <a
                      className={s.album}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className={s.albumCover}>
                        {a.source_image_url ? (
                          <img src={a.source_image_url} alt="" loading="lazy" />
                        ) : null}
                        <span className={s.albumCoverOverlay} aria-hidden="true">
                          <span className={s.albumCoverCta}>View album →</span>
                        </span>
                      </span>
                      <span className={s.albumTitle}>{a.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            // Empty state. Two flavors:
            //   has photo, no album  → the trip was photographed but the
            //                          portfolio album hasn't been
            //                          assembled yet (15 countries today).
            //   no entry at all      → predates the digital archive
            //                          (Bahamas: 2001 trip).
            <div className={s.albumsSection}>
              <p className={s.sectionLabel}>Album</p>
              <p className={s.albumEmpty}>
                {entry
                  ? 'No album archived yet.'
                  : 'Predates the photo archive.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
