import { useState } from "react";
import { Link } from "react-router-dom";
import { RADAR, OTO1_PAYMENT_LINK, OTO1_DOWNSELL_PAYMENT_LINK } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";
import "@/styles/marketing-specialized.css";

// Radar funnel OTO 1: the Agent Vault (shared ascension step across all three
// front doors). Copy reframed for the B2B pipeline avatar.
export default function RadarVault() {
  const [declined, setDeclined] = useState(false);
  const nextHref = "/radar/launch";
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
            One agent finds the buyers. <em>Nine agents run the whole machine.</em>
          </h1>
        </header>

        <p>
          You just solved timing. Smart. But think about the rest of the machine: the signals tell
          you WHO's ready - you still need the research, the outreach that books the call, and the
          content that makes them say "I've heard of you" when you do. That's not a tool anymore -
          that's a client-acquisition machine.
        </p>
        <p><b>The Agent Vault</b> is the whole roster, finished:</p>
        <img
          className="sf__shot"
          src="/offers/vault-stack.jpg"
          alt="The Agent Vault: nine finished agent boxes - Local Leads, Lead Pipeline, AI Setter, Buying Signals, SEC Form 4, Carousel Factory, YouTube Agent, SEO Growth and more"
          decoding="async"
        />
        <ul>
          <li><b>Lead Pipeline + Local Leads</b> - endless prospects, researched and qualified.</li>
          <li><b>The AI Setter</b> - books the calls, on LinkedIn, in your voice.</li>
          <li><b>SEC Form 4</b> - the wealth-signal cousin of the agent you just bought.</li>
          <li><b>Carousel Factory + YouTube + SEO</b> - the inbound side: content, videos, rankings on autopilot.</li>
          <li><b>Reddit</b> - be the helpful answer in threads where buyers are literally asking what to buy.</li>
        </ul>
        <p>
          Every agent installs into the same Hermes Agent runtime you're already setting up - one
          command each, same copy-paste way as the one you just bought. Add one a week and in two
          months you're running a stack that agencies charge thousands a month to operate.
        </p>

        <div className="sf__stack">
          <h3>The Agent Vault</h3>
          <div className="sf__stack-row"><span>All <b>9 finished agents</b> - every acquisition path, done</span><span className="v">9 × $297</span></div>
          <div className="sf__stack-row"><span>Every <b>build playbook</b> - understand and customize each one</span><span className="v">$297</span></div>
          <div className="sf__stack-row"><span><b>Lifetime updates</b> - every improvement, forever</span><span className="v">priceless</span></div>
          <div className="sf__stack-total">
            <span className="was">Worth $2,970+</span>
            <span className="now">This page only: ${RADAR.oto1.price}</span>
          </div>
        </div>

        {canBuy ? (
          <a className="sf__cta" href={OTO1_PAYMENT_LINK}>
            YES! Add The Agent Vault To My Order - ${RADAR.oto1.price}
          </a>
        ) : (
          <Link className="sf__cta" to={nextHref}>Continue to my order →</Link>
        )}
        <p className="sf__cta-note">One-time payment · Instant access · Never offered at this price again</p>

        {canBuy && !declined ? (
          <button className="sf__decline" onClick={() => setDeclined(true)}>
            No thanks - timing alone is enough for me right now. Continue →
          </button>
        ) : null}

        {declined ? (
          <div className="sf__downsell">
            <h3>OK - same Vault, split into 3 easy payments?</h3>
            <p>
              Everything above - all 9 agents, all playbooks, lifetime updates - for{" "}
              <b>{RADAR.oto1.downsellLabel}</b> instead of ${RADAR.oto1.price} today.
            </p>
            {canDownsell ? (
              <a className="sf__cta" href={OTO1_DOWNSELL_PAYMENT_LINK}>
                YES! Give Me The Vault - {RADAR.oto1.downsellLabel}
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
