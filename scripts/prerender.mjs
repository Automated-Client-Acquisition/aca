#!/usr/bin/env node
/**
 * Build-time prerender. Run after `vite build`:
 *
 *   1. bundle src/entry-prerender.tsx for Node (vite SSR build -> dist-ssr/)
 *   2. render every indexable route to static HTML with its own <title>,
 *      description, canonical, JSON-LD and body text
 *   3. write dist/<route>/index.html  (Vercel serves real files before the SPA
 *      rewrite, so these win over the shell without any routing change)
 *   4. write sitemap.xml from the same route list
 *
 * dist/index.html becomes the prerendered HOME page, so the untouched SPA shell
 * is saved as dist/app-shell.html; vercel.json points the app fallback at it.
 *
 * Failure policy: a route that fails to render is skipped (it keeps working as a
 * client-rendered page) and reported. The build only fails when a critical page
 * fails or more than 2% of routes do, so a single bad post can't block a deploy
 * but a systematic break can't ship silently.
 */
import { build, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const ssrOut = path.join(root, "dist-ssr");
const SITE_URL = "https://www.automatedclientacquisition.com";
const CRITICAL = ["/", "/pricing", "/blog", "/playbooks"];
const MAX_FAILURE_RATE = 0.02;

if (!existsSync(path.join(dist, "index.html"))) {
  console.error("[prerender] dist/index.html not found. Run `vite build` first.");
  process.exit(1);
}

// The Supabase client touches localStorage while it is being constructed.
// Rendering never reads a session, so an inert in-memory store is enough.
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
globalThis.localStorage ??= memoryStorage();
globalThis.sessionStorage ??= memoryStorage();

console.log("[prerender] bundling server entry…");
await build({
  root,
  configFile: false,
  logLevel: "warn",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(root, "src") },
    dedupe: ["mediabunny", "@mediabunny/ac3", "react", "react-dom"],
  },
  ssr: { target: "node" },
  build: {
    ssr: "src/entry-prerender.tsx",
    outDir: ssrOut,
    emptyOutDir: true,
    copyPublicDir: false,
    chunkSizeWarningLimit: 4000,
  },
});

const { render, sitemapRoutes, extraPrerenderPaths, dbRowToBlogPost, blogPosts } = await import(
  pathToFileURL(path.join(ssrOut, "entry-prerender.js")).href
);

const shell = readFileSync(path.join(dist, "index.html"), "utf8");
const SEO_RE = /<!--seo-head-->[\s\S]*?<!--\/seo-head-->/;
const OUTLET_RE = /<div id="root"><!--ssr-outlet-->([\s\S]*?)<!--\/ssr-outlet--><\/div>/;
if (!SEO_RE.test(shell) || !OUTLET_RE.test(shell)) {
  console.error("[prerender] index.html is missing the seo-head / ssr-outlet markers.");
  process.exit(1);
}
const directoryFallback = shell.match(OUTLET_RE)[1];

// Keep the untouched shell for every non-prerendered (app) route.
writeFileSync(path.join(dist, "app-shell.html"), shell);

// Blog posts stored in the blog_posts table (not in src/data/blogPosts). The
// public anon key can read them, exactly as the browser does. If the fetch
// fails they simply stay client-rendered, as before.
async function fetchDbPosts() {
  const env = { ...loadEnv("production", root, "VITE_"), ...process.env };
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.warn("[prerender] no Supabase env; database blog posts stay client-rendered");
    return [];
  }
  try {
    const res = await fetch(
      `${url}/rest/v1/blog_posts?select=id,slug,title,description,content,page_type,cluster,hero_image_url,published_at&order=published_at.desc&limit=1000`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const staticSlugs = new Set(blogPosts.map((p) => p.slug));
    return (await res.json()).map(dbRowToBlogPost).filter((p) => p.slug && !staticSlugs.has(p.slug));
  } catch (err) {
    console.warn(`[prerender] database blog posts skipped: ${err?.message ?? err}`);
    return [];
  }
}
const dbPosts = await fetchDbPosts();
console.log(`[prerender] ${dbPosts.length} database blog posts`);

