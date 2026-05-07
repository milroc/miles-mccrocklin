import type { JSX } from 'react';
import { Highlight, Prism, themes as prismThemes } from 'prism-react-renderer';
import s from './CodeChips.module.css';

// Clojure isn't in prism-react-renderer's built-in language selection.
// Register the grammar directly on the shared Prism instance — works
// because prism-react-renderer uses this same `Prism` for tokenization.
// Source: prismjs/components/prism-clojure.js (jeluard/prism-clojure).
Prism.languages.clojure = {
  comment: { pattern: /;.*/, greedy: true },
  string: { pattern: /"(?:[^"\\]|\\.)*"/, greedy: true },
  char: /\\\w+/,
  symbol: {
    pattern: /(^|[\s()\[\]{},])::?[\w*+!?'<>=/.-]+/,
    lookbehind: true,
  },
  keyword: {
    pattern:
      /(\()(?:-|->|->>|\.|\.\.|\*|\/|\+|<|<=|=|==|>|>=|and|apply|assoc|cond|conj|cons|def|def-|defmacro|defmethod|defmulti|defn|defn-|defonce|defprotocol|defrecord|defstruct|deftype|do|doseq|dotimes|doto|filter|first|fn|for|if|if-let|if-not|let|loop|map|mapcat|merge|next|not|or|partial|range|recur|reduce|ref|reset!|rest|return|second|seq|set!|str|swap!|when|when-let|when-not|while|with-meta|with-open)(?=[\s)]|$)/,
    lookbehind: true,
  },
  boolean: /\b(?:false|nil|true)\b/,
  number: {
    pattern: /(^|[^\w$@])(?:\d+(?:[/.]\d+)?(?:e[+-]?\d+)?|0x[a-f0-9]+|[1-9]\d?r[a-z0-9]+)[lmn]?(?![\w$@])/i,
    lookbehind: true,
  },
  function: {
    pattern: /((?:^|[^'])\()[\w*+!?'<>=/.-]+(?=[\s)]|$)/,
    lookbehind: true,
  },
  operator: /[#@^`~]/,
  punctuation: /[{}\[\](),]/,
};

// Editorial dark theme — canvas-context palette from DESIGN.md, expanded
// with three earth-tone accent hues so syntax categories stop collapsing
// onto cream. All hues desaturated, all in the same letterpress-editorial
// register the rest of the site lives in.
//
//   neutrals (cream family):
//     #ece9e2  canvas-fg-strong  — plain, functions, types, tags
//     #b8b5ad  canvas-fg          — punctuation, operators
//     #7a7770  canvas-fg-muted    — comments (italic)
//
//   accents (warm / cool / warm triangle):
//     #86b896  forest mint        — strings, attr-values   (literal data)
//     #c9a464  editorial gold     — keywords, atrules      (declarations)
//     #b8835c  muted rust         — numbers, booleans      (numeric values)
//
// Forest mint is the dark-mode sibling of the resume's forest-green accent
// (#3a6b4a). Muted rust is intentionally adjacent to the Claude orange
// (#cb6f55) used by the Terminal panel below — desaturated further so they
// rhyme tonally without doubling as the same color.
void prismThemes;
const editorialDarkTheme = {
  plain: {
    color: '#ece9e2',
    backgroundColor: 'transparent',
  },
  styles: [
    // Comments — muted cream, italic.
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: { color: '#7a7770', fontStyle: 'italic' as const },
    },

    // Punctuation, operators, connective tissue — secondary cream.
    {
      types: ['punctuation', 'operator', 'entity', 'url'],
      style: { color: '#b8b5ad' },
    },

    // Numbers, booleans — muted rust. "Numeric values" gets its own hue.
    {
      types: ['number', 'boolean'],
      style: { color: '#b8835c' },
    },

    // Strings, attr-values, char literals — forest mint. "Literal data".
    {
      types: ['string', 'char', 'attr-value', 'inserted', 'regex', 'important'],
      style: { color: '#86b896' },
    },

    // Selectors and attr-name read as references to literal data — same mint.
    {
      types: ['selector', 'attr-name'],
      style: { color: '#86b896' },
    },

    // Keywords, atrules — editorial gold, semibold. Control flow + declarations.
    {
      types: ['keyword', 'atrule'],
      style: { color: '#c9a464', fontWeight: '600' as const },
    },

    // Built-ins (Image, Promise, GraphQLObjectType-as-builtin) — gold but
    // medium weight, so they read as "framework keywords" without competing
    // with true keywords for visual emphasis.
    {
      types: ['builtin'],
      style: { color: '#c9a464', fontWeight: '500' as const },
    },

    // Functions, class names, types, tags, properties, symbols — cream
    // identifiers. Weight 500 distinguishes them from plain text.
    {
      types: [
        'function',
        'class-name',
        'tag',
        'property',
        'constant',
        'symbol',
        'deleted',
      ],
      style: { color: '#ece9e2', fontWeight: '500' as const },
    },

    // Variables — plain cream, no extra weight (they ARE the plain text).
    {
      types: ['variable'],
      style: { color: '#ece9e2' },
    },
  ],
};

interface Chip {
  id: 'react' | 'react-native' | 'd3' | 'clojure' | 'graphql' | 'sql';
  /** Filename shown in the editor tab bar — implies the language. */
  filename: string;
  /** Prism language id used for tokenization. */
  language: string;
  /** Raw source — passed through Prism for syntax highlighting. */
  code: string;
  delayMs: number;
  featured?: boolean;
}

const REACT_CODE = `// measure native aspect on load
function useImage(src) {
  const [r, set] = useState(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => set(
      img.naturalWidth /
      img.naturalHeight
    );
    img.src = src;
  }, [src]);
  return r;
}`;

const REACT_NATIVE_CODE = `const Circle = ({ r, x, y }) => (
  <View style={{
    position: 'absolute',
    width: 2 * r, height: 2 * r,
    borderRadius: r,
    top: y - r, left: x - r,
  }} />
);`;

const D3_CODE = `// enter / update / exit
chart.selectAll('rect')
    .data(data)
  .enter().append('rect')
    .attr('x', (d, i) => x(i))
    .attr('width', w);`;

const CLOJURE_CODE = `;; greedy row pack
(defn pack-rows [xs w t]
  (->> xs
       (reduce close-when-full
               {:row [] :sum 0 :rows []})
       :rows))`;

const GRAPHQL_CODE = `const Query = new GraphQLObjectType({
  name: 'Query',
  description: 'root of our app',
  fields: () => ({ people, posts }),
});`;

const SQL_CODE = `create policy "Users read own"
  on conversations for select
  using (
    (select auth.uid()) = user_id
  );`;

const CHIPS: ReadonlyArray<Chip> = [
  { id: 'react', filename: 'Masonry.tsx', language: 'tsx', code: REACT_CODE, delayMs: 0, featured: true },
  { id: 'react-native', filename: 'Circle.ios.js', language: 'jsx', code: REACT_NATIVE_CODE, delayMs: 40 },
  { id: 'd3', filename: 'bar_chart.js', language: 'javascript', code: D3_CODE, delayMs: 80 },
  { id: 'clojure', filename: 'pack.clj', language: 'clojure', code: CLOJURE_CODE, delayMs: 120 },
  { id: 'graphql', filename: 'schema.js', language: 'javascript', code: GRAPHQL_CODE, delayMs: 160 },
  { id: 'sql', filename: '001_initial.sql', language: 'sql', code: SQL_CODE, delayMs: 200 },
];

export function CodeChips(): JSX.Element {
  return (
    <div className={s.layer} aria-hidden="true">
      {CHIPS.map((chip) => {
        const cls = chip.featured ? `${s.chip} ${s.featured}` : s.chip;
        return (
          <div
            key={chip.id}
            data-id={chip.id}
            className={cls}
            style={{ transitionDelay: `${chip.delayMs}ms` }}
          >
            <div className={s.tabBar}>
              <span className={s.filename}>{chip.filename}</span>
            </div>
            <Highlight code={chip.code} language={chip.language} theme={editorialDarkTheme}>
              {({ tokens, getTokenProps }) => (
                <pre className={s.body}>
                  {tokens.map((line, i) => (
                    <span key={i} className={s.line}>
                      <span className={s.ln}>{i + 1}</span>
                      <span className={s.code}>
                        {line.map((token, j) => {
                          const { key: _tk, className: _tc, ...rest } = getTokenProps({ token });
                          return <span key={j} {...rest} />;
                        })}
                      </span>
                    </span>
                  ))}
                </pre>
              )}
            </Highlight>
          </div>
        );
      })}
    </div>
  );
}
