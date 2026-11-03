import { useQuery } from "@tanstack/react-query";

/**
 * Public star count for a GitHub repo, for the marketing nav.
 *
 * Unauthenticated GitHub API calls are limited to 60 an hour per visitor IP,
 * so the count stays fresh for an hour and is never retried: a failure just
 * leaves the link without a number.
 *
 * Do not set gcTime here. scripts/prerender.mjs renders these pages in Node,
 * where TanStack's default gcTime is Infinity; a finite one schedules a cache
 * cleanup timer that keeps the process alive after the pages are written, and
 * the Vercel build never finishes.
 */
export function useGitHubStars(repo: string) {
  return useQuery({
    queryKey: ["github-stars", repo],
    queryFn: async (): Promise<number> => {
      const res = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const body = (await res.json()) as { stargazers_count?: number };
      return body.stargazers_count ?? 0;
    },
    staleTime: 60 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