const jobs = [
  ...[...new Set([...sitemapRoutes.map((r) => r.path), ...extraPrerenderPaths])].map((p) => ({ routePath: p })),
  ...dbPosts.map((post) => ({ routePath: `/blog/${post.slug}`, dbPost: post })),
];
// The /blog index lists database posts too (client-side today), so bake their
// metadata into it: otherwise 77 pages have no crawlable link from the index.
const listIndex = jobs.find((j) => j.routePath === "/blog");
if (listIndex) listIndex.dbPosts = dbPosts.map((p) => ({ ...p, content: "" }));
const routes = jobs.map((j) => j.routePath);

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function assemble(routePath, { html, head }, dbPost, dbPosts) {
  const title = head.title.toString();
  const hasHead = /<title[^>]*>[^<]+<\/title>/.test(title);
  // JSON inside <script>: escape "<" so post HTML can't close the tag early.
  const bake = (name, value) =>
    `<script>window.${name}=${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`;
  const baked = (dbPost ? bake("__ACA_DB_POST__", dbPost) : "") + (dbPosts ? bake("__ACA_DB_POSTS__", dbPosts) : "");
  const headHtml = hasHead
    ? `<!--seo-head-->${title}${head.meta}${head.link}${head.script}${baked}<!--/seo-head-->`
    : null;
  let out = headHtml ? shell.replace(SEO_RE, () => headHtml) : shell;
  // The directory-verifier badge block only matters on the raw homepage HTML.
  const tail = routePath === "/" ? directoryFallback : "";
  out = out.replace(
    OUTLET_RE,
    () => `<div id="root" data-prerendered="${escapeHtml(routePath)}">${html}</div>${tail}`,
  );
  return { out, hasHead };
}

const failures = [];
const missingHead = [];
let written = 0;
for (const { routePath, dbPost, dbPosts: list } of jobs) {
  try {
    const result = await render(routePath, { dbPost, dbPosts: list });
    const { out, hasHead } = assemble(routePath, result, dbPost, list);
    if (!hasHead) missingHead.push(routePath);
    const target =
      routePath === "/" ? path.join(dist, "index.html") : path.join(dist, routePath, "index.html");
    if (routePath !== "/" && existsSync(target)) {
      throw new Error(`refusing to overwrite existing ${path.relative(root, target)}`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, out);
    written++;
  } catch (err) {
    failures.push({ routePath, err });
    console.warn(`[prerender] FAILED ${routePath}: ${err?.message ?? err}`);
  }
}

// sitemap.xml: same list, only real lastmod dates.
const lastmod = new Map([
  ...sitemapRoutes.map((r) => [r.path, r.lastmod]),
  ...dbPosts.map((p) => [`/blog/${p.slug}`, p.modifiedDate]),
]);
const urls = [...sitemapRoutes.map((r) => r.path), ...dbPosts.map((p) => `/blog/${p.slug}`)]
  .filter(Boolean)
  .filter((p, i, a) => a.indexOf(p) === i)
  .map((p) => {
    const loc = `${SITE_URL}${p}`;
    const mod = lastmod.get(p);
    return `  <url><loc>${loc}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ""}</url>`;
  });
writeFileSync(
  path.join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
);

rmSync(ssrOut, { recursive: true, force: true });

// vercel.json redirects /<slug> -> /blog/<slug>; warn if new posts lack one.
try {
  const configured = new Set(
    (JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")).redirects ?? []).map((r) => r.source),
  );
  const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
  const reserved = new Set([...app.matchAll(/path="\/([a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = sitemapRoutes
    .map((r) => r.path.match(/^\/(?:blog|playbooks)\/([^/]+)$/)?.[1])
    .filter((slug) => slug && !reserved.has(slug) && !configured.has(`/${slug}`));
  if (missing.length) {
    console.warn(
      `[prerender] ${missing.length} slug(s) have no root-level redirect in vercel.json (e.g. /${missing[0]}). Run \`npm run sync:redirects\` and commit.`,
    );
  }
} catch (err) {
  console.warn("[prerender] could not check slug redirects:", err?.message ?? err);
}

console.log(`[prerender] wrote ${written}/${routes.length} pages, sitemap with ${urls.length} URLs`);
if (missingHead.length) {
  console.warn(`[prerender] ${missingHead.length} page(s) rendered without their own <title>:`);
  for (const p of missingHead.slice(0, 20)) console.warn(`  ${p}`);
}
const criticalFailed = failures.filter((f) => CRITICAL.includes(f.routePath));
if (criticalFailed.length || failures.length / routes.length > MAX_FAILURE_RATE) {
  console.error(`[prerender] ${failures.length} failure(s); failing the build.`);
  process.exit(1);
}
