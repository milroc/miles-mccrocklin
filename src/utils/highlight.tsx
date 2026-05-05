import type { ReactNode } from 'react';

export function highlightReview(
  text: string,
  highlights: string[] | undefined,
  className: string,
): ReactNode {
  if (!highlights || !highlights.length) return text;
  const sorted = [...highlights].sort((a, b) => b.length - a.length);
  const escaped = sorted
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  if (!escaped) return text;
  const re = new RegExp(`(${escaped})`, 'ig');
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p)
      ? <mark key={i} className={className}>{p}</mark>
      : p
  );
}
