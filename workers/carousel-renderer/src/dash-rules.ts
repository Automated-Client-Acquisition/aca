/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Port of normalizeDashes() from supabase/functions/_shared/sanitize-ai-output.ts.
 * Regenerate with: node scripts/generate-dash-ports.mjs
 */

const CLAUSE_CONTINUATIONS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'so', 'yet', 'plus',
  'which', 'who', 'whom', 'whose', 'that',
  'with', 'without', 'for', 'from', 'at', 'in', 'on', 'to', 'of', 'by', 'via', 'per',
  'including', 'especially', 'usually', 'mostly', 'often', 'sometimes',
  'not', 'no', 'never', 'nothing', 'just', 'even', 'only', 'also',
  'more', 'less', 'fewer', 'like', 'unlike', 'about', 'around', 'over', 'under',
  'because', 'since', 'while', 'though', 'although', 'unless', 'until',
  'then', 'thanks', 'ideally', 'typically', 'both', 'either', 'neither',
]);

export function normalizeDashes(text: string): string {
  if (!text) return text;
  let out = text;

  // Math minus (U+2212) is never punctuation — always a plain hyphen. Handled
  // first and separately, so "−5 degrees" can't be read as a sentence break.
  out = out.replace(/−/g, '-');

  // "--" and "---" between words are the ASCII stand-in models reach for when
  // told not to use em dashes. Promote to a real dash so the rules below apply.
  // A line that is only dashes is left alone: it is a separator, stripped later.
  out = out.replace(/(?<=\S)[ \t]+-{2,}[ \t]+(?=\S)/g, ' — ');

  // Numeric ranges keep a hyphen: "10—20", "5 – 7 days".
  out = out.replace(/(\d)\s*[—–]\s*(?=\d)/g, '$1-');

  // Compounds with no surrounding whitespace: "state—of—the—art".
  out = out.replace(/([A-Za-z])[—–]([A-Za-z])/g, '$1-$2');

  // Paired parenthetical inside one sentence → commas.
  out = out.replace(
    /\s*[—–]\s*([^—–.!?\n]{1,80}?)\s*[—–]\s*/g,
    (_match, inner: string) => `, ${inner.trim()}, `,
  );

  // Dangling dash before a sentence end, a tag, or the end of the text.
  out = out.replace(/\s*[—–]\s*(?=[.!?<]|$)/g, '');

  // Whatever is left is a single dash mid-sentence.
  out = out.replace(/\s*[—–]\s*(\S+)/g, (_match, nextWord: string) => {
    const bare = nextWord.replace(/^[^A-Za-z0-9']+/, '').toLowerCase().replace(/[^a-z']/g, '');
    if (CLAUSE_CONTINUATIONS.has(bare)) return `, ${nextWord}`;
    return `. ${nextWord.charAt(0).toUpperCase()}${nextWord.slice(1)}`;
  });

  return out;
}
