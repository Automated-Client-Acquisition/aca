/**
 * Sanitize AI Output
 *
 * Programmatic post-processing to strip common AI writing tells from
 * LLM-generated text before it's shown to users or sent as messages.
 *
 * Used by: ai-reply-drafter, conversation-autopilot, unipile-ai-respond,
 *          icp-scorer, generate-campaign-message, generate-email-sequence
 */

/**
 * Strip AI writing tells from generated text.
 *
 * Handles:
 *  - Em/en dashes → context-aware punctuation (see normalizeDashes)
 *  - Smart/curly quotes → straight quotes
 *  - Unicode ellipsis (…) → three dots
 *  - AI preamble phrases ("Sure!", "Here's...", etc.)
 *  - Trailing sign-offs the AI adds despite instructions
 *  - Excessive whitespace
 */
/**
 * Words that continue the current clause rather than starting a new sentence.
 * After an em dash, these take a comma; anything else takes a full stop, which
 * is what stops "It works — try it" turning into the comma splice
 * "It works, try it".
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

/**
 * Replace em/en dashes with the punctuation a human would have used.
 *
 * An em dash is one of the loudest "an AI wrote this" tells in cold outreach,
 * and models produce them constantly no matter what the prompt says. Blanket
 * replacement with a comma (what this used to do) fixes the tell but leaves
 * comma splices, so the rule is context-aware:
 *
 *   ranges          10—20            → 10-20
 *   compounds       state—of—the—art → state-of-the-art
 *   parentheticals  "Acme — a fintech — is hiring" → commas
 *   continuations   "10 minutes — no setup"        → comma
 *   new clauses     "It works — try it"            → ". Try it"
 *   trailing        "Worth a look —"               → dropped
 */
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

