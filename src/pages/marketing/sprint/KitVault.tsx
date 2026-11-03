import { useState } from "react";
import { Link } from "react-router-dom";
import { KIT, OTO1_PAYMENT_LINK, OTO1_DOWNSELL_PAYMENT_LINK } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";
import "@/styles/marketing-specialized.css";

// Kit funnel OTO 1: the Agent Vault (same offer + economics as the Sprint's
// OTO 1, copy reframed for the "money paths" avatar - no Sprint references).
export default function KitVault() {
  const [declined, setDeclined] = useState(false);
  const nextHref = "/kit/launch";
  const canBuy = OTO1_PAYMENT_LINK.length > 0;
  const canDownsell = OTO1_DOWNSELL_PAYMENT_LINK.length > 0;

  return (
    <div className="sf">
      <div className="sf__bar">Step 2 of 3 · Your Kit is confirmed</div>

      <main className="sf__letter sf__wrap">
        <div className="sf__confirm">
          ✓ Order confirmed - your Kit and login are on their way to your inbox. But before you go…
        </div>

        <header className="sf__head sf__head--light" style={{ paddingTop: 12, paddingBottom: 0 }}>
          <div className="sf__prehead">Wait - one-time offer, only on this page</div>
          <h1 className="sf__h1" style={{ fontSize: "clamp(28px,5vw,42px)" }}>
            One agent is an income stream. <em>Nine agents is a business.</em>
          </h1>
        </header>

        <p>
          You just picked your money path. Smart. But think about what you'd charge a client for{" "}
          <i>all</i> of it: the leads AND the outreach AND the content AND the signals telling you
          exactly when a company is ready to buy. That's not a side hustle anymore - that's an agency.
        </p>
        <p><b>The Agent Vault</b> is the whole roster, finished:</p>
        <img
          className="sf__shot"
          src="/offers/vault-stack.jpg"
          alt="The Agent Vault: nine finished agent boxes - Local Leads, Lead Pipeline, AI Setter, Buying Signals, SEC Form 4, Carousel Factory, YouTube Agent, SEO Growth and more"
          decoding="async"
        />
        <ul>
          <li><b>Local Leads + Lead Pipeline</b> - endless verified prospects, researched and qualified.</li>
          <li><b>The AI Setter</b> - books the calls, on LinkedIn, in your voice.</li>
          <li><b>Buying Signals + SEC Form 4</b> - know who's ready to buy the week it happens.</li>
          <li><b>Content Factory + YouTube + SEO</b> - the inbound side: content, videos, and rankings on autopilot.</li>
          <li><b>Reddit</b> - be the helpful answer in threads where buyers are literally asking what to buy.</li>
        </ul>
        <p>
          Every agent installs into the same Hermes Agent runtime you're already setting up - one
          command each, same copy-paste way as the one you just bought. Add one a week and in two
          months you're running a stack that agencies charge thousands a month to operate.
        </p>

        <div className="sf__stack">
          <h3>The Agent Vault</h3>
          <div className="sf__stack-row"><span>All <b>9 finished agents</b> - every money path, done</span><span className="v">9 × $297</span></div>
          <div className="sf__stack-row"><span>Every <b>build playbook</b> - understand and customize each one</span><span className="v">$297</span></div>
          <div className="sf__stack-row"><span><b>Lifetime updates</b> - every improvement, forever</span><span className="v">priceless</span></div>
          <div className="sf__stack-total">
            <span className="was">Worth $2,970+</span>
            <span className="now">This page only: ${KIT.oto1.price}</span>
          </div>
        </div>

        {canBuy ? (
          <a className="sf__cta" href={OTO1_PAYMENT_LINK}>
            YES! Add The Agent Vault To My Order - ${KIT.oto1.price}
          </a>
        ) : (
          <Link className="sf__cta" to={nextHref}>Continue to my order →</Link>
        )}
        <p className="sf__cta-note">One-time payment · Instant access · Never offered at this price again</p>

        {canBuy && !declined ? (
          <button className="sf__decline" onClick={() => setDeclined(true)}>
            No thanks - one income stream is enough for me right now. Continue →
          </button>
        ) : null}

        {declined ? (
          <div className="sf__downsell">
            <h3>OK - same Vault, split into 3 easy payments?</h3>
            <p>
              Everything above - all 9 agents, all playbooks, lifetime updates - for{" "}
              <b>{KIT.oto1.downsellLabel}</b> instead of ${KIT.oto1.price} today.
            </p>
            {canDownsell ? (
              <a className="sf__cta" href={OTO1_DOWNSELL_PAYMENT_LINK}>
                YES! Give Me The Vault - {KIT.oto1.downsellLabel}
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
