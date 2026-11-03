import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BlogPost } from "@/data/blogPosts/blogPosts.types";
import { fixDeadRouteLinks } from "@/lib/deadRouteLinks";

interface DbBlogPost {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content: Record<string, unknown>;
  page_type: string | null;
  cluster: string | null;
  hero_image_url: string | null;
  published_at: string;
}

export function dbRowToBlogPost(row: DbBlogPost): BlogPost {
  const c = row.content as Record<string, unknown>;
  return {
    slug: row.slug,
    title: row.title,
    description: (row.description ?? (c.description as string) ?? ""),
    publishDate: (c.publishDate as string) ?? row.published_at.slice(0, 10),
    modifiedDate: (c.modifiedDate as string) ?? row.published_at.slice(0, 10),
    category: (c.category as string) ?? "Strategy",
    cluster: row.cluster ?? undefined,
    pageType: (row.page_type as BlogPost["pageType"]) ?? undefined,
    author: (c.author as string) ?? "Cedric Seguela",
    authorRole: (c.authorRole as string) ?? "Founder, ACA",
    wordCount: (c.wordCount as number) ?? undefined,
    readTime: (c.readTime as string) ?? "8 min read",
    keywords: (c.keywords as string[]) ?? [],
    featured: false,
    coverImage: row.hero_image_url ?? undefined,
    relatedSlugs: (c.relatedSlugs as string[]) ?? [],
    ctaText: (c.ctaText as string) ?? undefined,
    ctaHref: (c.ctaHref as string) ?? "https://www.skool.com/aca-xtreme",
    tableOfContents: (c.tableOfContents as BlogPost["tableOfContents"]) ?? [],
    content: fixDeadRouteLinks((c.content as string) ?? ""),
    previewVariant: (c.previewVariant as BlogPost["previewVariant"]) ?? undefined,
  };
}

/** Metadata-only list baked into the prerendered /blog page (no post bodies). */
function prerenderedList(): BlogPost[] | undefined {
  return (globalThis as { __ACA_DB_POSTS__?: BlogPost[] }).__ACA_DB_POSTS__;
}

export function useDbBlogPosts() {
  return useQuery({
    queryKey: ["db_blog_posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("id, slug, title, description, content, page_type, cluster, hero_image_url, published_at")
        .order("published_at", { ascending: false });
      if (error) throw error;
      return (data as DbBlogPost[]).map(dbRowToBlogPost);
    },
    initialData: () => prerenderedList(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * scripts/prerender.mjs bakes the post into the page (window.__ACA_DB_POST__) so
 * the client can hydrate the server-rendered article instead of blanking while
 * it fetches the same row again.
 */
function prerenderedPost(slug: string | undefined): BlogPost | undefined {
  const baked = (globalThis as { __ACA_DB_POST__?: BlogPost }).__ACA_DB_POST__;
  return slug && baked?.slug === slug ? baked : undefined;
}

export function useDbBlogPost(slug: string | undefined) {
  return useQuery({
    queryKey: ["db_blog_posts", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("id, slug, title, description, content, page_type, cluster, hero_image_url, published_at")
        .eq("slug", slug!)
        .single();
      if (error) throw error;
      return dbRowToBlogPost(data as DbBlogPost);
    },
    enabled: !!slug,
    initialData: () => prerenderedPost(slug),
    staleTime: 5 * 60 * 1000,
  });
}
