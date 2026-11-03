// Blog posts for the marketing site. The public repo ships none.
import type { BlogPost } from "./blogPosts.types";

export const blogPosts: BlogPost[] = [];

export type { BlogPost } from "./blogPosts.types";

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getRelatedPosts(slugs: string[]): BlogPost[] {
  if (!slugs?.length) return [];
  return slugs
    .map((s) => blogPosts.find((p) => p.slug === s))
    .filter((p): p is BlogPost => !!p);
}

export const featuredPost: BlogPost | undefined = blogPosts[0];
