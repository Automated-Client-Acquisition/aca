import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { getPlaybook, playbooks } from "@/data/playbooks";
import {
  OfferOnePagerMock,
  ICPBuilderMock,
  ComposerMock,
  CalendarMock,
  MRRTickerMock,
  NotionPlaybookMock,
  SavedFilterMock,
  CampaignBuilderMock,
  UniboxMock,
} from "@/components/PlaybookMocks";
import { PlaybookLeadGen } from "@/components/PlaybookLeadGen";
import { useSEO } from "@/hooks/useSEO";
import { StructuredData } from "@/components/seo/StructuredData";
import { ArrowLeft, Check, X as XIcon } from "lucide-react";
import "@/styles/aca-home.css";
import "@/styles/marketing-continuity.css";

const FIGURES: Record<string, Record<number, { cap: string; render: () => JSX.Element }>> = {
  "ai-agency-10k-mrr": {
    0: { cap: "Fig. 01 · Your offer one-pager", render: () => <OfferOnePagerMock /> },
    1: { cap: "Fig. 02 · The list, filtered by ICP + signals", render: () => <ICPBuilderMock /> },
    2: { cap: "Fig. 03 · A draft, in your voice, referencing real signals", render: () => <ComposerMock /> },
    3: { cap: "Fig. 04 · Demos on your calendar, booked in-thread", render: () => <CalendarMock /> },
    4: { cap: "Fig. 05 · 4 retainers × $2,500 = $10,000 MRR", render: () => <MRRTickerMock /> },
    5: { cap: "Fig. 06 · A Notion workspace per client, ACA-synced", render: () => <NotionPlaybookMock /> },
  },
};

/* Industry-agnostic figures for the master playbook chapters. Keyed by chapter number.
   Updated for chronological 10-chapter structure: ICP=ch4, Messages+Campaign=ch7, Inbox=ch8. */
const CHAPTER_FIGURES: Record<number, { cap: string; tag: string; render: () => JSX.Element }> = {
  4: { cap: "Saved Filter · ICP + buyer signals", tag: "ACA · Leads", render: () => <SavedFilterMock /> },
  7: { cap: "Visual Campaign Builder · 5-touch sequence", tag: "ACA · Campaigns", render: () => <CampaignBuilderMock /> },
  8: { cap: "Unibox · AI Replier handling 80% in-thread", tag: "ACA · Unibox", render: () => <UniboxMock /> },
};

function autoEmph(s: string) {
  const star = s.match(/^(.*?)\*(.+?)\*(.*)$/);
  if (star) return { before: star[1], emph: star[2], after: star[3].replace(/[.!?]+$/, "") };
  const cleaned = s.replace(/[.!?]+$/, "");
  const words = cleaned.split(/\s+/);
  if (words.length <= 2) return { before: "", emph: cleaned, after: "" };
  return { before: words.slice(0, -2).join(" ") + " ", emph: words.slice(-2).join(" "), after: "" };
}

