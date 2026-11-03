import { useState } from "react";
import { Link } from "react-router-dom";
import { SPRINT, OTO1_PAYMENT_LINK, OTO1_DOWNSELL_PAYMENT_LINK } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";

// OTO 1, shown immediately after checkout: The Agent Vault - all 9 finished
// agents, $147 one-time. Declining reveals an inline 3-pay downsell instead of
// a separate page (fewer steps, same economics). Buy buttons use Stripe
// Payment Links from sprintConfig; when a link isn't configured yet the buy
// path hides and only the continue path shows, so the funnel never dead-ends.
export default function SprintVault() {
  const [declined, setDeclined] = useState(false);
  const nextHref = "/sprint/vip";
  const canBuy = OTO1_PAYMENT_LINK.length > 0;
  const canDownsell = OTO1_DOWNSELL_PAYMENT_LINK.length > 0;

  return (
    <div className="sf">
      <div className="sf__bar">Step 2 of 3 · Your seat is confirmed</div>

      <main className="sf__letter sf__wrap">
        <div className="sf__confirm">
          ✓ Your order is confirmed - check your email for your Sprint access. But before you go…
        </div>

        <header className="sf__head sf__head--light" style={{ paddingTop: 12, paddingBottom: 0 }}>
          <div className="sf__prehead">Wait - one-time offer, only on this page</div>
          <h1 className="sf__h1" style={{ fontSize: "clamp(26px,5vw,38px)" }}>
            You're about to build <em>one</em> agent. The founders winning biggest run <em>nine</em>.
          </h1>
        </header>

        <p>
          In the Sprint you'll build your AI setter - the agent that books the calls. It works. But
          here's what we've learned watching this build run across our whole community: <b>the setter
          is one worker. The machine is a team.</b>
        </p>
        <ul>
          <li>The <b>Maps scraper</b> and the <b>lead pipeline</b> keep it fed with verified, qualified leads.</li>
          <li>The <b>buying-signals agent</b> tells it <i>who to hit this week</i> - companies that just raised, just hired, just changed leadership.</li>
          <li>The <b>content agents</b> (carousel, YouTube, SEO) warm your market so prospects already know your name when the DM lands.</li>
          <li>The <b>Reddit</b> and <b>SEC Form 4</b> agents open channels your competitors don't even watch.</li>
        </ul>
        <p>
          <b>The Agent Vault</b> is all nine finished agents - the same one-command installs as your
          setter - plus every playbook and every future update. Build one with us this week, then add
          one a week until the whole machine runs.
        </p>

        <div className="sf__stack">
          <h3>The Agent Vault</h3>
          <div className="sf__stack-row"><span>All <b>9 finished agents</b> (setter, Maps, pipeline, signals, carousel, SEO, YouTube, Reddit, SEC&nbsp;Form&nbsp;4)</span><span className="v">9 × $297</span></div>
          <div className="sf__stack-row"><span>Every <b>build playbook</b> - understand and customize each one</span><span className="v">$297</span></div>
          <div className="sf__stack-row"><span><b>Lifetime updates</b> - every improvement, every new version</span><span className="v">priceless</span></div>
          <div className="sf__stack-total">
            <span className="was">Worth $2,970+</span>
            <span className="now">This page only: ${SPRINT.oto1.price}</span>
          </div>
        </div>

        {canBuy ? (
          <a className="sf__cta" href={OTO1_PAYMENT_LINK}>
            YES! Add The Agent Vault To My Order - ${SPRINT.oto1.price}
          </a>
        ) : (
          <Link className="sf__cta" to={nextHref}>Continue to my order →</Link>
        )}
        <p className="sf__cta-note">One-time payment · Instant access · Never offered at this price again</p>

        {canBuy && !declined ? (
          <button className="sf__decline" onClick={() => setDeclined(true)}>
            No thanks - I only want the one agent, even at this price. Continue →
          </button>
        ) : null}

        {declined ? (
          <div className="sf__downsell">
            <h3>OK - how about the same Vault, split into 3 easy payments?</h3>
            <p>
              Everything above - all 9 agents, all playbooks, lifetime updates - for{" "}
              <b>{SPRINT.oto1.downsellLabel}</b> instead of ${SPRINT.oto1.price} today. Same access,
              gentler on this month's cash flow.
            </p>
            {canDownsell ? (
              <a className="sf__cta" href={OTO1_DOWNSELL_PAYMENT_LINK}>
                YES! Give Me The Vault - {SPRINT.oto1.downsellLabel}
              </a>
            ) : null}
            <Link className="sf__decline" to={nextHref}>
              No thanks - take me to my order.
            </Link>
          </div>
        ) : null}
      </main>

      <footer className="sf__foot">
        <div className="sf__wrap">
          © {new Date().getFullYear()} Automated Client Acquisition · <a href="/privacy">Privacy</a> ·{" "}
          <a href="/terms">Terms</a>
        </div>
      </footer>
    </div>
  );
}
