// Top-of-resume photo strip below the summary paragraph. Currently a thin
// wrapper around Figure — kept as its own component so the App-level slot
// reads "summary gallery" (semantic), and so the gallery can grow its own
// circular-portrait treatment later without touching every caller.
import { Figure } from './Figure';
import type { MediaGroup } from '../types';

interface SummaryGalleryProps { media?: MediaGroup }

export function SummaryGallery({ media }: SummaryGalleryProps) {
  return <Figure media={media} />;
}
