/** Restore email spacer paragraphs to Tiptap's empty-paragraph representation. */
export function rehydrateEmailEditorHtml(html: string): string {
  // A standalone <br> keeps an empty paragraph visible in email clients. In
  // Tiptap it becomes a hardBreak plus a trailingBreak, doubling its height.
  return html.replace(/(<p\b[^>]*>)\s*<br\s*\/?>\s*(<\/p>)/gi, (match, opening, closing) => {
    // A user can explicitly insert Shift+Enter into an empty paragraph. Keep
    // that authored hard break, distinguished from our email-only spacer.
    if (/\bdata-email-hard-break=["']true["']/i.test(opening)) {
      return match.replace(/\s+data-email-hard-break=["']true["']/i, "");
    }
    return opening + closing;
  });
}

/** Preserve each authored newline when a legacy plain-text email is opened. */
export function plainTextToEmailEditorHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\r\n|\r|\n/)
    .map((line) => `<p>${line}</p>`)
    .join("");
}

/** Make saved/preview HTML render with the same paragraph spacing as the editor. */
export function normalizeEmailEditorHtml(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll("p").forEach((paragraph) => {
    // Email clients have default paragraph margins; the editor has none.
    paragraph.style.margin = "0";
    if (!paragraph.hasChildNodes() || /^(\s|&nbsp;|&#160;)*$/i.test(paragraph.innerHTML)) {
      paragraph.innerHTML = "<br>";
    } else if (/^\s*<br\s*\/?>\s*$/i.test(paragraph.innerHTML)) {
      paragraph.dataset.emailHardBreak = "true";
    }
  });
  return container.innerHTML;
}