export function sanitizeAIOutput(text: string): string {
  if (!text) return text;

  let result = text.trim();

  // ── Wrapping quotes removal ─────────────────────────────────────
  // LLMs sometimes wrap the entire message in quotes
  result = result.replace(/^["']|["']$/g, '');

  // ── Typography tells ──────────────────────────────────────────────
  // Em/en dashes → the punctuation a person would have typed.
  result = normalizeDashes(result);
  // Smart single quotes → straight
  result = result.replace(/[\u2018\u2019\u201A]/g, "'");
  // Smart double quotes → straight
  result = result.replace(/[\u201C\u201D\u201E]/g, '"');
  // Unicode ellipsis → three dots
  result = result.replace(/\u2026/g, '...');
  // Non-breaking spaces → regular spaces
  result = result.replace(/\u00A0/g, ' ');

  // ── AI preamble removal ───────────────────────────────────────────
  // Strip common AI lead-ins at the very start of the text
  result = result.replace(
    /^(Sure!|Sure,|Of course!|Absolutely!|Great question!|Certainly!|Here you go!|Here's?\s+(a |the |my |your )?(draft|reply|response|message|email|opening|DM)[^.!:\n]*[.!:]\s*)/i,
    '',
  );
  result = result.replace(
    /^(I've\s+(drafted|written|prepared|created|put together)[^.!]*[.!:]\s*)/i,
    '',
  );
  result = result.replace(
    /^(I'd\s+be\s+happy\s+to[^.!]*[.!:]\s*)/i,
    '',
  );
  // "Here's the opening DM for X:" and similar
  result = result.replace(
    /^(here'?s?\s+(the\s+)?(opening\s+)?(dm|message|draft|response)\s+(for|to)\s+\w+[^:\n]*:\s*)/i,
    '',
  );
  // "Opening DM for X:" / "Draft message for X:"
  result = result.replace(
    /^((opening|draft)\s+(dm|message)\s+(for|to)\s+\w+[^:\n]*:\s*)/i,
    '',
  );

  // ── Separator + commentary sandwich ─────────────────────────────
  // Pattern: optional preamble + --- + message + --- + commentary
  // Extract just the message between separators

  // First, strip leading/trailing separator lines (left over after preamble removal)
  result = result.replace(/^\s*[-—]{3,}\s*\n*/g, '');
  result = result.replace(/\n*\s*[-—]{3,}\s*$/g, '');

  const lines = result.split('\n');
  const sepIndices: number[] = [];
  lines.forEach((line, i) => {
    if (/^\s*[-—]{3,}\s*$/.test(line) || /^\s*[*]{3,}\s*$/.test(line)) {
      sepIndices.push(i);
    }
  });

  if (sepIndices.length >= 2) {
    const between = lines.slice(sepIndices[0] + 1, sepIndices[1]).join('\n').trim();
    if (between.length > 20) {
      result = between;
    }
  } else if (sepIndices.length === 1) {
    const before = lines.slice(0, sepIndices[0]).join('\n').trim();
    const after = lines.slice(sepIndices[0] + 1).join('\n').trim();
    const afterIsCommentary = /^\*?\*?why\s+(this|it)\s+works/i.test(after) ||
      /^(note|explanation|breakdown|analysis|reasoning)/i.test(after);
    const beforeIsPreamble = /^(here'?s|opening|draft|message for)/i.test(before) || !before;
    if (afterIsCommentary || beforeIsPreamble) {
      result = afterIsCommentary ? before : after;
    }
  }

  // ── Meta-commentary line removal ────────────────────────────────
  // Remove lines that are AI self-analysis, not actual message content
  const metaPatterns = [
    /^\*?\*?why\s+(this|it)\s+works:?\*?\*?$/i,
    /^(note|explanation|breakdown|tips|reasoning|strategy)s?:$/i,
    /^[-•]\s+(references|mirrors|positions|keeps|under\s+\d+\s+char)/i,
  ];
  const cleanLines = result.split('\n').filter(line =>
    !metaPatterns.some(pat => pat.test(line.trim()))
  );
  result = cleanLines.join('\n').trim();

  // ── Markdown formatting removal ─────────────────────────────────
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  // Remove leading "Message:" / "DM:" / "Reply:" labels
  result = result.replace(/^(message|dm|reply|response)\s*:\s*/i, '');

  // ── Trailing sign-off cleanup ─────────────────────────────────────
  // Remove AI-added signatures/sign-offs at the end
  result = result.replace(
    /\n*\s*(Best|Cheers|Regards|Warm regards|Kind regards|Thanks|Thank you|Sincerely|All the best|Talk soon|Looking forward),?\s*\n?\s*(\[?(Your |My )?(Name|Signature|First Name|Full Name|Team)\]?)?\s*$/gi,
    '',
  );
  // Remove placeholder signatures
  result = result.replace(
    /\n*\s*\[?(Your |My )?(Name|Signature|First Name|Full Name)\]?\s*$/gi,
    '',
  );
  result = result.replace(
    /\n*\s*\{\{?\s*signature\s*\}?\}\s*$/gi,
    '',
  );

  // ── Whitespace cleanup ────────────────────────────────────────────
  // Collapse 3+ newlines to 2
  result = result.replace(/\n{3,}/g, '\n\n');
  // Trim leading/trailing whitespace
  result = result.trim();

  // Fix double-comma artifacts from em dash replacement
  result = result.replace(/,\s*,/g, ',');

  return result;
}

/**
 * Sanitize AI output specifically for email bodies (HTML-aware).
 * Handles the same tells plus HTML sign-off patterns.
 */
export function sanitizeAIEmailBody(text: string): string {
  if (!text) return text;

  let result = sanitizeAIOutput(text);

  // HTML sign-off patterns
  result = result.replace(
    /(<br\s*\/?>|\n)*\s*(<div>)?\s*(Best|Cheers|Regards|Warm regards|Kind regards|Thanks|Thank you|Sincerely|All the best|Talk soon),?\s*(<\/div>)?\s*(<br\s*\/?>|\n)*/gi,
    '',
  );
  result = result.replace(
    /(<br\s*\/?>|\n)*\s*(<div>)?\s*\[?(Your |My )?(Name|Signature|First Name|Full Name)\]?\s*(<\/div>)?\s*(<br\s*\/?>|\n)*/gi,
    '',
  );
  result = result.replace(
    /(<br\s*\/?>|\n)*\s*(<div>)?\s*\{\{?\s*signature\s*\}?\}\s*(<\/div>)?\s*(<br\s*\/?>|\n)*/gi,
    '',
  );

  return result.trim();
}
