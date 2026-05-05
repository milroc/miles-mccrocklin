// Soft-hyphen pre-insertion for resume English.
//
// Inserts U+00AD (soft hyphen) into long words at hand-curated positions so
// the line breaker (vendor/kp.js) has somewhere to break a word that doesn't
// otherwise fit. Liang-style pattern matching is overkill for a resume's
// limited vocabulary; this file is just a small dictionary + a few generic
// suffix rules that catch the common -tion/-ment/-ity tail.
//
// Adding a word that breaks weirdly is a one-line edit to EXCEPTIONS.

const SHY = '­';
const MIN_WORD_LEN = 8;
const MIN_FRAGMENT = 2;

// Hand-tuned splits. Values are character offsets where a soft hyphen
// belongs (offsets count from the start of the lowercased word). Keep
// these conservative: every break point should still feel like a clean
// syllable boundary.
const EXCEPTIONS: Record<string, number[]> = {
  authentication: [6, 8, 10],   // authen-ti-ca-tion
  collaboration:  [3, 6, 9],    // col-lab-ora-tion
  communication:  [3, 7, 9],    // com-muni-ca-tion
  conductor:      [3, 6],       // con-duc-tor
  configuration:  [3, 7, 9],    // con-figu-ra-tion
  conversation:   [3, 8],       // con-versa-tion
  conversations:  [3, 8],
  deduplication:  [2, 4, 7, 9], // de-du-pli-ca-tion
  documentation:  [4, 8],       // docu-menta-tion
  engineer:       [4],          // engi-neer
  engineering:    [4, 8],       // engi-neer-ing
  experimentation:[2, 6, 9, 11],// ex-peri-men-ta-tion
  forecasting:    [4, 8],       // fore-cast-ing
  implementation: [2, 5, 8, 10],// im-ple-men-ta-tion
  infrastructure: [2, 5, 10],   // in-fra-struc-ture
  instrumentation:[6, 10],      // instru-menta-tion
  javascript:     [4],          // java-script
  misinformation: [3, 5, 8, 10],// mis-in-for-ma-tion
  observability:  [5, 10],      // obser-vabil-ity
  operationalize: [4, 9],       // oper-ation-alize
  optimization:   [4, 8],       // opti-miza-tion
  orchestration:  [6, 9],       // orches-tra-tion
  organization:   [5, 8],       // organ-iza-tion
  organizations:  [5, 8],
  productivity:   [3, 6, 9],    // pro-duc-tiv-ity
  recommendation: [3, 5, 10],   // rec-om-menda-tion
  reliability:    [4, 8],       // reli-abil-ity
  scalability:    [4, 8],       // scal-abil-ity
  transformation: [5, 8, 10],   // trans-for-ma-tion
  typescript:     [4],          // type-script
  visualization:  [4, 6, 9],    // visu-al-iza-tion
};

// Generic tail rules: split off a recognizable English suffix when it leaves
// behind a stem of at least MIN_FRAGMENT letters. The order matters — longer
// suffixes are tried first so "ization" beats "ation".
const SUFFIXES = [
  'ization', 'izations', 'isation', 'isations',
  'ically', 'ically',
  'ation', 'ations', 'ition', 'itions',
  'ement', 'ements', 'ment', 'ments',
  'ility', 'ities', 'ity',
  'ously', 'ous',
  'able', 'ible',
  'ical', 'ness',
];

// Generic head rules: split a recognizable Latin/Greek prefix off the front
// when the remaining stem is at least MIN_FRAGMENT letters.
const PREFIXES = [
  'multi', 'over', 'under', 'inter', 'trans',
  'anti', 'semi', 'post', 'auto',
  'pre', 'sub', 'mis', 'dis', 'non',
  're', 'un', 'de', 'in', 'im', 'ex',
];

function splitsForGeneric(lower: string): number[] {
  const positions = new Set<number>();
  for (const pre of PREFIXES) {
    if (lower.startsWith(pre) && lower.length - pre.length >= MIN_FRAGMENT) {
      positions.add(pre.length);
      break; // only the leftmost matching prefix
    }
  }
  for (const suf of SUFFIXES) {
    if (lower.endsWith(suf) && lower.length - suf.length >= MIN_FRAGMENT) {
      positions.add(lower.length - suf.length);
      break;
    }
  }
  return [...positions].sort((a, b) => a - b);
}

// Insert SHY into `word` at the given character positions (preserving case).
// Positions are sorted ascending; positions outside [MIN_FRAGMENT, len-MIN_FRAGMENT]
// are dropped to keep tiny tails from dangling on a line.
function applySplits(word: string, positions: number[]): string {
  if (!positions.length) return word;
  const safe = positions.filter(
    (p) => p >= MIN_FRAGMENT && word.length - p >= MIN_FRAGMENT,
  );
  if (!safe.length) return word;
  let out = '';
  let i = 0;
  for (const p of safe) {
    out += word.slice(i, p) + SHY;
    i = p;
  }
  out += word.slice(i);
  return out;
}

function hyphenateWord(word: string): string {
  if (word.length < MIN_WORD_LEN) return word;
  const lower = word.toLowerCase();
  const exception = EXCEPTIONS[lower];
  if (exception) return applySplits(word, exception);
  return applySplits(word, splitsForGeneric(lower));
}

// Process a paragraph string. Skips short tokens and anything containing
// non-letter characters (slashes, arrows, parentheses, hyphens already
// present), since those carry their own break opportunities.
const WORD_RE = /[A-Za-z][A-Za-z]+/g;

export function hyphenate(text: string): string {
  if (!text) return text;
  return text.replace(WORD_RE, (w) => hyphenateWord(w));
}
