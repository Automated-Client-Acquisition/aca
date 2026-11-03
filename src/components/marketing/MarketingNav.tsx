import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ArrowUpRight, Github, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/marketing/Logo";
import { ACA_GITHUB_URL } from "@/components/marketing/links";
import {
  GitHubStarBanner,
  GitHubStarsLink,
  NavDivider,
} from "@/components/marketing/GitHubStars";
import "@/styles/aca-home.css";
import "@/styles/marketing-system.css";

const marketingLinks = [
  { label: "Playbooks", to: "/playbooks" },
  { label: "Signals", to: "/signals" },
  { label: "MCP & CLI", to: "/mcp", badge: "New" },
  { label: "Tools", to: "/tools" },
  { label: "Pricing", to: "/pricing" },
  { label: "Blog", to: "/blog" },
  { label: "Community", to: "/community" },
];

export function MarketingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = "#fff9ef";
    return () => {
      document.body.style.background = previous;
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const links = marketingLinks.map((link) => (
    <NavLink
      key={link.to}
      to={link.to}
      onClick={() => setMobileOpen(false)}
      className={({ isActive }) =>
        `mkt-nav__link${isActive ? " is-active" : ""}`
      }
    >
      {link.label}
      {link.badge && <span className="mkt-nav__badge">{link.badge}</span>}
    </NavLink>
  ));

  return (
    <>
      <GitHubStarBanner />
      <header className="aca-marketing mkt-chrome mkt-header">
        <nav className="mkt-nav" aria-label="Main navigation">
          <Link to="/" aria-label="ACA home" className="mkt-nav__brand">
            <Logo size={34} />
          </Link>
          <div className="mkt-nav__desktop">
            <div className="mkt-nav__links">{links}</div>
            <div className="mkt-nav__actions">
              <GitHubStarsLink className="mkt-nav__github" />
              <NavDivider />
              <Link to="/auth" className="mkt-nav__signin">
                Sign in
              </Link>
              <Button asChild variant="cta" className="mkt-nav__cta">
                <Link to="/get-started">
                  Start for free <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
          <Button
            asChild
            variant="cta"
            className="mkt-nav__cta mkt-nav__mobile-start"
          >
            <Link to="/get-started" onClick={() => setMobileOpen(false)}>
              Start free <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </Button>
          <button
            ref={toggleRef}
            className="mkt-nav__toggle"
            type="button"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            aria-controls="marketing-mobile-navigation"
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? (
              <X size={23} aria-hidden="true" />
            ) : (
              <Menu size={23} aria-hidden="true" />
            )}
          </button>
          {mobileOpen && (
            <div id="marketing-mobile-navigation" className="mkt-nav__mobile">
              <div className="mkt-nav__mobile-links">{links}</div>
              <div className="mkt-nav__mobile-actions">
                <a
                  href={ACA_GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mkt-nav__github"
                  onClick={() => setMobileOpen(false)}
                >
                  <Github size={19} aria-hidden="true" /> GitHub
                </a>
                <Link
                  to="/auth"
                  className="mkt-nav__signin"
                  onClick={() => setMobileOpen(false)}
                >
                  Sign in
                </Link>
                <Button asChild variant="cta" className="mkt-nav__cta">
                  <Link to="/get-started" onClick={() => setMobileOpen(false)}>
                    Start for free <ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </nav>
      </header>
    </>
  );
}

export default MarketingNav;
