import { Link } from "react-router-dom";
import { useState } from "react";
import { ArrowUpRight, Radar, Send, Wand2, Wrench } from "lucide-react";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import "@/styles/aca-home.css";
import "@/styles/marketing-resources.css";

const tools = [
  {
    slug: "icp-builder",
    name: "ICP Builder",
    desc: "Answer 8 questions, get a printable Notion ICP one-pager that actually fits one buyer.",
    cta: "Build my ICP",
    soon: true,
  },
  {
    slug: "spam-checker",
    name: "Cold Email Spam Score Checker",
    desc: "Paste any cold email. Get a deliverability score, the words tripping spam filters, and a rewrite.",
    cta: "Check my email",
    soon: true,
  },
  {
    slug: "tech-stack-detector",
    name: "Tech Stack Detector",
    desc: "Paste a domain. See the CRM, marketing tools, and outbound stack a company is running.",
    cta: "Detect a stack",
    soon: true,
  },
  {
    slug: "linkedin-roaster",
    name: "LinkedIn Headline Roaster",
    desc: "Drop your LinkedIn URL. Get a roast and a rewrite optimized for outbound replies.",
    cta: "Roast me",
    soon: true,
  },
  {
    slug: "creator-finder",
    name: "Creator Finder",
    desc: "Search a niche keyword. Get the top 50 creators across X, LinkedIn, YouTube, Instagram.",
    cta: "Find creators",
    soon: true,
  },
  {
    slug: "roi-calculator",
    name: "Outbound ROI Calculator",
    desc: "Plug in your tool stack costs and team time. See what ACA replaces and what you'd save monthly.",
    cta: "Calculate",
    soon: true,
  },
];

// Free agent guides and the three cold-traffic kits: real pages that need an
// internal link from somewhere crawlable (they were orphans in the site audit).
const agentGuides = [
  {
    to: "/free-hermes-linkedin-setter",
    name: "LinkedIn appointment setter",
    desc: "Hermes agent prompt and setup guide that books calls while you sleep.",
  },
  {
    to: "/free-google-maps-scraper",
    name: "Google Maps lead scraper",
    desc: "12 million businesses plus the scraper system that finds and verifies the owner's email.",
  },
  {
    to: "/free-buying-signals-agent",
    name: "Buying signals agent",
    desc: "Watches 428 sources for the signals you pick and tells you why to reach out.",
  },
  {
    to: "/free-lead-pipeline-agent",
    name: "Lead pipeline agent",
    desc: "Reads each lead's site and LinkedIn, keeps the fits, verifies the email.",
  },
  {
    to: "/free-sec-form4-agent",
    name: "SEC Form 4 agent",
    desc: "Catches insider stock sales the day they are filed, from free EDGAR data.",
  },
  {
    to: "/free-reddit-engagement-agent",
    name: "Reddit engagement agent",
    desc: "Finds the threads where buyers ask what to use and drafts human replies.",
  },
  {
    to: "/free-seo-growth-agent",
    name: "SEO growth agent",
    desc: "Writes content around what people search and goes and gets the backlinks.",
  },
  {
    to: "/free-youtube-automation-agent",
    name: "YouTube automation agent",
    desc: "A month of video scripts built to beat what already ranks in your niche.",
  },
  {
    to: "/free-carousel-factory-agent",
    name: "Carousel factory agent",
    desc: "Turns a link into an on-brand carousel and posts it everywhere.",
  },
  {
    to: "/kit",
    name: "Local leads agent kit",
    desc: "Launch an AI agent that finds local business owners' emails.",
  },
  {
    to: "/studio",
    name: "Faceless channel agent kit",
    desc: "Research topics and script a month of videos for a faceless channel.",
  },
  {
    to: "/radar",
    name: "Buying signals agent kit",
    desc: "Find companies the week they are ready to buy.",
  },
];

const guideCategory = (path: string) => {
  if (/setter|reddit/.test(path)) return "Outreach";
  if (/seo|youtube|carousel|studio/.test(path)) return "Content";
  return "Lead generation";
};
const guideIcons = { "Lead generation": Radar, Outreach: Send, Content: Wand2 };

