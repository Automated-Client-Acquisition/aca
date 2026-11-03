export const SNIPPET_VARIABLES = [
  { token: "{{first_name}}", label: "First name" },
  { token: "{{last_name}}", label: "Last name" },
  { token: "{{full_name}}", label: "Full name" },
  { token: "{{company}}", label: "Company" },
] as const;

interface SnippetContact {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  company?: string | null;
}

/** Replace {{variables}} with the contact's values; unknown/empty ones resolve to "". */
export function resolveSnippetVariables(
  content: string,
  contact?: SnippetContact | null,
  opts?: { html?: boolean }
): string {
  const first = contact?.first_name || contact?.display_name?.split(" ")[0] || "";
  const last = contact?.last_name || "";
  const full = contact?.display_name || [first, last].filter(Boolean).join(" ");
  const values: Record<string, string> = {
    first_name: first,
    last_name: last,
    full_name: full,
    company: contact?.company || "",
  };
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
    key in values ? (opts?.html ? escapeHtml(values[key]) : values[key]) : m
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain-text snippet -> HTML paragraphs (blank line = new paragraph, newline = <br>). */
export function snippetToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Snippets authored in the rich editor are stored as HTML; older ones are plain text. */
export function snippetIsHtml(content: string): boolean {
  return /<(br|p|div|ul|ol|li|a|strong|em|b|i|u|span|h[1-6]|blockquote)[\s/>]/i.test(content);
}

/** HTML snippet -> readable plain text for channels that can't render HTML. */
export function snippetToPlainText(content: string): string {
  if (!snippetIsHtml(content)) return content;
  const el = document.createElement("div");
  el.innerHTML = content;
  el.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href && a.textContent?.trim() !== href) a.textContent = `${a.textContent} (${href})`;
  });
  el.querySelectorAll("li").forEach((li) => li.insertAdjacentText("afterbegin", "- "));
  el.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  el.querySelectorAll("p, li, div, h1, h2, h3, h4, h5, h6, blockquote").forEach((n) =>
    n.insertAdjacentText("beforeend", "\n")
  );
  return (el.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
