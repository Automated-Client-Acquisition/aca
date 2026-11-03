import { Link } from "react-router-dom";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { playbooks } from "@/data/playbooks";
import { useSEO } from "@/hooks/useSEO";
import "@/styles/aca-home.css";
import "@/styles/marketing-resources.css";

/**
 * /playbooks index - featured master + niche-personalization explainer.
 *
 * After the pivot: the canonical playbook is `/playbooks/2026-gtm-playbook`.
 * The 9 niche scaffolds are hidden until they're real content. The master
 * is the lead magnet; "your niche" is delivered by the personalization
 * engine (scrape site + LinkedIn -> custom Notion doc).
 */
export default function Playbooks() {
  const master = playbooks.find((p) => p.slug === "2026-gtm-playbook");

  const seoElement = useSEO({
    title: "Playbooks: the 2026 GTM stack, personalized to your business",
    description:
      "The 2026 B2B GTM playbook covering outreach, content, LinkedIn, and AI appointment booking. Personalized to your business via website + LinkedIn analysis. Free, delivered as a Notion doc.",
    canonical: "/playbooks",
    ogType: "website",
    ogImage: master?.ogImage,
    keywords: [
      "b2b gtm playbook 2026",
      "b2b outbound playbook",
      "linkedin outreach playbook",
      "ai appointment booking",
      "ACA playbooks",
    ],
  });

  if (!master) {
    return (
      <>
        <MarketingNav />
        <main className="aca-marketing mkt-page resource-page resource-playbooks">
          <section
            className="hero"
            style={{ paddingTop: 120, paddingBottom: 96 }}
          >
            <div className="wrap">
              <h1 className="h-hero">Playbooks coming soon.</h1>
            </div>
          </section>
        </main>
        <MarketingFooter />
      </>
    );
  }

  const chapters = master.chapters ?? [];

  return (
    <>
      {seoElement}
      <MarketingNav />
      <main className="aca-marketing mkt-page resource-page resource-playbooks">
        {/* Hero - featured master playbook */}
        <section className="pbi-hero">
          <div className="wrap">
            <div className="pbi-hero__grid">
              <div className="pbi-hero__copy">
                <span className="kicker">The 2026 GTM Playbook · Free</span>
                <h1 className="pbi-hero__h">
                  The operational B2B GTM stack,{" "}
                  <em>personalized to your business</em>.
                </h1>
                <p className="pbi-hero__sub">
                  One playbook covering everything: outreach, content, LinkedIn
                  distribution, and AI appointment booking. Submit your website
                  and LinkedIn, we generate the personalized Notion doc in 5
                  minutes.
                </p>
                <div className="pbi-hero__cta-row">
                  <Link
                    to={`/playbooks/${master.slug}`}
                    className="btn btn--primary btn--lg"
                  >
                    Read the playbook <span className="arrow">→</span>
                  </Link>
                  <span className="pbi-hero__note">
                    {chapters.length} chapters · {master.readTime} · updated{" "}
                    {master.lastUpdated
                      ? new Date(master.lastUpdated).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric", year: "numeric" },
                        )
                      : ""}
                  </span>
                </div>
                <p className="pbi-hero__proof">{master.proofLine}</p>
              </div>
              <div className="pbi-hero__cover">
                <div className="resource-book-label">
                  <span>ACA / FIELD GUIDE</span>
                  <span>2026 EDITION</span>
                </div>
                <div className="pbi-hero__cover-frame">
                  <img
                    src={master.ogImage || "/og-image-v2.png"}
                    alt={`Cover for ${master.headline}`}
                    width={1200}
                    height={630}
                    loading="eager"
                    decoding="async"
                  />
                </div>
                <div className="resource-book-caption">
                  <span>Outreach · Content · LinkedIn · AI agents</span>
                  <span>{chapters.length} chapters</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What's inside - chapter outline */}
        {chapters.length > 0 && (
          <section className="pbi-outline">
            <div className="wrap">
              <header className="pbi-outline__head">
                <span className="kicker">What's inside</span>
                <h2 className="pbi-outline__h">
                  {chapters.length} chapters, written in the order a GTM lead
                  would <em>actually run them</em>.
                </h2>
              </header>
              <ol className="pbi-outline__list">
                {chapters.map((ch) => (
                  <li key={ch.number} className="pbi-outline__item">
                    <Link
                      to={`/playbooks/${master.slug}#chapter-${ch.number}`}
                      className="pbi-outline__link"
                    >
                      <span className="pbi-outline__num">
                        {String(ch.number).padStart(2, "0")}
                      </span>
                      <span className="pbi-outline__body">
                        <span className="pbi-outline__title">{ch.title}</span>
                        {ch.intro && (
                          <span className="pbi-outline__intro">{ch.intro}</span>
                        )}
                      </span>
                      <span className="pbi-outline__arrow" aria-hidden>
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* How playbooks work - the credibility frame */}
        <section className="pbi-howitworks">
          <div className="wrap">
            <header className="pbi-howitworks__head">
              <span className="kicker">How this works</span>
              <h2 className="pbi-howitworks__h">
                Three things this isn't, <em>and one it is</em>.
              </h2>
            </header>
            <div className="pbi-howitworks__grid">
              <div className="pbi-howitworks__col pbi-howitworks__col--no">
                <span className="pbi-howitworks__lab">It isn't</span>
                <ul>
                  <li>A framework you have to translate into a plan.</li>
                  <li>An article with vague best-practice advice.</li>
                  <li>A list of tools and tactics from 2019.</li>
                </ul>
              </div>
              <div className="pbi-howitworks__col pbi-howitworks__col--yes">
                <span className="pbi-howitworks__lab">It is</span>
                <ul>
                  <li>The operational plan, day 1 to day 90.</li>
                  <li>
                    The list spec, the sequence, the scripts, the templates, the
                    trigger rules.
                  </li>
                  <li>
                    Wired to ACA, so you run the plan and the AI agents do the
                    work.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
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
              <i className="live-dot" /> Ready when you are
            </span>
            <h2 className="h-section">
              Read the playbook. <em>Get the personalized version.</em>
            </h2>
            <p className="cta__sub">
              {chapters.length} chapters, {master.readTime}. Then submit your
              URLs and we generate your custom Notion doc.
            </p>
            <div className="cta__btns">
              <Link
                to={`/playbooks/${master.slug}`}
                className="btn btn--inverse btn--lg"
              >
                Read the playbook →
              </Link>
              <Link
                to="/pricing"
                className="btn btn--ghost btn--lg"
                style={{
                  background: "transparent",
                  borderColor: "rgba(255,255,255,0.3)",
                  color: "#fff",
                }}
              >
                See ACA pricing
              </Link>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
