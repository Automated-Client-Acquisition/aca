import { Helmet } from "react-helmet-async";
import { createElement } from "react";
import { useLocation } from "react-router-dom";
import { PUBLIC_SITE_URL } from "@/config/site";

const SITE_NAME = "ACA";
// The apex domain redirects to www, so canonical/og:url must name the www URL.
const SITE_URL = PUBLIC_SITE_URL;
const DEFAULT_OG_IMAGE = "/og-image-v2.png";
const DEFAULT_DESCRIPTION =
  "We attract or identify warm leads and nurture them, until they buy or book. Content, outreach and AI agents in one machine. Bring your own keys, never pay per credit.";

const MAX_TITLE = 60;
const MAX_DESCRIPTION = 160;

/** Cut at a word boundary so search results don't truncate mid-word. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:.-]+$/, "")}…`;
}

export interface SEOOptions {
  title: string;
  /** Use `title` as-is instead of appending " | ACA" (homepage). */
  absoluteTitle?: boolean;
  description?: string;
  canonical?: string;
  ogImage?: string;
  ogType?: "website" | "article";
  keywords?: string[];
  noindex?: boolean;
  article?: {
    publishedTime: string;
    modifiedTime?: string;
    author: string;
    tags: string[];
    section: string;
  };
}

export function useSEO(options: SEOOptions) {
  const { pathname } = useLocation();
  const {
    title,
    absoluteTitle = false,
    description = DEFAULT_DESCRIPTION,
    canonical = pathname === "/" ? "/" : pathname.replace(/\/+$/, ""),
    ogImage = DEFAULT_OG_IMAGE,
    ogType = "website",
    keywords,
    noindex = false,
    article,
  } = options;

  // The brand suffix is the first thing to go when a title would be truncated.
  const withSuffix = `${title} | ${SITE_NAME}`;
  const fullTitle = absoluteTitle || withSuffix.length > MAX_TITLE ? title : withSuffix;
  const metaDescription = clamp(description, MAX_DESCRIPTION);
  const canonicalUrl = canonical.startsWith("http") ? canonical : `${SITE_URL}${canonical}`;
  const ogImageUrl = ogImage.startsWith("http") ? ogImage : `${SITE_URL}${ogImage}`;

  return createElement(
    Helmet,
    null,
    createElement("title", null, fullTitle),
    createElement("meta", { name: "description", content: metaDescription }),
    noindex
      ? createElement("meta", { name: "robots", content: "noindex, nofollow" })
      : createElement("meta", { name: "robots", content: "index, follow" }),
    keywords?.length
      ? createElement("meta", { name: "keywords", content: keywords.join(", ") })
      : null,
    // A noindex page must not also assert a canonical: it is not the preferred version of anything.
    !noindex ? createElement("link", { rel: "canonical", href: canonicalUrl }) : null,

    // Open Graph
    createElement("meta", { property: "og:title", content: fullTitle }),
    createElement("meta", { property: "og:description", content: metaDescription }),
    createElement("meta", { property: "og:type", content: ogType }),
    createElement("meta", { property: "og:image", content: ogImageUrl }),
    ...(ogImage === DEFAULT_OG_IMAGE
      ? [
          createElement("meta", { property: "og:image:width", content: "1200", key: "og-w" }),
          createElement("meta", { property: "og:image:height", content: "630", key: "og-h" }),
        ]
      : []),
    createElement("meta", { property: "og:url", content: canonicalUrl }),
    createElement("meta", { property: "og:site_name", content: SITE_NAME }),

    // Twitter Card
    createElement("meta", { name: "twitter:card", content: "summary_large_image" }),
    createElement("meta", { name: "twitter:site", content: "@ACAXtreme" }),
    createElement("meta", { name: "twitter:title", content: fullTitle }),
    createElement("meta", { name: "twitter:description", content: metaDescription }),
    createElement("meta", { name: "twitter:image", content: ogImageUrl }),
    ogImage === DEFAULT_OG_IMAGE
      ? createElement("meta", {
          name: "twitter:image:alt",
          content: "Ember the ACA fox waving from a clay world of tiny workers, next to the ACA motto",
        })
      : null,

    // Article-specific
    article
      ? createElement("meta", { property: "article:published_time", content: article.publishedTime })
      : null,
    article?.modifiedTime
      ? createElement("meta", { property: "article:modified_time", content: article.modifiedTime })
      : null,
    article
      ? createElement("meta", { property: "article:author", content: article.author })
      : null,
    article
      ? createElement("meta", { property: "article:section", content: article.section })
      : null,
    ...(article?.tags.map((tag) =>
      createElement("meta", { property: "article:tag", content: tag, key: tag })
    ) ?? [])
  );
}
