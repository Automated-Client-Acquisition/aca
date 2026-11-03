import { ArrowRight, Github, Star } from "lucide-react";
import { useGitHubStars } from "@/hooks/useGitHubStars";
import { ACA_GITHUB_REPO, ACA_GITHUB_URL } from "@/components/marketing/links";
import "@/styles/github-stars.css";

/** 25600 → "25.6k", the way GitHub-adjacent sites show it. */
function formatStars(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
    .format(n)
    .toLowerCase();
}

/**
 * GitHub logo with the repo's live star count, for the nav. Until the repo has
 * a star (or if the count can't be fetched) it reads "Star" instead of "0".
 */
export function GitHubStarsLink({ className = "" }: { className?: string }) {
  const { data: stars } = useGitHubStars(ACA_GITHUB_REPO);
  const count = stars && stars > 0 ? formatStars(stars) : null;
  return (
    <a
      href={ACA_GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`aca-gh-stars ${className}`.trim()}
      aria-label={count ? `ACA on GitHub, ${stars} stars` : "Star ACA on GitHub"}
    >
      <Github size={19} aria-hidden="true" />
      <span className="aca-gh-stars__count">{count ?? "Star"}</span>
    </a>
  );
}

/** Thin vertical rule between the GitHub link and "Sign in". */
export function NavDivider({ className = "" }: { className?: string }) {
  return <span className={`aca-gh-divider ${className}`.trim()} aria-hidden="true" />;
}

/** Dark strip above the header asking for a star. Scrolls away; the header stays. */
export function GitHubStarBanner() {
  return (
    <div className="aca-gh-banner">
      <p className="aca-gh-banner__text">
        <span className="aca-gh-banner__lead">ACA is going self-hosted and source available.</span>
        <a
          href={ACA_GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="aca-gh-banner__link"
        >
          <Star size={15} aria-hidden="true" />
          <span className="aca-gh-banner__cta">Give it a star</span>
          <ArrowRight size={15} aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
