/**
 * Sanitize AI Output (Node.js port)
 *
 * Mirrors supabase/functions/_shared/sanitize-ai-output.ts
 * Keep in sync when updating the Deno version.
 */

import { normalizeDashes } from './dash-rules.js';

export { normalizeDashes };

export function sanitizeAIOutput(text: string): string {
  if (!text) return text;
  let result = text.trim();

  // Wrapping quotes
  result = result.replace(/^["']|["']$/g, '');

  // Typography tells
  result = normalizeDashes(result);
  result = result.replace(/[\u2018\u2019\u201A]/g, "'");
  result = result.replace(/[\u201C\u201D\u201E]/g, '"');
  result = result.replace(/\u2026/g, '...');
  result = result.replace(/\u00A0/g, ' ');

  // AI preamble removal
  result = result.replace(
    /^(Sure!|Sure,|Of course!|Absolutely!|Great question!|Certainly!|Here you go!|Here's?\s+(a |the |my |your )?(draft|reply|response|message|email|opening|DM)[^.!:\n]*[.!:]\s*)/i, '',
  );
  result = result.replace(/^(I've\s+(drafted|written|prepared|created|put together)[^.!]*[.!:]\s*)/i, '');
  result = result.replace(/^(I'd\s+be\s+happy\s+to[^.!]*[.!:]\s*)/i, '');
  result = result.replace(
    /^(here'?s?\s+(the\s+)?(opening\s+)?(dm|message|draft|response)\s+(for|to)\s+\w+[^:\n]*:\s*)/i, '',
  );
  result = result.replace(
    /^((opening|draft)\s+(dm|message)\s+(for|to)\s+\w+[^:\n]*:\s*)/i, '',
  );

  // Strip leading/trailing separator lines
  result = result.replace(/^\s*[-\u2014]{3,}\s*\n*/g, '');
  result = result.replace(/\n*\s*[-\u2014]{3,}\s*$/g, '');

  // Separator + commentary sandwich
  const lines = result.split('\n');
  const sepIndices: number[] = [];
  lines.forEach((line, i) => {
    if (/^\s*[-\u2014]{3,}\s*$/.test(line) || /^\s*[*]{3,}\s*$/.test(line)) {
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

  // Meta-commentary line removal
  const metaPatterns = [
    /^\*?\*?why\s+(this|it)\s+works:?\*?\*?$/i,
    /^(note|explanation|breakdown|tips|reasoning|strategy)s?:$/i,
    /^[-•]\s+(references|mirrors|positions|keeps|under\s+\d+\s+char)/i,
  ];
  const cleanLines = result.split('\n').filter(line =>
    !metaPatterns.some(pat => pat.test(line.trim()))
  );
  result = cleanLines.join('\n').trim();

  // Markdown formatting removal
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  result = result.replace(/^(message|dm|reply|response)\s*:\s*/i, '');

  // Trailing sign-off cleanup
  result = result.replace(
    /\n*\s*(Best|Cheers|Regards|Warm regards|Kind regards|Thanks|Thank you|Sincerely|All the best|Talk soon|Looking forward),?\s*\n?\s*(\[?(Your |My )?(Name|Signature|First Name|Full Name|Team)\]?)?\s*$/gi, '',
  );
  result = result.replace(/\n*\s*\[?(Your |My )?(Name|Signature|First Name|Full Name)\]?\s*$/gi, '');
  result = result.replace(/\n*\s*\{\{?\s*signature\s*\}?\}\s*$/gi, '');

  // Whitespace cleanup
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();
  result = result.replace(/,\s*,/g, ',');

  return result;
}