export default function Tools() {
  const [category, setCategory] = useState("All guides");
  const visibleGuides = agentGuides.filter(
    (guide) =>
      category === "All guides" || guideCategory(guide.to) === category,
  );
  return (
    <>
      <MarketingNav />
      <main className="aca-marketing mkt-page resource-page resource-tools">
        <section className="resource-hero">
          <div className="wrap resource-hero__split">
            <div>
              <span className="kicker">The operator's toolbox</span>
              <h1>
                Free AI agents for <em>leads, outreach and content.</em>
              </h1>
              <p className="lead">
                Free agent guides and practical kits for finding leads, starting
                conversations and producing content. Pick the job you need done.
              </p>
              <a href="#agent-guides" className="btn btn--primary btn--lg">
                Find my next guide <ArrowUpRight size={18} />
              </a>
            </div>
            <div className="resource-toolbox-art">
              <img
                src="/media/acquisition-world/content-studio-v1.webp"
                alt="ACA fox working in an illustrated content studio"
                width={1536}
                height={1024}
              />
              <span>Ideas → workflows → work you can ship</span>
            </div>
          </div>
        </section>
        <section className="section section--tight" id="agent-guides">
          <div className="wrap">
            <header className="resource-library-head">
              <div>
                <span className="kicker">Available now</span>
                <h2 className="h-section">Free agent guides.</h2>
              </div>
              <p>
                Start with a real guide.
                <br />
                Build the workflow from there.
              </p>
            </header>
            <div
              className="resource-filter"
              aria-label="Filter agent guides by job"
            >
              {["All guides", "Lead generation", "Outreach", "Content"].map(
                (item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={item === category}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>
            <p className="resource-result-count" aria-live="polite">
              {visibleGuides.length} guides
            </p>
            <div className="aca-card-grid resource-guide-grid">
              {visibleGuides.map((guide) => {
                const group = guideCategory(guide.to);
                const Icon = guideIcons[group];
                return (
                  <Link
                    key={guide.to}
                    to={guide.to}
                    className="aca-card resource-guide"
                  >
                    <div className="resource-guide__top">
                      <span
                        className={`resource-icon resource-icon--${group === "Content" ? "lilac" : group === "Outreach" ? "coral" : "teal"}`}
                      >
                        <Icon size={25} />
                      </span>
                      <span className="resource-label">{group}</span>
                    </div>
                    <h3 className="aca-card__title">{guide.name}</h3>
                    <p className="aca-card__excerpt">{guide.desc}</p>
                    <span className="resource-guide__cta">
                      Get the free guide <ArrowUpRight size={20} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
        <section className="section resource-coming-soon">
          <div className="wrap">
            <header className="resource-library-head">
              <div>
                <span className="kicker">In the workshop</span>
                <h2 className="h-section">More tools on the way.</h2>
              </div>
              <p>
                Six focused tools built on the engine behind ACA.
                <br />
                These previews are not yet available.
              </p>
            </header>
            <div className="aca-card-grid">
              {tools.map((tool) => (
                <article
                  key={tool.slug}
                  className="aca-card resource-tool-preview"
                >
                  <span className="resource-icon">
                    <Wrench size={23} />
                  </span>
                  <span className="aca-card__tag">Shipping soon</span>
                  <h3 className="aca-card__title">{tool.name}</h3>
                  <p className="aca-card__excerpt">{tool.desc}</p>
                  <span className="resource-tool-preview__status">
                    {tool.cta} · Coming soon
                  </span>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="section--ink cta">
          <div className="wrap">
            <span className="kicker">The connected workspace</span>
            <h2 className="h-section">
              Ready to run the <em>full system?</em>
            </h2>
            <p className="cta__sub">
              Bring leads, outreach, content and follow-up together in ACA.
            </p>
            <div className="cta__btns">
              <Link to="/get-started" className="btn btn--inverse btn--lg">
                Start for free →
              </Link>
              <Link to="/playbooks" className="btn btn--ghost btn--lg">
                Read a playbook
              </Link>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
