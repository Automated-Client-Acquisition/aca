/**
 * Post-auth return path from a `?next=` parameter.
 *
 * The MCP consent page (/connect/authorize) sends signed-out users to
 * /auth?next=<consent URL>; without honouring it, a Claude or ChatGPT user who
 * signs up lands on onboarding and the connector never finishes. Only
 * same-origin paths are accepted so `next` cannot become an open redirect.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return null; // CR/LF etc.
  }
  try {
    const url = new URL(value, "https://aca.invalid");
    if (url.origin !== "https://aca.invalid") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** The connecting app's display name when `next` is an MCP consent request. */
export function connectingAppName(next: string | null): string | null {
  if (!next?.startsWith("/connect/authorize")) return null;
  const params = new URL(next, "https://aca.invalid").searchParams;
  return params.get("client_name")?.trim() || "your AI assistant";
}
