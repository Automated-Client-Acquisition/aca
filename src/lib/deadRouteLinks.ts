import deadRoutes from "@/data/deadRoutes.json";

const MAP = deadRoutes as Record<string, string>;
const LINK = /(href=\\?["'])((?:https:\/\/www\.automatedclientacquisition\.com)?)(\/(?:solutions|product|docs|contact|customers|templates)(?:\/[a-z0-9/-]*)?)(\\?["'#?])/g;

function target(path: string): string | undefined {
  const p = path.replace(/\/+$/, "");
  if (MAP[p]) return MAP[p];
  if (p.startsWith("/solutions") || p.startsWith("/product")) return "/pricing";
  if (p.startsWith("/docs")) return "/developers";
  return undefined;
}

/**
 * Old content (notably posts stored in the blog_posts table) links to routes that
 * never had a page. vercel.json redirects them, but pointing links straight at the
 * live page saves crawlers and readers a hop. Same map as the redirects.
 */
export function fixDeadRouteLinks(html: string): string {
  return html.replace(LINK, (whole, open, host, path, close) => {
    const to = target(path);
    return to ? `${open}${host}${to}${close}` : whole;
  });
}
