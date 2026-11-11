import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/marketing/Logo";
import { DIRECTORY_BADGES } from "@/components/marketing/directoryBadges";
import "@/styles/aca-home.css";
import "@/styles/marketing-system.css";

export function MarketingFooter() {
  return (
    <footer className="aca-marketing mkt-chrome mkt-footer">
      <div className="mkt-footer__inner">
        <div className="mkt-footer__top">
          <div className="mkt-footer__brand">
            <Link to="/" aria-label="ACA home">
              <Logo size={42} />
            </Link>
            <p>
              More sales conversations.
              <br />
              Fewer tool bills.
            </p>
            <span>One connected workspace for your next client.</span>
            <Link className="mkt-footer__start" to="/get-started">
              Meet your new acquisition system{" "}
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className="mkt-footer__col">
            <h2>Product</h2>
            <ul>
              <li>
                <Link to="/pricing">Pricing</Link>
              </li>
              <li>
                <Link to="/how-we-work">How we work</Link>
              </li>
              <li>
                <Link to="/mcp">MCP &amp; CLI</Link>
              </li>
              <li>
                <Link to="/auth">Sign in</Link>
              </li>
              <li>
                <Link to="/get-started">Start for free</Link>
              </li>
            </ul>
          </div>
          <div className="mkt-footer__col">
            <h2>Resources</h2>
            <ul>
              <li>
                <Link to="/developers">Developers</Link>
              </li>
              <li>
                <Link to="/playbooks">Playbooks</Link>
              </li>
              <li>
                <Link to="/tools">Free tools</Link>
              </li>
              <li>
                <Link to="/agents">AI agents course</Link>
              </li>
              <li>
                <Link to="/blog">Blog</Link>
              </li>
            </ul>
          </div>
          <div className="mkt-footer__col">
            <h2>Company</h2>
            <ul>
              <li>
                <a
                  href="https://www.skool.com/aca-xtreme/about"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Community
                </a>
              </li>
              <li>
                <Link to="/support">Support</Link>
              </li>
              <li>
                <Link to="/privacy">Privacy</Link>
              </li>
              <li>
                <Link to="/terms">Terms</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mkt-footer__bottom">
          <span>© {new Date().getFullYear()} Automated Client Acquisition</span>
          <div>
            <Link to="/support">Support</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </div>
        </div>
        <div className="mkt-footer__badges" aria-label="Directory listings">
          {DIRECTORY_BADGES.map((badge) => (
            <a
              key={badge.href}
              href={badge.href}
              target={
                badge.target === null ? undefined : (badge.target ?? "_blank")
              }
              rel={badge.rel}
              title={badge.title}
              className="mkt-footer__badge"
            >
              {badge.src ? (
                <img
                  src={badge.src}
                  alt={badge.alt}
                  height={20}
                  loading="lazy"
                />
              ) : (
                badge.text
              )}
            </a>
          ))}
        </div>
      </div>
      {/* linkorva:badges */}
    </footer>
  );
}

export default MarketingFooter;
