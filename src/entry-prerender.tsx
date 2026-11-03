/**
 * Server entry for the build-time prerender (scripts/prerender.mjs).
 *
 * Renders the REAL <App /> under a StaticRouter, so the HTML matches what the
 * client will hydrate against: same providers, same route table, same head tags.
 * There is no second copy of the marketing routes to keep in sync.
 */
import { Writable } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { StaticRouter } from "react-router";
import { HelmetProvider, type HelmetServerState } from "react-helmet-async";
import { QueryClient } from "@tanstack/react-query";
import App from "./App";

export { sitemapRoutes, extraPrerenderPaths } from "./sitemap-routes";
export { dbRowToBlogPost } from "./hooks/useBlogPosts";
export { blogPosts } from "./data/blogPosts";

const RENDER_TIMEOUT_MS = 30_000;

export interface PrerenderResult {
  html: string;
  head: HelmetServerState;
}

/**
 * Database-backed content is exposed to the query hooks via globalThis for this
 * one render: `dbPost` for /blog/<slug>, `dbPosts` (metadata only) for /blog.
 */
export function render(
  url: string,
  extras: { dbPost?: unknown; dbPosts?: unknown } = {},
): Promise<PrerenderResult> {
  const g = globalThis as { __ACA_DB_POST__?: unknown; __ACA_DB_POSTS__?: unknown };
  g.__ACA_DB_POST__ = extras.dbPost;
  g.__ACA_DB_POSTS__ = extras.dbPosts;
  const helmetContext: { helmet?: HelmetServerState } = {};

  return new Promise((resolve, reject) => {
    let html = "";
    let failure: unknown = null;
    const sink = new Writable({
      write(chunk, _enc, cb) {
        html += chunk.toString();
        cb();
      },
    });
    sink.on("finish", () => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else resolve({ html, head: helmetContext.helmet! });
    });

    const { pipe, abort } = renderToPipeableStream(
      <HelmetProvider context={helmetContext}>
        <App Router={StaticRouter} routerProps={{ location: url }} client={new QueryClient()} />
      </HelmetProvider>,
      {
        // Wait for every lazy route chunk: streaming out the Suspense fallback
        // would prerender a blank page.
        onAllReady() {
          pipe(sink);
        },
        onShellError(err) {
          clearTimeout(timer);
          reject(err);
        },
        // A boundary that errors falls back to client rendering, which would
        // silently ship an empty page. Treat it as a failed route instead.
        onError(err) {
          failure ??= err;
        },
      },
    );
    const timer = setTimeout(() => {
      abort();
      reject(new Error(`render timed out after ${RENDER_TIMEOUT_MS}ms`));
    }, RENDER_TIMEOUT_MS);
  });
}
