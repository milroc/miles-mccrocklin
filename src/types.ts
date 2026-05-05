// Shared data shapes for the resume site.
// All content lives in data/resume.json — there's no global media pool.
// Media attaches inline to whichever entry it belongs to.

// ----- Mode + visibility ----------------------------------------------

export type Mode = 'interactive' | 'text' | '1pager';

// Where this item shows up. Replaces the legacy numeric `priority` /
// `omit` pair on every renderable node.
//   all         → interactive + text + 1pager
//   not_1pager  → interactive + text  (DEFAULT — applied when missing)
//   1pager_only → 1pager only
//   archived    → never rendered (kept in the JSON as history)
export type Visibility = 'all' | 'not_1pager' | '1pager_only' | 'archived';

export type RichText = string | { text: string; short?: string; visibility?: Visibility };

// ----- Media (formerly photos.json + uis.json + per-entry slots) -------

export type MediaType = 'image' | 'video' | 'embed';
export type MediaLayout = 'stack' | 'strip' | 'carousel' | 'grid';

export interface MediaItem {
  id: string;
  type: MediaType;
  src: string;
  caption?: string;
  tag?: string;
  aspect?: number;
  poster?: string;
  priority?: number;
  span?: { col?: number; row?: number };
}

export interface MediaGroup {
  layout: MediaLayout;
  // `align` and `size` apply when layout is 'stack' (marginalia float).
  align?: 'left' | 'right';
  size?: 'sm' | 'md' | 'lg';
  items: MediaItem[];
}

// ----- Lightbox plumbing ----------------------------------------------

export interface MediaContextValue {
  open: (scope: MediaItem[], id: string) => void;
}

// ----- Resume top-level -----------------------------------------------

export interface Contact {
  name: string;
  address: string;
  website: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  twitter: string;
  instagram?: string;
  threads?: string;
}

export interface Achievement {
  text: string;
  short?: string;
  visibility?: Visibility;
}

export interface ProjectMetrics {
  commits?: number;
  lines_added?: number;
  lines_removed?: number;
  private_repos?: number;
  methodology?: string;
}

export interface Project {
  name: string;
  repo?: string;
  url?: string;
  visibility?: Visibility;
  description: string | { text: string };
  stack?: string[];
  metrics?: ProjectMetrics;
}

export interface Track {
  period: string;
  focus: string;
  visibility?: Visibility;
  tagline?: string;
  summary?: string;
  summary_1pager?: string;
  metrics?: ProjectMetrics;
  toolchains?: string[];
  achievements?: Achievement[];
  projects?: Project[];
  // Inline media for this track (e.g., the Travel carousel).
  media?: MediaGroup;
  // Inline reviews block (e.g., the Real Estate Airbnb testimonials).
  reviews?: ReviewsData;
}

export interface Era {
  period: string;
  focus: string;
  role?: string;
  visibility?: Visibility;
  achievements?: Achievement[];
  // Inline media for this era (e.g., Forecast UIs, Pro Mode hero).
  media?: MediaGroup;
}

export interface Job {
  company: string;
  shortened_title?: string;
  role: string;
  location?: string;
  start_date: string;
  end_date: string;
  visibility?: Visibility;
  summary?: string;
  achievements?: (Achievement | string)[];
  tracks?: Track[];
  eras?: Era[];
  inline?: boolean;
  // Inline media at the job level (e.g., Bluenose UIs).
  media?: MediaGroup;
}

export interface School {
  institution: string;
  degree: string;
  degree_short?: string;
  location?: string;
  start_date: string;
  end_date: string;
  visibility?: Visibility;
  details?: Achievement[];
}

export interface SkillSet {
  domains?: (Achievement | string)[];
  stack?: (Achievement | string)[];
  force_multipliers?: (Achievement | string)[];
}

export interface CommunityEntry {
  group: string;
  role: string;
  start_date: string;
  end_date: string;
  visibility?: Visibility;
  details?: string | { text: string };
  // Inline media for this community entry (talks, photos, etc.).
  media?: MediaGroup;
}

// Redaction registry — Greek-letter variables that stand in for figures
// intentionally withheld from the public resume. Each entry powers two
// surfaces: the inline anchor + tooltip in running prose (KPText) and
// the Notes section at the end of the resume (RedactionNotes).
export interface Redaction {
  // DOM-safe anchor name. The inline glyph renders as
  // `<a href="#note-{id}">` and the matching footnote `<dt>` carries
  // `id="note-{id}"`. Use lowercase Greek letter names ("alpha", etc).
  id: string;
  // The actual character that appears in resume.json prose. Kept
  // narrow on purpose — KPText scans for `[αβγδεζηθ]` only.
  glyph: string;
  // Short context string. Shown in the hover tooltip (desktop) and the
  // Notes section (everywhere). Should describe what the variable
  // represents without revealing the specific numeric value.
  context: string;
}

export interface Resume {
  contact_information: Contact;
  summary: string;
  // Top-level summary gallery (was the `summary-gallery` slot).
  summary_media?: MediaGroup;
  experience: Job[];
  education: School[];
  skills: SkillSet;
  community_organization: CommunityEntry[];
  redactions?: Redaction[];
}

// ----- Reviews (Airbnb testimonials) ----------------------------------

export interface Review {
  reviewer: string;
  location: string;
  rating: number;
  date: string;
  stay_type?: string;
  review: string;
  translation?: string;
  // Phrases to mark inside the original-language `review`. Substrings,
  // case-insensitive, must appear verbatim in the source text.
  host_highlights?: string[];
  // Phrases to mark inside `translation` when the user toggles to English.
  // Authored separately because translated text rarely contains the same
  // strings as the original-language source. Falls back to no highlights
  // if missing on a translated review.
  translation_highlights?: string[];
}

export interface ReviewsData {
  listing: string;
  listing_url?: string;
  host: string;
  overall_rating: number;
  total_reviews: string;
  best_host_reviews: Review[];
  recurring_host_praise_themes?: string[];
}
