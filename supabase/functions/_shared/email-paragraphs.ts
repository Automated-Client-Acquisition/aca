/** Compact legacy reply paragraphs without adding breaks or losing block styles. */
export function flattenReplyParagraphs(html: string): string {
  if (!html || !/<p[\s>]/i.test(html)) return html;

  const paragraphs: string[] = [];
  const paragraphRe = /<p([^>]*)>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  let cursor = 0;

  while ((match = paragraphRe.exec(html))) {
    // Keep mixed markup and styled paragraphs intact. The shared editor now
    // writes margin:0 itself; flattening would discard alignment and spacing.
    if (html.slice(cursor, match.index).trim() || match[1].trim()) return html;
    const content = match[2];
    paragraphs.push(/^(?:\s|&nbsp;|&#160;)*(?:<br\s*\/?>)?(?:\s|&nbsp;|&#160;)*$/i.test(content) ? "" : content);
    cursor = paragraphRe.lastIndex;
  }
  if (html.slice(cursor).trim() || paragraphs.length === 0) return html;

  // Each paragraph boundary is one line break; an empty paragraph supplies
  // the second break for an authored blank line.
  return paragraphs.join("<br>");
}
