/**
 * Candidate trend terms from a post: what a burst detector can count.
 *
 *   named things  "JEV", "Claude Code", "Opus 5.5", "GPT-6", "OpenAI"
 *   hashtags      "#buildinpublic"
 *   phrases       lowercase bigrams like "cold email", "context window"
 *
 * Deliberately cheap (regex, no LLM): it runs on every fresh post every 30 min.
 * Noise is expected — the scorer only surfaces a term when several distinct
 * authors use it at a rate far above its own baseline.
 */

const STOPWORDS = new Set(
  `a about above after again against all almost also am an and any are aren't as at be because been before being
  below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each
  few for from further get gets got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers
  herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let's me more most
  mustn't my myself no nor not now of off on once only or other ought our ours ourselves out over own same shan't she
  she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there
  there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd
  we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with
  won't would wouldn't you you'd you'll you're you've your yours yourself yourselves
  amp rt via https http www com new today yesterday tomorrow week month year day days time times people thing things
  way ways lot lots really actually still even much many every always never ever back first last next one two three
  make makes made making know knows think thought want wants need needs use used using see say says said go going
  gonna got look looks like likes love good great best better bad big small little right left sure yes yeah okay ok
  here's there's today's just thanks thank please also well though via based via per etc vs will can may might
  post posts thread tweet tweets video videos link comment comments reply replies follow share read watch check free
  join subscribe discover guide code pro learn click download sign signup register grab access dm bio tutorial course
  playlist chapter chapters timestamps sponsor sponsored newsletter community template templates tips tip`
    .split(/\s+/)
    .filter(Boolean),
);

// Capitalised words that are just sentence starters or UI noise, not entities.
const COMMON_CAPS = new Set(
  `I The A An As At In On Of To For With By From Is Are Was Be Do Did Can Will This That These Those It Its We You They He She My Our Your Their If When What Why How Who Where Here There
  And But Or So Not No Yes Just Also Then Now New Today Tomorrow Yesterday Monday Tuesday Wednesday Thursday Friday
  Saturday Sunday January February March April May June July August September October November December Breaking
  Thread Update PSA TIL IMO IMHO LOL OMG`
    .split(/\s+/)
    .filter(Boolean),
);

// Words that commonly open a sentence with a capital but aren't names. Anything
// else that slips through is harmless: an everyday word has a high baseline, so
// the burst math never surfaces it.
const SENTENCE_STARTERS = new Set(
  `stop most everyone everybody nobody every some many built here's just please imagine remember reminder hot big
  quick let's before after still only never always great good excited happy honestly unpopular hard real most
  everything nothing something anyone someone ever finally another again every both either none few several
  been being seeing getting looking trying working building running starting stopped started`
    .split(/\s+/)
    .filter(Boolean),
);

// Source boilerplate that shows up in every post of a kind ("Show HN: ...").
const BOILERPLATE = new Set(['show hn', 'ask hn', 'tell hn', 'launch hn', 'hn', 'til', 'eli5', 'psa']);