// Sticky right-rail Table of Contents for the master playbook chapters.
// Uses IntersectionObserver to highlight the chapter currently in view.
function PlaybookTOC({ chapters }: { chapters: NonNullable<ReturnType<typeof getPlaybook>>["chapters"] }) {
  const [activeChapter, setActiveChapter] = useState<number | null>(null);

  useEffect(() => {
    if (!chapters || chapters.length === 0) return;

    const observers: IntersectionObserver[] = [];
    const elements: HTMLElement[] = [];

    chapters.forEach((ch) => {
      const el = document.getElementById(`chapter-${ch.number}`);
      if (!el) return;
      elements.push(el);
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setActiveChapter(ch.number);
            }
          });
        },
        { rootMargin: "-30% 0px -60% 0px", threshold: 0 }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => {
      observers.forEach((o) => o.disconnect());
    };
  }, [chapters]);

  if (!chapters || chapters.length === 0) return null;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, n: number) => {
    e.preventDefault();
    const el = document.getElementById(`chapter-${n}`);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  return (
    <aside className="pb-toc" aria-label="Chapter navigation">
      <div className="pb-toc__inner">
        <span className="pb-toc__kicker">Contents</span>
        <ol className="pb-toc__list">
          {chapters.map((ch) => (
            <li
              key={ch.number}
              className={"pb-toc__item" + (activeChapter === ch.number ? " is-active" : "")}
            >
              <a href={`#chapter-${ch.number}`} onClick={(e) => handleClick(e, ch.number)}>
                <span className="pb-toc__num">{String(ch.number).padStart(2, "0")}</span>
                <span className="pb-toc__title">{ch.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

export default function Playbook() {
  const { slug } = useParams<{ slug: string }>();
  const p = slug ? getPlaybook(slug) : undefined;
  const [leadGenOpen, setLeadGenOpen] = useState(false);
  const [stickyVisible, setStickyVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setStickyVisible(window.scrollY > 800);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const seoElement = useSEO({
    title: p?.seoTitle || p?.headline || "Playbook",
    description: p?.seoDescription || (p ? `${p.outcome} · ${p.niche}. ${p.hook.slice(0, 110)}…` : undefined),
    canonical: p ? `/playbooks/${p.slug}` : undefined,
    ogType: "article",
    ogImage: p?.ogImage,
    keywords: p?.seoKeyword ? [p.seoKeyword, p.niche, "B2B outbound", "ACA"] : undefined,
  });

  if (!p) {
    return (
      <>
        <MarketingNav />
        <main className="aca-marketing mkt-page mkt-playbook">
          <section className="hero" style={{ paddingTop: 120, paddingBottom: 120 }}>
            <div className="wrap">
              <div className="hero__top">
                <h1 className="h-hero">Playbook <em>not found<span className="dot">.</span></em></h1>
                <Link to="/playbooks" className="btn btn--ghost btn--lg">
                  <ArrowLeft className="w-4 h-4" /> All playbooks
                </Link>
              </div>
            </div>
          </section>
        </main>
        <MarketingFooter />
      </>
    );
  }

  const others = playbooks.filter((x) => x.slug !== p.slug && !x.scaffolded).slice(0, 3);
  const emp = autoEmph(p.headline);
  const midSplit = Math.min(3, Math.floor(p.steps.length / 2));

  return (
    <>
      {seoElement}
      <StructuredData type="BreadcrumbList" items={[
        { name: "Home", url: "https://www.automatedclientacquisition.com/" },
        { name: "Playbooks", url: "https://www.automatedclientacquisition.com/playbooks" },
        { name: p.question, url: `https://www.automatedclientacquisition.com/playbooks/${p.slug}` },
      ]} />
      {p.datePublished && (
        <StructuredData
          type="Article"
          headline={p.seoTitle || p.headline}
          description={p.seoDescription || p.subhead || p.hook.slice(0, 240)}
          datePublished={p.datePublished}
          dateModified={p.lastUpdated || p.datePublished}
          url={`https://www.automatedclientacquisition.com/playbooks/${p.slug}`}
          articleSection="Playbooks"
          keywords={p.seoKeyword ? [p.seoKeyword, p.niche] : [p.niche]}
        />
      )}
      {p.steps.length > 0 && (
        <StructuredData
          type="HowTo"
          name={p.headline}
          description={p.subhead || p.hook.slice(0, 240)}
          steps={p.steps.map((s) => ({ name: s.title.replace(/\.$/, ""), text: s.directAnswer || s.body }))}
        />
      )}
      {p.faq && p.faq.length > 0 && (
        <StructuredData type="FAQPage" faqs={p.faq.map((f) => ({ question: f.q, answer: f.a }))} />
      )}

      <MarketingNav />
      <main className="aca-marketing mkt-page mkt-playbook">
        {/* Header / hero - conversion-first layout.
            Left: short benefit-driven copy + 3-stat proof strip + trust line.
            Right: focused conversion card leading with VALUE, not metadata. */}
        <section className="pb-spec">
          <div className="wrap">
            <Link to="/playbooks" className="pb-spec__back">
              <ArrowLeft className="w-3 h-3" /> All playbooks
            </Link>
            <div className="pb-spec__grid">
              <div className="pb-spec__main">
                <span className="kicker">The 2026 GTM Playbook · Operational</span>
                <h1 className="pb-spec__h1">
                  {emp.before}<em>{emp.emph}</em>{emp.after}<span className="dot">.</span>
                </h1>
                {p.subhead && (
                  <p className="pb-spec__subhead" style={{ fontSize: 19, lineHeight: 1.5, color: "var(--ink-muted, #4a4a48)", margin: "0 0 24px 0", fontStyle: "normal" }}>
                    {p.subhead}
                  </p>
                )}

                {/* 3-stat proof strip - the core math behind the pitch, surfaced above the fold */}
                {p.byTheNumbers && p.byTheNumbers.length === 3 && (
                  <div className="pb-spec__stats">
                    {p.byTheNumbers.map((s, i) => (
                      <div key={i} className="pb-spec__stat">
                        <span className="pb-spec__stat-value">{s.value}</span>
                        <span className="pb-spec__stat-label">{s.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {p.proofLine && (
                  <p className="pb-spec__proof">
                    <span className="pb-spec__proof-author">{p.proofLine.split(".")[0]}.</span>
                    <span className="pb-spec__proof-rest">{p.proofLine.split(".").slice(1).join(".").trim()}</span>
                  </p>
                )}
              </div>

              <aside className="pb-spec__meta">
                <span className="pb-spec__cta-kicker">Built for your business · not a template</span>
                <h2 className="pb-spec__cta-h2">Drop your URLs. Get <em>your</em> playbook in 5 minutes.</h2>
                <p className="pb-spec__cta-sub">
                  ACA scrapes your website + LinkedIn, then writes a 10,000-word Notion playbook configured for <em>your</em> offer, audience, voice, and stage. Different from every other reader's.
                </p>

                <button type="button" className="pb-spec__cta" onClick={() => setLeadGenOpen(true)}>
                  Build my playbook free
                  <span className="pb-spec__cta-arrow" aria-hidden>→</span>
                </button>
                <span className="pb-spec__note">5 min · No credit card · Custom doc, not a template</span>

                <div className="pb-spec__meta-strip">
                  <div className="pb-spec__meta-row">
                    <span className="pb-spec__meta-lab">Outcome</span>
                    <span className="pb-spec__meta-val">{p.outcome}</span>
                  </div>
                  <div className="pb-spec__meta-row">
                    <span className="pb-spec__meta-lab">Length</span>
                    <span className="pb-spec__meta-val">
                      {p.chapters && p.chapters.length > 0
                        ? `${p.chapters.length} chapters · ${p.readTime}`
                        : `${p.steps.length} steps · ${p.readTime}`}
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* Deliverable preview - shown only for chapter-based master.
            Sits right after the hero so readers see the "what you get" before committing to scroll. */}
        {p.chapters && p.chapters.length > 0 && (
          <section className="pb-deliverable">
            <div className="wrap">
              <div className="pb-deliverable__inner">
                <div className="pb-deliverable__copy">
                  <span className="kicker pb-deliverable__kicker">What lands in your inbox</span>
                  <h2 className="pb-deliverable__h">
                    A custom 10,000-word Notion doc, <em>written for your business specifically</em>.
                  </h2>
                  <p className="pb-deliverable__sub">
                    Two URLs in - your website and your LinkedIn - one custom playbook out. Not a template with your name swapped in; different from every other reader's. Here's exactly what gets read, and what changes for you:
                  </p>

                  {/* Personalization breakdown - explicit proof that this is real custom work,
                      not a generic template. Shows inputs → outputs side by side so readers
                      can SEE the customization happening. */}
                  <div className="pb-deliverable__perso">
                    <div className="pb-deliverable__perso-col">
                      <span className="pb-deliverable__perso-lab">What we read</span>
                      <ul>
                        <li>Your homepage (offer, positioning)</li>
                        <li>Your services / pricing pages</li>
                        <li>Your About + team pages</li>
                        <li>Your recent blog posts</li>
                        <li>Your LinkedIn headline + profile</li>
                        <li>Your last 30 LinkedIn posts (voice)</li>
                      </ul>
                    </div>
                    <div className="pb-deliverable__perso-col">
                      <span className="pb-deliverable__perso-lab">What changes for you</span>
                      <ul>
                        <li>The playbook title (matches your business)</li>
                        <li>The ICP (your specific buyers)</li>
                        <li>The 6 message templates (in your voice)</li>
                        <li>The trigger signals (for your niche)</li>
                        <li>The content angles (for your audience)</li>
                        <li>The 30-day plan (your stage, your math)</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <ul className="pb-deliverable__list">
                  <li><span className="pb-deliverable__bullet">→</span><span><strong>The buyers most likely to say yes to you</strong>, identified from your website + LinkedIn - the exact 2-3 signals that predict purchase intent in your niche</span></li>
                  <li><span className="pb-deliverable__bullet">→</span><span><strong>30-50 in-market prospects per day</strong>, automatically - your saved-filter spec for ACA's preloaded B2B contact index</span></li>
                  <li><span className="pb-deliverable__bullet">→</span><span><strong>The 6 messages that get prospects to reply 'send it'</strong>, written in your voice (10-day cadence) - the same lead-magnet mechanic that lifts booked-call rate ~70% in our customer data</span></li>
                  <li><span className="pb-deliverable__bullet">→</span><span><strong>The Generator that builds a 10k-word playbook per prospect in 5 minutes</strong> - pre-configured with your knowledge base, your case studies, your voice</span></li>
                  <li><span className="pb-deliverable__bullet">→</span><span><strong>4 LinkedIn posts per week that compound your outbound</strong> - content blueprint with formats and topic angles for your niche</span></li>
                  <li><span className="pb-deliverable__bullet">→</span><span><strong>Replies handled while you sleep</strong> - Unibox AI Replier qualifying prompt + Lead-to-Comment trigger rules calibrated to your offer</span></li>
                  <li><span className="pb-deliverable__bullet">→</span><span><strong>Your day 1 to day 30 launch plan</strong> - adjusted for your stage and starting point, with the daily checklist</span></li>
                </ul>
                <div className="pb-deliverable__cta-row">
                  <button
                    type="button"
                    className="pb-deliverable__btn"
                    onClick={() => setLeadGenOpen(true)}
                  >
                    Build my custom playbook
                    <span className="pb-deliverable__btn-arrow">→</span>
                  </button>
                  <span className="pb-deliverable__note">Free · 5 min · Custom doc, not a template</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TL;DR + by-the-numbers - combined band, 2-column layout that mirrors the chapter section's main+rail rhythm */}
        {(p.tldr || (p.byTheNumbers && p.byTheNumbers.length > 0)) && (
          <section className="pb-summary">
            <div className="wrap">
              <div className="pb-summary__layout">
                {p.tldr && (
                  <div className="pb-summary__main tldr direct-answer">
                    <span className="pb-summary__kicker">TL;DR · The short answer</span>
                    <p className="pb-summary__text">{p.tldr}</p>
                  </div>
                )}
                {p.byTheNumbers && p.byTheNumbers.length > 0 && (
                  <aside className="pb-summary__rail" aria-label="By the numbers">
                    <span className="pb-summary__kicker pb-summary__kicker--rail">By the numbers</span>
                    <div className="pb-summary__stats">
                      {p.byTheNumbers.map((stat, i) => (
                        <div key={i} className="pb-summary__stat">
                          <div className="pb-summary__stat-label">{stat.label}</div>
                          <div className="pb-summary__stat-value">{stat.value}</div>
                          {stat.context && <div className="pb-summary__stat-context">{stat.context}</div>}
                        </div>
                      ))}
                    </div>
                  </aside>
                )}
              </div>
            </div>
          </section>
        )}

        {/* What you'll learn - hidden for chapter-based playbooks since the TOC duplicates this */}
        {p.whatYoullLearn && p.whatYoullLearn.length > 0 && !(p.chapters && p.chapters.length > 0) && (
          <section className="pb-takeaways" style={{ padding: "64px 0", borderTop: "1px solid var(--line)" }}>
            <div className="wrap">
              <div style={{ maxWidth: 820 }}>
                <header className="sect-head" style={{ marginBottom: 28 }}>
                  <span className="kicker">What you'll walk away with</span>
                  <h2 className="h-section">By the end you'll <em>know exactly</em>.</h2>
                </header>
                <ul className="pb-takeaways__list" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
                  {p.whatYoullLearn.map((x, i) => (
                    <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", border: "1px solid var(--line)", borderRadius: 10, background: "rgba(255,255,255,0.5)" }}>
                      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "var(--accent)", color: "white", display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                        <Check className="w-3 h-3" />
                      </span>
                      <span style={{ fontSize: 15, lineHeight: 1.5 }}>{x}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* Who for / not for - hidden for chapter-based playbooks (chapters carry the qualifier) */}
        {(p.whoFor || p.whoNotFor) && !(p.chapters && p.chapters.length > 0) && (
          <section className="pb-qual" style={{ padding: "64px 0", borderTop: "1px solid var(--line)" }}>
            <div className="wrap">
              <div style={{ maxWidth: 820, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 32 }}>
                {p.whoFor && p.whoFor.length > 0 && (
                  <div>
                    <span className="kicker" style={{ marginBottom: 12, display: "block" }}>This is for you if...</span>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                      {p.whoFor.map((x, i) => (
                        <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 15, lineHeight: 1.5 }}>
                          <Check className="w-4 h-4" style={{ color: "var(--accent)", marginTop: 4, flexShrink: 0 }} />
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.whoNotFor && p.whoNotFor.length > 0 && (
                  <div>
                    <span className="kicker" style={{ marginBottom: 12, display: "block" }}>Skip this if...</span>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                      {p.whoNotFor.map((x, i) => (
                        <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 15, lineHeight: 1.5, opacity: 0.85 }}>
                          <XIcon className="w-4 h-4" style={{ color: "var(--ink-muted, #888)", marginTop: 4, flexShrink: 0 }} />
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Why default fails - hidden for chapter-based playbooks (chapter 1 covers it) */}
        {p.whyItFails && !(p.chapters && p.chapters.length > 0) && (
          <section className="pb-fail">
            <div className="wrap">
              <div className="pb-fail__inner">
                <span className="kicker pb-fail__kicker">Anti-pattern</span>
                <h2 className="pb-fail__h2">Why the default fails<span className="dot">.</span></h2>
                <p className="pb-fail__body">{p.whyItFails}</p>
              </div>
            </div>
          </section>
        )}

        {/* Social proof - testimonial.to embed. Renders only for chapter-based playbooks
            (master only) where cold-traffic credibility matters most before a 9k-word commitment. */}
        {p.chapters && p.chapters.length > 0 && (
          <section className="pb-testimonials">
            <div className="wrap">
              <header className="pb-testimonials__head">
                <span className="kicker">What operators say</span>
                <h2 className="pb-testimonials__h">Run by real teams, for real pipeline<span className="dot">.</span></h2>
              </header>
              <div className="pb-testimonials__embed">
                <iframe
                  id="testimonialto-d480ab18-cdbc-4287-b12e-e0450be1bab8"
                  src="https://embed-v2.testimonial.to/w/automated-client-acquisition?id=d480ab18-cdbc-4287-b12e-e0450be1bab8"
                  frameBorder="0"
                  scrolling="no"
                  width="100%"
                  height="800"
                  title="ACA testimonials"
                  loading="lazy"
                />
              </div>
            </div>
          </section>
        )}

        {/* Chapters - long-form master playbook with sticky TOC right-rail */}
        {p.chapters && p.chapters.length > 0 && (
          <section className="pb-chapters">
            <div className="wrap">
              <div className="pb-chapters__layout">
                <div className="pb-chapters__main">
                  {p.chapters.map((ch, i) => (
                    <article
                      key={ch.number}
                      id={`chapter-${ch.number}`}
                      className="pb-chapter"
                      data-chapter={ch.number}
                    >
                      <header className="pb-chapter__head">
                        <div className="pb-chapter__num" aria-hidden="true">
                          <span>{String(ch.number).padStart(2, "0")}</span>
                        </div>
                        <div className="pb-chapter__head-text">
                          <span className="pb-chapter__kicker">Chapter {ch.number} of {p.chapters!.length}</span>
                          <h2 className="pb-chapter__title">{ch.title}</h2>
                        </div>
                      </header>
                      {ch.intro && (
                        <aside className="pb-chapter__tldr" aria-label={`TL;DR for chapter ${ch.number}`}>
                          <span className="pb-chapter__tldr-label">TL;DR</span>
                          <p className="pb-chapter__tldr-text">{ch.intro}</p>
                        </aside>
                      )}
                      {CHAPTER_FIGURES[ch.number] && (
                        <figure className="pb-chapter__figure">
                          <figcaption className="pb-chapter__figure-cap">
                            <b>{CHAPTER_FIGURES[ch.number].cap}</b>
                            <span className="pb-chapter__figure-cap-tag">{CHAPTER_FIGURES[ch.number].tag}</span>
                          </figcaption>
                          {CHAPTER_FIGURES[ch.number].render()}
                        </figure>
                      )}
                      <div className="pb-chapter__body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {ch.markdown}
                        </ReactMarkdown>
                      </div>
                      {ch.takeaway && (
                        <aside className="pb-chapter__takeaway">
                          <strong>Takeaway</strong>
                          {ch.takeaway}
                        </aside>
                      )}
                      {/* Single inline mid-page CTA at the strongest conversion moment -
                          after ch7, once the reader has seen the campaign come together. */}
                      {ch.number === 7 && (
                        <div className="pb-chapter__cta">
                          <div className="pb-chapter__cta-copy">
                            <span className="pb-chapter__cta-kicker">Skip writing the messages from scratch</span>
                            <h3 className="pb-chapter__cta-h">
                              The 6-touch lead-magnet sequence written in your voice, ready to <em>drop into Campaigns</em>.
                            </h3>
                            <p className="pb-chapter__cta-sub">
                              We scrape your website + LinkedIn, generate a Notion doc personalized to you in 5 minutes. Free, no credit card.
                            </p>
                          </div>
                          <button
                            type="button"
                            className="pb-chapter__cta-btn"
                            onClick={() => setLeadGenOpen(true)}
                          >
                            Get my personalized playbook →
                          </button>
                        </div>
                      )}
                      {i < p.chapters!.length - 1 && (
                        <div className="pb-chapter__divider" aria-hidden="true">
                          <span></span>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
                <PlaybookTOC chapters={p.chapters} />
              </div>
            </div>
          </section>
        )}

        {/* Steps - split with mid-page CTA */}
        {p.steps.length > 0 && (
          <section className="pb-run">
            <div className="wrap">
              <header className="sect-head">
                <span className="kicker">The {p.steps.length}-step plan</span>
                <h2 className="h-section">Run it <em>step by step</em>.</h2>
              </header>
              <ol className="pb-steps">
                {p.steps.slice(0, midSplit).map((s, i) => {
                  const e = autoEmph(s.title);
                  return (
                    <li key={i} className="pb-step">
                      <div className="pb-step__rail">
                        <span className="pb-step__num">{String(i + 1).padStart(2, "0")}</span>
                      </div>
                      <div className="pb-step__body">
                        <div className="pb-step__head">
                          <span className="pb-step__day">{s.day}</span>
                          <h3 className="pb-step__title">{e.before}<em>{e.emph}</em>{e.after}.</h3>
                        </div>
                        {s.directAnswer && (
                          <blockquote className="pb-step__pull direct-answer" style={{ margin: "0 0 16px 0", padding: "14px 18px", maxWidth: 720, borderLeft: "3px solid var(--accent, #D4361A)", background: "rgba(212,54,26,0.04)", fontSize: 16, lineHeight: 1.5, fontStyle: "italic", color: "var(--ink, #1a1a1a)", borderRadius: "0 8px 8px 0" }}>
                            {s.directAnswer}
                          </blockquote>
                        )}
                        <p className="pb-step__detail">{s.body}</p>
                        <div className="pb-step__foot">
                          {s.artifact && (
                            <span className="pb-step__chip pb-step__chip--artifact">
                              <span className="pb-step__chip-lab">Artifact</span>
                              {s.artifact}
                            </span>
                          )}
                          <span className="pb-step__chip pb-step__chip--aca">
                            <span className="pb-step__chip-lab">ACA does this</span>
                            Auto
                          </span>
                        </div>
                        {FIGURES[p.slug]?.[i] && (
                          <div className="pbm-figure">
                            <div className="pbm-figure__cap"><b>{FIGURES[p.slug][i].cap.split(" · ")[0]}</b> · {FIGURES[p.slug][i].cap.split(" · ").slice(1).join(" · ")}</div>
                            {FIGURES[p.slug][i].render()}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>

              {/* Mid-page CTA - keep scrollers engaged */}
              {midSplit > 0 && (
                <div className="pb-mid-cta" style={{ margin: "48px 0", padding: "28px 32px", borderRadius: 14, background: "linear-gradient(135deg, rgba(212,54,26,0.06), rgba(212,54,26,0.02))", border: "1px solid rgba(212,54,26,0.18)", display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
                  {p.midPageHook && <p style={{ fontSize: 17, lineHeight: 1.5, margin: 0, fontWeight: 500 }}>{p.midPageHook}</p>}
                  <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                    <button type="button" className="pb-spec__cta" onClick={() => setLeadGenOpen(true)} style={{ marginTop: 0 }}>
                      Skip the read · get my personalized version →
                    </button>
                    <span style={{ fontSize: 13, color: "var(--ink-muted, #6a6a68)" }}>Or keep reading - the next steps below.</span>
                  </div>
                </div>
              )}

              {/* Remaining steps */}
              <ol className="pb-steps" start={midSplit + 1}>
                {p.steps.slice(midSplit).map((s, idx) => {
                  const i = midSplit + idx;
                  const e = autoEmph(s.title);
                  return (
                    <li key={i} className="pb-step">
                      <div className="pb-step__rail">
                        <span className="pb-step__num">{String(i + 1).padStart(2, "0")}</span>
                      </div>
                      <div className="pb-step__body">
                        <div className="pb-step__head">
                          <span className="pb-step__day">{s.day}</span>
                          <h3 className="pb-step__title">{e.before}<em>{e.emph}</em>{e.after}.</h3>
                        </div>
                        {s.directAnswer && (
                          <blockquote className="pb-step__pull direct-answer" style={{ margin: "0 0 16px 0", padding: "14px 18px", maxWidth: 720, borderLeft: "3px solid var(--accent, #D4361A)", background: "rgba(212,54,26,0.04)", fontSize: 16, lineHeight: 1.5, fontStyle: "italic", color: "var(--ink, #1a1a1a)", borderRadius: "0 8px 8px 0" }}>
                            {s.directAnswer}
                          </blockquote>
                        )}
                        <p className="pb-step__detail">{s.body}</p>
                        <div className="pb-step__foot">
                          {s.artifact && (
                            <span className="pb-step__chip pb-step__chip--artifact">
                              <span className="pb-step__chip-lab">Artifact</span>
                              {s.artifact}
                            </span>
                          )}
                          <span className="pb-step__chip pb-step__chip--aca">
                            <span className="pb-step__chip-lab">ACA does this</span>
                            Auto
                          </span>
                        </div>
                        {FIGURES[p.slug]?.[i] && (
                          <div className="pbm-figure">
                            <div className="pbm-figure__cap"><b>{FIGURES[p.slug][i].cap.split(" · ")[0]}</b> · {FIGURES[p.slug][i].cap.split(" · ").slice(1).join(" · ")}</div>
                            {FIGURES[p.slug][i].render()}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        )}

        {/* FAQ - objection handling + SEO */}
        {p.faq && p.faq.length > 0 && (
          <section className="pb-faq" style={{ borderTop: "1px solid var(--line)", padding: "64px 0" }}>
            <div className="wrap">
              <div style={{ maxWidth: 820, margin: "0 auto" }}>
                <header className="sect-head" style={{ marginBottom: 32 }}>
                  <span className="kicker">FAQ</span>
                  <h2 className="h-section">The questions <em>everyone asks</em>.</h2>
                </header>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {p.faq.map((f, i) => (
                    <details key={i} style={{ borderTop: "1px solid var(--line)", padding: "20px 0", cursor: "pointer" }}>
                      <summary style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.4, listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, cursor: "pointer" }}>
                        <span>{f.q}</span>
                        <span style={{ flexShrink: 0, fontSize: 24, lineHeight: 1, color: "var(--ink-muted, #6a6a68)", marginTop: -2 }}>+</span>
                      </summary>
                      <p style={{ fontSize: 15, lineHeight: 1.55, marginTop: 12, color: "var(--ink-muted, #4a4a48)" }}>{f.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Pricing rationale - sits between FAQ and dark CTA, only for chapter-based master.
            The reader has read 9k words of value; this is when pricing-model talk is fair. */}
        {p.chapters && p.chapters.length > 0 && (
          <section className="pb-pricing-rationale">
            <div className="wrap">
              <div className="pb-pricing-rationale__inner">
                <header className="pb-pricing-rationale__head">
                  <span className="kicker">Pricing structure</span>
                  <h2 className="pb-pricing-rationale__h">
                    Flat pricing is the unlock, <em>not the saving</em>.
                  </h2>
                  <p className="pb-pricing-rationale__sub">
                    The 2022 GTM stack was not slow because the channels were tapped out. It was slow because the pricing models punished scaling. Per-seat tools charged another full seat fee for every additional sender. Per-credit tools metered every additional research call or message. Per-tier tools forced an upgrade once daily volume crossed a threshold. So operators throttled themselves into mediocrity, then concluded "outbound is dead."
                  </p>
                </header>

                <div className="pb-pricing-rationale__models">
                  <div className="pb-pricing-rationale__model pb-pricing-rationale__model--bad">
                    <span className="pb-pricing-rationale__model-lab">Pricing models that punish scale</span>
                    <ul>
                      <li><strong>Per-seat:</strong> add a rep, pay another full seat. Blocks team expansion, blocks adding LinkedIn accounts, blocks running parallel campaigns.</li>
                      <li><strong>Per-credit:</strong> every research call, every enrichment, every signal lookup hits a credit meter that runs out mid-month and forces an upgrade.</li>
                      <li><strong>Tiered by volume:</strong> hit a daily-send threshold, get bumped to the next tier where the price step is bigger than the volume increase.</li>
                      <li><strong>Per-inbox:</strong> some specialized providers charge per inbox, which punishes the exact scaling move (more inboxes = more deliverability headroom) the playbook depends on.</li>
                    </ul>
                  </div>
                  <div className="pb-pricing-rationale__model pb-pricing-rationale__model--good">
                    <span className="pb-pricing-rationale__model-lab">ACA Operator: $67/month flat</span>
                    <ul>
                      <li><strong>Unlimited LinkedIn accounts.</strong> Add a second, fifth, tenth at no extra cost.</li>
                      <li><strong>Unlimited mailboxes.</strong> BYO M365 tenant or specialized provider; ACA charges nothing for the inbox count.</li>
                      <li><strong>Unlimited leads</strong> from the preloaded B2B contact index. No per-search credits, no per-export caps.</li>
                      <li><strong>All 6 AI agents included.</strong> Researcher, Writer, Sender, Personalized Playbook Generator, Replier, Scheduler. No per-message fees.</li>
                    </ul>
                  </div>
                </div>

                <p className="pb-pricing-rationale__close">
                  Flat pricing unlocks the willingness to scale <em>before</em> you see results. You add a second LinkedIn account because it costs nothing extra. You research more accounts because there are no credits to burn. You run all 6 campaign-success ingredients (signal, volume, intent, offer, trust, personalization) in parallel because pricing does not punish you for it. That is the structural reason the math from chapter 1 works.
                </p>

                <div className="pb-pricing-rationale__cta-row">
                  <Link to="/auth" className="pb-pricing-rationale__cta">
                    Start ACA Operator free<span aria-hidden style={{ marginLeft: 8 }}>→</span>
                  </Link>
                  <span className="pb-pricing-rationale__cta-note">$67/month after the 14-day free trial · No card required to start</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Dark CTA - final conversion moment.
            For chapter-based playbooks: rebuilt as "what you actually get" deliverable list,
            industry-agnostic, plus inline pull quote. For scaffolded playbooks: legacy layout. */}
        {p.chapters && p.chapters.length > 0 ? (
          <section className="pb-final-cta">
            <div className="wrap">
              <div className="pb-final-cta__inner">
                <header className="pb-final-cta__head">
                  <span className="pb-final-cta__kicker">Your custom playbook · not a template</span>
                  <h3 className="pb-final-cta__h">
                    Drop your URLs. We build the playbook <em>specifically for your business</em>.
                  </h3>
                  <p className="pb-final-cta__sub">
                    Different from every other reader's. ACA reads your homepage, services pages, blog, LinkedIn profile, and last 30 LinkedIn posts. It extracts your offer, your audience, your voice, your stage. Then it writes a 10,000-word Notion doc configured around what it found. Lands in your inbox in 5 minutes.
                  </p>
                </header>

                <div className="pb-final-cta__deliverables">
                  <span className="pb-final-cta__deliverables-kicker">What's inside the personalized doc</span>
                  <ul className="pb-final-cta__list">
                    <li><strong>The buyers most likely to say yes</strong> - your ICP one-pager + the 2-3 signals that predict purchase intent in your niche</li>
                    <li><strong>30-50 in-market prospects per day</strong> on autopilot - saved-filter spec for ACA's preloaded B2B contact index</li>
                    <li><strong>The 6 messages that double reply rates</strong> - your lead-magnet sequence in your voice, 10-day cadence</li>
                    <li><strong>A 10k-word playbook generated per prospect in 5 min</strong> - Generator pre-configured with your knowledge base + voice</li>
                    <li><strong>4 LinkedIn posts/week that fuel outbound</strong> - content blueprint with formats + topic angles for your niche</li>
                    <li><strong>Replies handled, calls booked while you sleep</strong> - Unibox AI Replier prompt + Lead-to-Comment trigger rules calibrated to you</li>
                    <li><strong>Your day-1 to day-30 launch plan</strong> at 1,000-3,000+ daily touches, adjusted for your stage</li>
                  </ul>
                </div>

                <blockquote className="pb-final-cta__quote">
                  <p>"Cedric is giving away more value for free than the majority of 'Gurus' on YouTube. He has really opened my eyes on ways to leverage AI to acquire clients that no one else really talks about."</p>
                  <cite>Henry, ACA member</cite>
                </blockquote>

                <div className="pb-final-cta__actions">
                  <button
                    type="button"
                    className="pb-final-cta__btn"
                    onClick={() => setLeadGenOpen(true)}
                  >
                    Get my personalized playbook
                    <span className="pb-final-cta__btn-arrow">→</span>
                  </button>
                  <span className="pb-final-cta__note">Free · No credit card · 5 minutes to your inbox</span>
                </div>

                <div className="pb-final-cta__alt">
                  <span className="pb-final-cta__alt-divider" aria-hidden>or, if you are ready to ship</span>
                  <Link to="/auth" className="pb-final-cta__alt-cta">
                    Start ACA Operator free, $67/month after 14-day trial
                    <span aria-hidden style={{ marginLeft: 8 }}>→</span>
                  </Link>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="pb-cta-dark">
            <div className="wrap">
              <div className="pb-cta-dark__inner pb-cta-dark__inner--with-mock">
                <div className="pb-cta-dark__copy">
                  <span className="kicker pb-cta-dark__kicker">Personalized for you</span>
                  <h3 className="pb-cta-dark__h3">Get this playbook as a <em>Notion doc</em>.</h3>
                  <p className="pb-cta-dark__sub">Five questions about your situation. We generate a personalized Notion playbook with the exact list, sequence, and templates wired to your business, running in ACA.</p>
                  <div className="pb-cta-dark__actions">
                    <button type="button" className="btn btn--inverse btn--lg" onClick={() => setLeadGenOpen(true)}>Generate my Notion playbook →</button>
                    <Link to="/pricing" className="pb-cta-dark__link">See pricing →</Link>
                  </div>
                </div>
                <div className="pb-cta-dark__mock">
                  <NotionPlaybookMock />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Related */}
        {others.length > 0 && (
          <section className="section section--tight" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="wrap">
              <header className="sect-head">
                <span className="kicker">Related playbooks</span>
                <h2 className="h-section">Other <em>operational plans</em>.</h2>
              </header>
              <div className="pb-list">
                {others.map((o, i) => (
                  <Link key={o.slug} to={`/playbooks/${o.slug}`} className="pb-row">
                    <span className="pb-list__col pb-list__col--num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="pb-list__col pb-list__col--title">
                      <span className="pb-row__q">{o.question}</span>
                      <span className="pb-row__sub">{o.headline}</span>
                    </span>
                    <span className="pb-list__col pb-list__col--niche">{o.niche}</span>
                    <span className="pb-list__col pb-list__col--outcome">{o.outcome}</span>
                    <span className="pb-list__col pb-list__col--steps">{o.steps.length} steps · {o.readTime}</span>
                    <span className="pb-list__col pb-list__col--cta">Open →</span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <MarketingFooter />

      {/* Sticky bottom-right CTA on scroll. Slightly more prominent: 2-line layout
          with kicker on top, action on bottom. Hover/focus expands. */}
      {stickyVisible && !leadGenOpen && (
        <button
          type="button"
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 50,
            background: "var(--ink, #1a1a1a)", color: "white",
            padding: "14px 20px", borderRadius: 14,
            boxShadow: "0 10px 32px rgba(0,0,0,0.22)",
            display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
            cursor: "pointer", border: "none",
            maxWidth: 280, textAlign: "left",
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
          }}
          onClick={() => setLeadGenOpen(true)}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 14px 38px rgba(0,0,0,0.28)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 10px 32px rgba(0,0,0,0.22)";
          }}
        >
          <span style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent, #D4361A)",
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
          }}>
            Free · Personalized in 5 min
          </span>
          <span style={{
            fontSize: 15, fontWeight: 500,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            Get my version of this playbook
            <span style={{ color: "var(--accent, #D4361A)" }}>→</span>
          </span>
        </button>
      )}

      <PlaybookLeadGen
        open={leadGenOpen}
        onClose={() => setLeadGenOpen(false)}
        playbookSlug={p.slug}
        playbookTitle={p.question}
        niche={p.niche}
        outcome={p.outcome}
      />
    </>
  );
}
