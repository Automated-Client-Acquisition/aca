import { blogPosts } from "./data/blogPosts";
import { playbooks } from "./data/playbooks";
import { PROFESSIONS } from "./components/marketing/how-we-work/professions";

export interface SitemapRoute {
  path: string;
  /** ISO date. Only set when we know when the page really changed. */
  lastmod?: string;
}

/**
 * Every URL we want indexed. This list drives BOTH sitemap.xml and the
 * build-time prerender (scripts/prerender.mjs), so a URL cannot be advertised
 * without also having real HTML behind it.
 *
 * Only list routes that exist in src/App.tsx. The old list carried ~50 paths
 * (/solutions/*, /product/*, /docs/*, /customers, /templates, /contact) that no
 * route serves; they rendered the NotFound view with a 200 status.
 *
 * `lastmod` is deliberately omitted where there is no real edit date. A build
 * timestamp on every URL teaches crawlers to ignore the field.
 */
export const sitemapRoutes: SitemapRoute[] = [
  { path: "/" },
  { path: "/pricing" },
  { path: "/blog" },
  { path: "/playbooks" },
  { path: "/community" },
  { path: "/how-we-work" },
  ...PROFESSIONS.map((p) => ({ path: `/how-we-work/${p.slug}` })),
  { path: "/tools" },
  { path: "/agents" },
  { path: "/mcp" },
  { path: "/mcp/commands" },
  { path: "/developers" },
  { path: "/signals" },
  { path: "/about/cedric-seguela" },

  // Free lead-magnet landing pages and cold-traffic sales pages
  { path: "/free-hermes-linkedin-setter" },
  { path: "/free-google-maps-scraper" },
  { path: "/free-sec-form4-agent" },
  { path: "/free-buying-signals-agent" },
  { path: "/free-reddit-engagement-agent" },
  { path: "/free-youtube-automation-agent" },
  { path: "/free-seo-growth-agent" },
  { path: "/free-lead-pipeline-agent" },
  { path: "/free-carousel-factory-agent" },
  { path: "/kit" },
  { path: "/studio" },
  { path: "/radar" },

  ...blogPosts.map((post) => ({
    path: `/blog/${post.slug}`,
    lastmod: post.modifiedDate ?? post.publishDate,
  })),

  ...playbooks
    .filter((p) => !p.scaffolded)
    .map((p) => ({
      path: `/playbooks/${p.slug}`,
      lastmod: p.lastUpdated ?? p.datePublished,
    })),
];

/**
 * Pages that get prerendered but stay out of the sitemap: real pages people
 * land on, with nothing to gain from being crawled proactively.
 */
export const extraPrerenderPaths = [
  "/terms",
  "/privacy",
  "/support",
  "/quote",
  "/book",
  ...PROFESSIONS.map((p) => `/quote/${p.slug}`),
];