const TOKEN_RE = /[#@$]?[\p{L}\p{N}][\p{L}\p{N}'’._+-]*/gu;

const isVersion = (t: string) => /^v?\d+(\.\d+)*[a-z]?$/i.test(t);
const isEntityToken = (t: string) =>
  /^[A-Z][A-Za-z0-9]*(?:[-.+][A-Za-z0-9]+)*$/.test(t) || // Capitalised / CamelCase / GPT-6
  /^[A-Z0-9]{2,}(?:[-.][A-Z0-9]+)*$/.test(t) || // acronyms like JEV, LLM
  /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(t); // iPhone, eBay, gRPC

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Hacker News comments arrive as HTML: "&#x2F;" is a slash, not a "#x2F" hashtag. */
function decodeHtml(s: string): string {
  if (!s.includes('&') && !s.includes('<')) return s;
  return s
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

function clean(token: string): string {
  return token.replace(/^[._+'’-]+|[._+'’-]+$/g, '').replace(/[’]/g, "'");
}

export interface ExtractedTerms {
  /** lowercase keys, deduped, capped */
  terms: string[];
  /** key → original casing for display */
  display: Record<string, string>;
}

/** @param excluded lowercase terms/words never to emit */
export function extractTerms(text: string, excluded: Set<string> = new Set(), max = 25): ExtractedTerms {
  const display: Record<string, string> = {};
  const out = new Set<string>();
  const add = (raw: string) => {
    const key = raw.toLowerCase();
    if (key.length < 2 || key.length > 60 || excluded.has(key) || BOILERPLATE.has(key) || out.size >= max) return;
    out.add(key);
    if (!display[key]) display[key] = raw;
  };

  const withoutUrls = decodeHtml(text || '').replace(/https?:\/\/\S+/g, ' ');
  // Split into sentences so capitalised sentence starters aren't glued to the previous sentence
  for (const sentence of withoutUrls.split(/(?<=[.!?:;\n])\s+|\n+/)) {
    const tokens = (sentence.match(TOKEN_RE) || []).map(clean).filter(Boolean);

    // 1. hashtags
    for (const t of tokens) if (t.startsWith('#') && /^#[A-Za-z]\w{2,40}$/.test(t)) add(t);

    // 2. named things: runs of entity tokens, optionally followed by version numbers
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      // Possessives end a name: "Meta's Muse" is Meta + Muse, not one term
      // (otherwise "Muse" only counts where it appears alone).
      const possessive = /'s$/i;
      if (possessive.test(t)) {
        const owner = t.replace(possessive, '');
        if (isEntityToken(owner) && !COMMON_CAPS.has(owner) && !STOPWORDS.has(owner.toLowerCase())) add(owner);
        continue;
      }
      if (/^[#@$]/.test(t) || !isEntityToken(t)) continue;
      const run = [t];
      let j = i + 1;
      while (j < tokens.length && run.length < 3 && (isEntityToken(tokens[j]) || (isVersion(tokens[j]) && run.length >= 1))) {
        if (/^[#@$]/.test(tokens[j])) break;
        if (possessive.test(tokens[j])) break;
        run.push(tokens[j]);
        j++;
      }
      // drop leading sentence-starter noise ("The", "This", ...)
      while (run.length && COMMON_CAPS.has(run[0])) run.shift();
      if (run.length === 0) continue;
      const phrase = run.join(' ');
      const single = run.length === 1 ? run[0] : null;
      if (single && (STOPWORDS.has(single.toLowerCase()) || /^\d/.test(single))) continue;
      // a lone Capitalised word opening a sentence is often just a word ("Stop", "Most")
      if (single && i === 0 && /^[A-Z][a-z]+$/.test(single) && SENTENCE_STARTERS.has(single.toLowerCase())) continue;
      add(phrase);
      // Roll versioned names up into their family so variants add up instead of
      // splitting the count: "GPT-6 Sol" → "GPT-6", "Gemini 3 Pro" → "Gemini 3" + "Gemini",
      // "Claude Opus 5.5" → "Claude Opus", "Grok 4.7" → "Grok".
      if (run.length > 1) {
        const v = run.findIndex((tok, k) => isVersion(tok) || (/\d/.test(tok) && /[A-Za-z]/.test(tok) && k === 0));
        if (v >= 0) {
          if (v < run.length - 1) add(run.slice(0, v + 1).join(' ')); // family incl. version
          if (v > 0) add(run.slice(0, v).join(' ')); // brand without version
        }
      }
      i = j - 1;
    }

    // 3. phrases: lowercase content bigrams
    const words = tokens
      .filter((t) => !/^[#@$]/.test(t))
      .map((t) => t.toLowerCase().replace(/'s$/, ''))
      .filter((w) => /^[a-z][a-z0-9'-]{2,}$/.test(w) && !STOPWORDS.has(w));
    for (let k = 0; k + 1 < words.length; k++) {
      if (words[k] === words[k + 1]) continue;
      if (excluded.has(words[k]) && excluded.has(words[k + 1])) continue;
      add(`${words[k]} ${words[k + 1]}`);
    }
  }

  return { terms: [...out], display };
}
