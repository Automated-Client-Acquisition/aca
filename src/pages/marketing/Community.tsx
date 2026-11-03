import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { useSEO } from "@/hooks/useSEO";
import "@/styles/aca-home.css";
import "@/styles/marketing-resources.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme";

// Facts on this page mirror the live Skool about page (skool.com/aca-xtreme).
// If the offer changes there (price, member cap, guarantees), update here too.
export default function Community() {
  const seo = useSEO({
    title: "ACA Community - Software, Playbooks & Support for $67/month",
    description:
      "Join the ACA community for $67/month and the full software is included. Weekly operator calls, retainer playbooks, ready-to-use AI agents, and direct support.",
    canonical: "/community",
  });

  const included = [
    {
      title: "Run campaigns in ACA",
      body: "Find leads, launch outreach, create content and manage follow-up in one workspace. The full $67/month Operator plan is included, with unlimited seats, leads, campaigns and content.",
    },
    {
      title: "Ready-to-use AI agents",
      body: "Use prepared Hermes and Claude configurations for outreach, message drafting and lead nurturing. Start with a working configuration, then adapt it to your offer.",
    },
    {
      title: "Package a service clients can buy",
      body: "Use retainer playbooks to structure your client acquisition offer, explain what you deliver and plan the work for each client.",
    },
    {
      title: "Plan your next campaign",
      body: "Learn how to choose a target audience, shape your message and connect outreach with follow-up. Discuss the approach on the weekly calls before putting it into practice.",
    },
    {
      title: "Get help on weekly live calls",
      body: "Bring your campaign questions. Review approaches with other operators and learn how they set up and improve their acquisition workflows.",
    },
    {
      title: "Free GoHighLevel account + snapshot",
      body: "Get a GoHighLevel account with the community snapshot installed, so you have a starting point for delivering client work alongside ACA.",
    },
    {
      title: "Get direct setup support",
      body: "Ask the team for help with your campaigns, sequences and workspace setup. Get guidance on the step holding up your launch.",
    },
    {
      title: "Set up your email infrastructure",
      body: "Follow the bring-your-own Microsoft 365 mailbox setup. Understand the connections and provider costs before you launch cold email.",
    },
  ];

  return (
    <>
      {seo}
      <MarketingNav />
      <main className="aca-marketing mkt-page resource-page resource-community">
        <section className="resource-hero">
          <div className="wrap resource-community-hero">
            <div>
              <span className="kicker">For agency owners & B2B founders</span>
              <h1>
                Build client acquisition campaigns.
                <br />
                <em>Sell them as a service.</em>
              </h1>
              <p className="lead">
                Get the full ACA platform, ready-to-use AI agents, retainer
                playbooks and weekly live calls for $67/month. Learn how to find
                buyers, launch outreach and deliver campaigns for your clients,
                with direct support when you get stuck.
              </p>
              <a
                href={SKOOL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn--primary btn--lg"
              >
                Get ACA + the community for $67/month →
              </a>
              <p className="resource-community-note">
                Hosted on Skool · 7-day refund · Provider usage billed
                separately
              </p>
            </div>
            <div className="resource-community-offer">
              <svg
                viewBox="182 279 721 947"
                role="img"
                aria-label="ACA fox mascot"
              >
                <image
                  href="/media/mascot/fox-wave-cut.png"
                  width="1024"
                  height="1536"
                />
              </svg>
              <span className="resource-label">
                Software + implementation support
              </span>
              <div className="resource-community-price">
                $67<span>/month</span>
              </div>
              <p>
                The community is $67/month.
                <br />
                The software alone is $67/month.
              </p>
              <div className="resource-community-included">
                <span>✓ Full ACA platform</span>
                <span>✓ Weekly operator calls</span>
                <span>✓ Playbooks & AI agents</span>
                <span>✓ Direct support</span>
              </div>
              <p className="resource-community-offer__note">
                Get the software and help putting it to work for the same $67.
              </p>
            </div>
          </div>
        </section>

        <section className="resource-community-terms">
          <div className="wrap">
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "14px 34px",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {[
                "Built for agencies & founders",
                "$67/month membership",
                "Weekly live calls",
                "7-day refund",
                "30-day ROI guarantee",
                "Price rises at 150 members",
              ].map((t) => (
                <span
                  key={t}
                  style={{
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "#F6F2EA",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 9,
                  }}
                >
                  <i
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#F0734F",
                      display: "inline-block",
                    }}
                  />
                  {t}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 48 }}>
          <div className="wrap">
            <header className="sect-head sect-head--center">
              <span className="kicker">What you get</span>
              <h2 className="h-section">
                Launch your campaigns with{" "}
                <em>software, playbooks and support.</em>
              </h2>
              <p className="lead">
                Build your own acquisition process or deliver it for clients.
                Your membership includes the tools to run it, resources to set
                it up and help when you need an answer.
              </p>
            </header>
            <div className="feat-grid">
              {included.map((f) => (
                <div key={f.title} className="feat-card">
                  <h3>
                    {f.title}
                    <span className="dot">.</span>
                  </h3>
                  <ul>
                    <li>{f.body}</li>
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section--tight">
          <div className="wrap">
            <header className="sect-head">
              <span className="kicker">Compare what your $67 buys</span>
              <h2 className="h-section">
                Pay the software price. <em>Get the community included.</em>
              </h2>
            </header>
            <div className="compare">
              <table>
                <thead>
                  <tr>
                    <th>What you get</th>
                    <th>Software alone</th>
                    <th className="us">Community</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      "ACA: unlimited seats, leads, campaigns and content",
                      true,
                      true,
                    ],
                    ["Ready-to-use AI agents (Hermes + Claude)", false, true],
                    ["Client acquisition retainer playbooks", false, true],
                    ["Weekly operator calls", false, true],
                    ["Free GoHighLevel account + snapshot", false, true],
                    ["Direct support from the team", false, true],
                  ].map(([label, solo, comm]) => (
                    <tr key={label as string}>
                      <td className="row-label">{label}</td>
                      <td>
                        {solo ? (
                          <span className="yes">Included</span>
                        ) : (
                          <span className="no">-</span>
                        )}
                      </td>
                      <td className="us">
                        {comm ? (
                          <span className="yes">Included</span>
                        ) : (
                          <span className="no">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="row-label" style={{ fontWeight: 600 }}>
                      Price
                    </td>
                    <td>
                      <strong>$67/mo</strong>
                    </td>
                    <td className="us">
                      <strong>$67/mo</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="section section--tight">
          <div className="wrap">
            <header className="sect-head">
              <span className="kicker">Try the membership</span>
              <h2 className="h-section">
                Put it to work. <em>See the refund terms.</em>
              </h2>
            </header>
            <div className="aca-card-grid aca-card-grid--2">
              <div className="aca-card" style={{ padding: 24 }}>
                <span className="aca-card__title" style={{ fontSize: 20 }}>
                  7-day no-questions refund
                </span>
                <p style={{ marginTop: 10, color: "#6B6759", lineHeight: 1.6 }}>
                  Explore the software, playbooks and community. If the
                  membership isn't for you, email us within 7 days for a full
                  refund, no questions asked.
                </p>
              </div>
              <div className="aca-card" style={{ padding: 24 }}>
                <span className="aca-card__title" style={{ fontSize: 20 }}>
                  30-day ROI guarantee
                </span>
                <p style={{ marginTop: 10, color: "#6B6759", lineHeight: 1.6 }}>
                  Run one workflow. If it doesn't save you time or generate
                  leads or revenue within 30 days, request a refund under the
                  community's ROI guarantee.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section--ink cta">
          <div className="wrap">
            <span
              className="kicker"
              style={{
                background: "rgba(255,255,255,0.08)",
                borderColor: "rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.7)",
              }}
            >
              <i className="live-dot" /> Price increases at 150 members
            </span>
            <h2 className="h-section">
              Get ACA. Build your first campaign.
              <br />
              <em>Get help putting it to work.</em>
            </h2>
            <p className="cta__sub">
              The full platform, weekly calls, retainer playbooks, ready-to-use
              agents and direct support for $67/month. Bring your own API keys;
              provider subscriptions and usage are separate.
            </p>
            <div className="cta__btns">
              <a
                href={SKOOL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn--inverse btn--lg"
              >
                Get ACA + the community for $67/month →
              </a>
            </div>
            <p className="cta__sub">
              7-day refund and 30-day ROI guarantee. Full terms on the Skool
              join page.
            </p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
