import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import hermesLogo from "@/assets/hermes.svg";
import "@/styles/aca-home.css";
import "@/styles/agents-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Friendly resource names for the opt-in confirmation banner. Keyed by the
// `source` each landing page posts to submit-playbook-lead (and redirects with
// as ?resource=). Arriving here from an opt-in shows a "your X is on the way"
// banner above the normal course page.
const RESOURCE_NAMES: Record<string, string> = {
  "sec-form4-agent": "SEC Form 4 agent prompts",
  "buying-signals-agent": "buying-signals agent prompts",
  "reddit-agent": "Reddit engagement agent prompts",
  "youtube-agent": "YouTube automation agent prompts",
  "seo-agent": "SEO growth agent prompts",
  "lead-pipeline-agent": "lead pipeline agent prompts",
  "carousel-agent": "carousel factory agent prompts",
  "hermes-agent": "LinkedIn setter agent prompts",
  "maps-scraper": "Google Maps scraper + 12M business list",
};

// Public curriculum page (/agents). Coherent narrative: ACA is the platform →
// the agents you build on it → the course plan to build each one (one course
// per agent) → the community → proof → CTA. Clear, flat, scannable (Hermes
// masterclass style). Primary action: join the Skool community.
export default function AgentShowcase() {
  // Slim sticky "Join" bar - appears once the hero scrolls out of view.
  const [showSticky, setShowSticky] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  // Filter agents by the framework they're built on (Hermes today; more later).
  const [techFilter, setTechFilter] = useState("All");
  const TECHS = ["All", ...Array.from(new Set(AGENTS.map((a) => a.tech ?? "Hermes")))];
  // Opt-in confirmation: when a landing page redirects here after capture, it
  // passes ?resource=<agent> and we greet them with a delivery confirmation.
  const [searchParams] = useSearchParams();
  const resourceName = RESOURCE_NAMES[searchParams.get("resource") ?? ""];
  // Arriving from an opt-in redirect: land at the top so the confirmation
  // banner is the first thing they see (React Router doesn't reset scroll).
  useEffect(() => {
    if (resourceName) window.scrollTo(0, 0);
  }, [resourceName]);
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShowSticky(!e.isIntersecting), { rootMargin: "-72px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="agents-lp">
      {resourceName ? (
        <div className="agents-lp__confirm" role="status">
          <div className="agents-lp__wrap agents-lp__confirm-inner">
            <span className="agents-lp__confirm-check" aria-hidden="true">✓</span>
            <div className="agents-lp__confirm-text">
              <b>You're in - your {resourceName} are on the way.</b>
              <span>
                It's on its way - check your inbox in the next minute. While you wait, here's the
                room where people build these agents together ↓
              </span>
            </div>
            <a className="agents-lp__confirm-cta" href="#curriculum">See what's inside ↓</a>
          </div>
        </div>
      ) : null}

      <div className={`agents-lp__sticky${showSticky ? " is-shown" : ""}`}>
        <div className="agents-lp__wrap">
          <span className="agents-lp__brand">ACA<b>.</b></span>
          <a className="agents-lp__btn agents-lp__btn--primary" href={SKOOL_URL} target="_blank" rel="noopener noreferrer">
            Join the Skool →
          </a>
        </div>
      </div>

      {/* ============== HERO (dark) ============== */}
      <section className="agents-lp__hero" ref={heroRef}>
        <div className="agents-lp__wrap">
          <nav className="agents-lp__nav">
            <span className="agents-lp__brand">ACA<b>.</b></span>
            <a className="agents-lp__nav-cta" href={SKOOL_URL} target="_blank" rel="noopener noreferrer">
              Join the Skool →
            </a>
          </nav>

          <div className="agents-lp__hero-grid">
            <div>
              <span className="agents-lp__eyebrow"><i />The ACA curriculum</span>
              <h1 className="agents-lp__title">
                Learn to build the agents that <em>run your business<span aria-hidden="true">.</span></em>
              </h1>
              <p className="agents-lp__lead">
                A clear, step-by-step course plan - from "what even is an agent" to a library of them you've
                built yourself. Set it up safely, give it an <b>Obsidian second brain</b>, then learn to
                <b> package and sell it</b>.
              </p>

              <div className="agents-lp__cta-row">
                <a className="agents-lp__btn agents-lp__btn--primary" href={SKOOL_URL} target="_blank" rel="noopener noreferrer">
                  Join the Skool →
                </a>
                <a className="agents-lp__btn agents-lp__btn--ghost" href="#curriculum">
                  Browse the curriculum ↓
                </a>
              </div>

              <div className="agents-lp__trust">
                <span>Live build calls</span>
                <span>Money-back guarantee</span>
                <span>No experience needed</span>
              </div>
            </div>

            {/* Course index - clickable jump links into the curriculum */}
            <div className="agents-lp__syllabus-wrap">
              <div className="agents-lp__syllabus-glow" aria-hidden="true" />
              <nav className="agents-lp__syllabus" aria-label="Course index">
                <div className="agents-lp__syllabus-head">
                  <b>The curriculum</b>
                  <span>Jump to a course →</span>
                </div>
                <div className="agents-lp__syllabus-list">
                  {COURSES.map((c) => (
                    <a className="agents-lp__syllabus-row" href={`#course-${c.n}`} key={c.n}>
                      <span className="n">{c.n}</span>
                      <span className="t">{c.title}</span>
                      <span className="c">{c.lessons.length} lessons</span>
                    </a>
                  ))}
                </div>
              </nav>
            </div>
          </div>
        </div>
      </section>

      {/* ============== REAL AGENTS (dark) - the hook, first ============== */}
      <section className="agents-lp__sec agents-lp__sec--ink">
        <div className="agents-lp__wrap">
          <div className="agents-lp__sec-tag"><b>The agents you'll build</b></div>
          <h2 className="agents-lp__sec-h">Agents built to run - <em>not demos.</em></h2>
          <p className="agents-lp__sec-sub">
            A growing library of specialist agents - outreach, lead-gen, content, video, SEO, local, Reddit,
            buying signals, and more. You build each one in the course plan below, then it's live on your own
            account.
          </p>

          <div className="agents-lp__tech-filter" role="group" aria-label="Filter agents by the framework they're built on">
            <span className="agents-lp__tech-filter-label">Built on</span>
            {TECHS.map((t) => (
              <button
                type="button"
                key={t}
                className={techFilter === t ? "is-active" : ""}
                aria-pressed={techFilter === t}
                onClick={() => setTechFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="agents-lp__roster">
            {AGENTS.map((a, i) => {
              const tech = a.tech ?? "Hermes";
              if (techFilter !== "All" && tech !== techFilter) return null;
              const courseN = String(i + 5).padStart(2, "0");
              return (
                <a
                  className="agents-lp__agent"
                  key={a.name}
                  href={`#course-${courseN}`}
                  aria-label={`${a.name} - built on ${tech}. See how to build it in Course ${courseN}`}
                >
                  <span className="agents-lp__agent-tech">
                    <span className="agents-lp__agent-tech-logo" aria-hidden="true">
                      <img src={hermesLogo} alt="" width={16} height={16} />
                    </span>
                    Built on {tech}
                  </span>
                  <div className="agents-lp__agent-top">
                    <span className="agents-lp__agent-icon" aria-hidden="true">{a.icon}</span>
                    <span className="agents-lp__agent-tag">{a.tag}</span>
                  </div>
                  <h3 className="agents-lp__agent-name">{a.name}</h3>
                  <ul className="agents-lp__agent-bullets">
                    {a.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  <span className="agents-lp__agent-out">{a.outcome}</span>
                  <span className="agents-lp__agent-build">Build it in Course {courseN} →</span>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============== CURRICULUM (light) - flat, all lessons visible ============== */}
      <section id="curriculum" className="agents-lp__sec agents-lp__sec--alt">
        <div className="agents-lp__wrap">
          <div className="agents-lp__sec-tag"><b>The course plan</b></div>
          <h2 className="agents-lp__sec-h">Every course, <em>lesson by lesson.</em></h2>
          <p className="agents-lp__sec-sub">
            One course builds each agent above. Start with the foundations and safe setup, give your agent an
            Obsidian second brain, build a dedicated agent in each course, then learn to package and sell it.
            Tap any course to see its lessons.
          </p>

          <CourseList />
        </div>
      </section>

      {/* ============== ACA - included client-acquisition machine (light) ============== */}
      <section className="agents-lp__sec agents-lp__sec--paper">
        <div className="agents-lp__wrap">
          <div className="agents-lp__sec-tag"><b>Included with the community</b></div>
          <h2 className="agents-lp__sec-h">You don't rent the tool stack - <em>you get ACA.</em></h2>
          <p className="agents-lp__sec-sub">
            Join and the whole client-acquisition machine is handed to you: email and LinkedIn campaigns,
            automated content, lead-magnet delivery, and the email infrastructure that makes it all land. Use
            it with your agents, or on its own - it's yours either way.
          </p>

          <div className="agents-lp__aca-hero">
            <div className="agents-lp__aca-hero-left">
              <span className="agents-lp__aca-wordmark">ACA<b>.</b></span>
              <p className="agents-lp__aca-tagline">
                A full client-acquisition machine - yours the day you join.
              </p>
              <div className="agents-lp__aca-channels">
                <span>LinkedIn</span><span>Email</span><span>WhatsApp</span>
                <span>Instagram</span><span>Telegram</span><span>SMS</span>
              </div>
            </div>

            <div className="agents-lp__aca-dash" role="img" aria-label="The ACA campaign dashboard - a multi-channel campaign running with live stats.">
              <div className="agents-lp__aca-dash-bar">
                <span className="agents-lp__aca-dots" aria-hidden="true"><i /><i /><i /></span>
                <span className="agents-lp__aca-dash-title">ACA · Campaigns</span>
              </div>
              <div className="agents-lp__aca-dash-body">
                <div className="agents-lp__aca-camp">
                  <span className="dot" aria-hidden="true" /><b>Q3 Outreach</b><span className="run">Running</span>
                </div>
                <div className="agents-lp__aca-progress" aria-hidden="true"><i /></div>
                <div className="agents-lp__aca-stats">
                  <div><b>1,240</b><span>sent</span></div>
                  <div><b>312</b><span>opened</span></div>
                  <div><b>12</b><span>replies</span></div>
                </div>
                <div className="agents-lp__aca-rows">
                  <div className="agents-lp__aca-row"><span className="ch">in</span>LinkedIn · 420 connects queued</div>
                  <div className="agents-lp__aca-row"><span className="ch">@</span>Email · follow-up sending now</div>
                  <div className="agents-lp__aca-row"><span className="ch">↩</span>Inbox · 12 replies to triage</div>
                </div>
              </div>
            </div>
          </div>

          <div className="agents-lp__aca-stack">
            <div className="agents-lp__aca-stack-head">Buy this stack elsewhere, you're looking at:</div>
            <ul className="agents-lp__aca-stack-list">
              <li><span>Cold email + multi-step sequencer</span><b>~$97/mo</b></li>
              <li><span>LinkedIn outreach automation</span><b>~$99/mo</b></li>
              <li><span>Email infrastructure + inbox warmup</span><b>~$99/mo</b></li>
              <li><span>AI content - copy, image &amp; video</span><b>~$99/mo</b></li>
              <li><span>Blog writer + auto-publisher</span><b>~$99/mo</b></li>
              <li><span>Lead enrichment + email verification</span><b>~$99/mo</b></li>
              <li><span>CRM + pipelines</span><b>~$65/mo</b></li>
            </ul>
            <div className="agents-lp__aca-stack-reveal">
              <span className="strike">$650+<i>/mo</i></span>
              <span className="arrow" aria-hidden="true">→</span>
              <span className="incl">Included</span>
              <span className="note">Seven tools and $7,000+ a year - replaced by one platform. You just bring your own API keys.</span>
            </div>
            <div className="agents-lp__aca-stack-inbox">
              <span className="agents-lp__aca-stack-inbox-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 5.5L20 7" />
                </svg>
              </span>
              <p>
                <b>Even the inboxes are under $1 each</b> - on best-in-class Microsoft infrastructure. Everywhere
                else, mailboxes run $2 to $6 apiece.
              </p>
            </div>
          </div>

          <div className="agents-lp__caps">
            {CAPS.map((c) => (
              <div className="agents-lp__cap" key={c.title}>
                <span className="agents-lp__cap-icon" aria-hidden="true">{c.icon}</span>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </div>
            ))}
          </div>
          <p className="agents-lp__caps-more">
            <b>Plus</b> lead enrichment, ICP scoring, WhatsApp / Instagram / SMS outreach, white-label for
            clients, and more - all given to you as a member. Your agents can plug into it, but they don't
            have to.
          </p>
        </div>
      </section>

      {/* ============== YOU DON'T HAVE TO BUILD IT ALONE (dark) ============== */}
      <section className="agents-lp__sec agents-lp__school">
        <div className="agents-lp__wrap">
          <div className="agents-lp__school-grid">
            <div>
              <div className="agents-lp__sec-tag"><b>You don't have to build it alone</b></div>
              <h2>A whole room building <em>the same agents as you.</em></h2>
              <p>
                The course plan is the map. The community is how you actually get there - without staring at
                an error message at 2am. Bring your agent to the live call and we'll debug it on the spot. Get
                stuck, drop it in the room, get unstuck in minutes. Steal what's already working from people a
                few steps ahead.
              </p>
              <ul className="agents-lp__school-list">
                <li>Weekly live build calls - bring your agent, we debug it on the call.</li>
                <li>Ask the room - get unstuck in minutes, not days.</li>
                <li>Steal what's working - shared prompts, blueprints, and playbooks.</li>
                <li>New agents added to the library regularly - you get every one.</li>
              </ul>
            </div>

            <div className="agents-lp__school-card">
              <p className="agents-lp__school-card-h">What's included</p>
              <div className="agents-lp__module">
                <span className="agents-lp__module-n">✓</span>
                <span className="agents-lp__module-t">Every course &amp; lesson - and all future ones</span>
                <span className="agents-lp__module-meta">Learn</span>
              </div>
              <div className="agents-lp__module">
                <span className="agents-lp__module-n">✓</span>
                <span className="agents-lp__module-t">Weekly live build calls</span>
                <span className="agents-lp__module-meta">Live</span>
              </div>
              <div className="agents-lp__module">
                <span className="agents-lp__module-n">✓</span>
                <span className="agents-lp__module-t">Double money-back guarantee</span>
                <span className="agents-lp__module-meta">Risk-free</span>
              </div>
              <div className="agents-lp__module">
                <span className="agents-lp__module-n">✓</span>
                <span className="agents-lp__module-t">ACA - the full client-acquisition machine</span>
                <span className="agents-lp__module-meta">Included</span>
              </div>
              <div className="agents-lp__module">
                <span className="agents-lp__module-n">✓</span>
                <span className="agents-lp__module-t">A free GoHighLevel (GHL) subaccount</span>
                <span className="agents-lp__module-meta">Bonus</span>
              </div>
              <div className="agents-lp__module">
                <span className="agents-lp__module-n">✓</span>
                <span className="agents-lp__module-t">$20k+ in software perks &amp; the community</span>
                <span className="agents-lp__module-meta">Perks</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== TESTIMONIALS (light) ============== */}
      <section className="agents-lp__sec agents-lp__sec--paper">
        <div className="agents-lp__wrap">
          <div className="agents-lp__sec-tag"><b>From inside the Skool</b></div>
          <h2 className="agents-lp__sec-h">What members <em>actually say.</em></h2>
          <p className="agents-lp__sec-sub">Real words from people building agents in the community.</p>

          <div className="agents-lp__embed">
            {/* testimonial.to Wall of Love (iframe embed) */}
            <iframe
              id="testimonialto-34b55ae9-b1be-4e1f-97f8-eeee0d51bfb5"
              src="https://embed-v2.testimonial.to/w/automated-client-acquisition?id=34b55ae9-b1be-4e1f-97f8-eeee0d51bfb5"
              title="What ACA members say"
              frameBorder="0"
              scrolling="no"
              width="100%"
              height="800px"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      {/* ============== FINAL CTA (red) ============== */}
      <section className="agents-lp__sec agents-lp__final">
        <div className="agents-lp__wrap">
          <span className="agents-lp__eyebrow"><i />Open enrollment</span>
          <h2>Start building on the <em>next live call.</em></h2>
          <p>
            Stay the bottleneck and hope AI doesn't pass you by - or spend a few hours a week and
            <b> own a system that does the work for you</b>.
          </p>
          <div className="agents-lp__guarantee">
            <div className="agents-lp__g-card">
              <span className="agents-lp__g-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l7 3v5c0 4.6-3.1 7.8-7 9-3.9-1.2-7-4.4-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" />
                </svg>
              </span>
              <div>
                <b>7-day no-questions refund</b>
                <span>Try the whole thing. Not for you? Email us within 7 days - every cent back, no questions asked.</span>
              </div>
            </div>
            <div className="agents-lp__g-card">
              <span className="agents-lp__g-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19h16" /><path d="M5 15l4-4 3 3 5-6" /><path d="M17 8h2v2" />
                </svg>
              </span>
              <div>
                <b>30-day ROI guarantee</b>
                <span>Run one workflow. If it doesn't save you time or make you leads or revenue in 30 days, we refund you.</span>
              </div>
            </div>
          </div>

          <a className="agents-lp__final-cta" href={SKOOL_URL} target="_blank" rel="noopener noreferrer">
            Join the Skool →
          </a>
          <p className="agents-lp__final-note">Live calls · $20k+ in software perks · build it, own it, sell it</p>
        </div>
      </section>

      {/* ============== FOOTER ============== */}
      <footer className="agents-lp__foot">
        <div className="agents-lp__wrap">
          <div className="agents-lp__foot-row">
            <span>© {new Date().getFullYear()} Automated Client Acquisition</span>
            <span>
              <a href={SKOOL_URL} target="_blank" rel="noopener noreferrer">Join the community →</a>
              {"   ·   "}
              <a href="/privacy">Privacy</a>
              {"   ·   "}
              <a href="/terms">Terms</a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* =========================================================================
   Course plan - collapsed accordion. Each course shows its header + summary;
   lessons expand on click. First course open; jump-nav also opens its target.
   ====================================================================== */
function CourseList() {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const reveal = (i: number) => setOpen((prev) => new Set(prev).add(i));

  // Open the course whose anchor is targeted (agent card, jump-nav, or direct URL).
  useEffect(() => {
    const openFromHash = () => {
      const m = location.hash.match(/^#course-(\d+)$/);
      if (!m) return;
      const idx = COURSES.findIndex((c) => c.n === m[1]);
      if (idx >= 0) setOpen((prev) => new Set(prev).add(idx));
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  return (
    <>
      <nav className="agents-lp__coursenav" aria-label="Jump to a course">
        {COURSES.map((c, i) => (
          <a href={`#course-${c.n}`} key={c.n} onClick={() => reveal(i)}><b>{c.n}</b>{c.short}</a>
        ))}
      </nav>

      <div className="agents-lp__courses">
        {COURSES.map((c, i) => {
          const isOpen = open.has(i);
          return (
            <div className={`agents-lp__course${isOpen ? " is-open" : ""}`} id={`course-${c.n}`} key={c.n}>
              <button
                type="button"
                className="agents-lp__course-head"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
              >
                <span className="agents-lp__course-icon" aria-hidden="true">{c.icon}</span>
                <span className="agents-lp__course-meta">
                  <span className="agents-lp__course-label">Course {c.n}</span>
                  <span className="agents-lp__course-title">{c.title}</span>
                  <span className="agents-lp__course-tag"><b>{c.lessons.length} lessons</b> · {c.summary}</span>
                </span>
                <span className="agents-lp__course-chev" aria-hidden="true">⌄</span>
              </button>
              <div className="agents-lp__course-body">
                <div className="agents-lp__course-body-inner">
                  <ol className="agents-lp__course-lessons">
                    {c.lessons.map((l, li) => (
                      <li key={l}>
                        <span className="ln">{c.n}.{li + 1}</span>
                        <span>{l}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* =========================================================================
   Inline line-SVG icon helper (stroke = currentColor, accent-tinted).
   ====================================================================== */
const svg = (paths: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);

// Reused icons so each agent's card and its build course share a glyph.
const ICON = {
  linkedin: svg(<><path d="M4 5h16v10H9l-4 4V5z" /><path d="M8 10h7" /></>),
  maps: svg(<><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>),
  video: svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3V9z" /></>),
  carousel: svg(<><rect x="7" y="4.5" width="10" height="15" rx="2" /><path d="M4 8v8M20 8v8" /></>),
  seo: svg(<><path d="M4 19h16" /><path d="M5 15l4-4 3 3 5-6" /><path d="M17 8h2v2" /></>),
  pipeline: svg(<><path d="M4 5h16l-6 7v6l-4-2v-4L4 5z" /></>),
  reddit: svg(<><path d="M4 5h16v11H9l-4 3v-3H4z" /><circle cx="9" cy="10.5" r="1" /><circle cx="12" cy="10.5" r="1" /><circle cx="15" cy="10.5" r="1" /></>),
  signals: svg(<><path d="M3 12h3l2-6 4 13 3-9 1.5 2H21" /></>),
  sec: svg(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 16.5h6" /></>),
};

/* =========================================================================
   ACA platform capabilities (the engine the agents run on).
   ====================================================================== */
const CAPS: Array<{ icon: React.ReactNode; title: string; text: string }> = [
  {
    icon: svg(<><rect x="3" y="4" width="6" height="5" rx="1.2" /><rect x="15" y="15" width="6" height="5" rx="1.2" /><path d="M6 9v3.5a3 3 0 0 0 3 3h6" /></>),
    title: "Email + LinkedIn campaigns",
    text: "Multi-step sequences across email and LinkedIn, built in one visual campaign builder.",
  },
  {
    icon: svg(<><path d="M12 3l7 3v5c0 4.6-3.1 7.8-7 9-3.9-1.2-7-4.4-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></>),
    title: "Email infrastructure, done",
    text: "Mailboxes, warmup, rotation, and deliverability - so your sends actually land in the inbox.",
  },
  {
    icon: svg(<><path d="M5 19 15 9" /><path d="M17 3l.9 2.1L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-.9L17 3z" /><path d="M19 13l.6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6L19 13z" /></>),
    title: "Automated content",
    text: "Posts, carousels, videos, and blog articles - generated on-brand and auto-published on a schedule.",
  },
  {
    icon: svg(<><path d="M21 4 3 11l6 2.2L11 20z" /><path d="M9 13.2 21 4" /></>),
    title: "Lead magnets on autopilot",
    text: "Capture pages that deliver the freebie and kick off the follow-up sequence for you.",
  },
  {
    icon: svg(<><path d="M4 13l2.5-8h11L20 13" /><path d="M4 13v6h16v-6" /><path d="M4 13h4l1.5 2.5h5L16 13h4" /></>),
    title: "One unified inbox",
    text: "Every reply, from every channel, in a single place you - or your agent - can act on.",
  },
  {
    icon: svg(<><circle cx="9" cy="8" r="3" /><path d="M3.5 19.5c0-3 2.7-5 5.5-5s5.5 2 5.5 5" /><path d="M16 5.5a3 3 0 0 1 0 6" /><path d="M17.5 14.6c2 .6 3.5 2.2 3.5 4.4" /></>),
    title: "CRM & pipelines",
    text: "Contacts, deals, tags, and stages - so your leads stay organized and nothing slips.",
  },
];

/* =========================================================================
   The agents you'll build (one per build course). `outcome` is an honest
   value line; bullets are benefit-first.
   ====================================================================== */
// `tech` defaults to "Hermes" when omitted - set it per agent to add a framework filter chip.
const AGENTS: Array<{ icon: React.ReactNode; name: string; tag: string; bullets: string[]; outcome: string; tech?: string }> = [
  {
    icon: ICON.linkedin,
    name: "LinkedIn Setter",
    tag: "Outreach",
    bullets: [
      "Finds the right LinkedIn threads and ranks people by ICP fit",
      "Drafts DMs in your voice - approve from Telegram before they send",
      "Runs on your own account, smoke-tested before it spends a thing",
    ],
    outcome: "Warm DMs, not template spam",
  },
  {
    icon: ICON.pipeline,
    name: "Lead Pipeline Agent",
    tag: "Lead-gen",
    bullets: [
      "Turns a raw list - CSV, Maps, anything - into scored, enrollable leads",
      "Verifies the company and validates every email before you send",
      "Keeps an audit trail, so there's no surprise enrichment bill",
    ],
    outcome: "Only the leads worth chasing",
  },
  {
    icon: ICON.carousel,
    name: "Carousel Factory",
    tag: "Content",
    bullets: [
      "Turns a URL or transcript into a finished LinkedIn carousel PDF",
      "Writes the post copy and holds your brand rules every time",
      "One agent owns research → export, repeatable on demand",
    ],
    outcome: "A deck in minutes, not half a day",
  },
  {
    icon: ICON.seo,
    name: "SEO Growth Agent",
    tag: "Organic",
    bullets: [
      "Splits the work like a real pod: strategist, campaigns, backlinks",
      "Targets actual search intent - not generic blog fluff",
      "Actually submits the backlinks and ships on a schedule",
    ],
    outcome: "An SEO team without the agency",
  },
  {
    icon: ICON.video,
    name: "YouTube Automation",
    tag: "Video",
    bullets: [
      "Builds the roadmap and storyboards so you never face a blank doc",
      "Bundles YouTube SEO and short-form skills in one installable agent",
      "Turns the weekly scramble into a repeatable system",
    ],
    outcome: "YouTube as a system, not a guess",
  },
  {
    icon: ICON.maps,
    name: "Google Maps Agent",
    tag: "Local",
    bullets: [
      "Pulls local business leads from Maps-style sources at scale",
      "Uses owned data and scraping before it ever burns a paid API",
      "Feeds straight into your lead pipeline, already qualified",
    ],
    outcome: "Local leads without the API bill",
  },
  {
    icon: ICON.reddit,
    name: "Reddit Engagement",
    tag: "Community",
    bullets: [
      "Runs multiple Reddit accounts with warmup and a human voice",
      "Posts through the browser when the API gets blocked",
      "DEMO mode and a pause switch keep you fully in control",
    ],
    outcome: "Reddit in the funnel - without bans",
  },
  {
    icon: ICON.signals,
    name: "Buying Signals Agent",
    tag: "Intent",
    bullets: [
      "Tracks funding, hiring, M&A, and growth signals via RSS",
      "Hands you the \"why now\" so outreach never lands cold",
      "Feeds the Setter, SEO, and pipeline with fresh angles",
    ],
    outcome: "Reach out with a reason",
  },
  {
    icon: ICON.sec,
    name: "SEC Form 4 Agent",
    tag: "Wealth",
    bullets: [
      "Pulls and scores EDGAR Form 4 filings for wealth and fintech",
      "Free, fresh primary data - no stale broker lists",
      "Compliance-minded: you review, then you send",
    ],
    outcome: "Prospects straight from public filings",
  },
];

/* =========================================================================
   Course plan. Foundations → setup → safety → Obsidian → one build course
   per agent (05-10, sharing each agent's icon) → sell → scale.
   ====================================================================== */
const COURSES: Array<{ icon: React.ReactNode; n: string; short: string; title: string; summary: string; lessons: string[] }> = [
  {
    icon: svg(<><path d="M12 3l2.2 4.6L19 9l-4.8 1.4L12 15l-2.2-4.6L5 9l4.8-1.4L12 3z" /></>),
    n: "01",
    short: "Foundations",
    title: "Agent foundations",
    summary: "What an agent actually is, the ACA stack, and how the pieces fit.",
    lessons: [
      "What an agent is - and why it acts, not advises",
      "Agents vs chatbots vs automations",
      "The ACA platform: channels, inbox, CRM, content",
      "How the pieces fit: prompts, tools, memory, approval",
      "Pick your first agent and the outcome you want",
    ],
  },
  {
    icon: svg(<><path d="M4 8h16" /><path d="M4 16h16" /><circle cx="9" cy="8" r="2.4" /><circle cx="15" cy="16" r="2.4" /></>),
    n: "02",
    short: "Setup",
    title: "Set it up the right way",
    summary: "Get ACA and your accounts connected without cutting corners.",
    lessons: [
      "Set up your ACA workspace",
      "Connect LinkedIn, email, and socials - the safe way",
      "Store credentials and secrets securely",
      "Run your first guided smoke test",
      "Read the dashboards, logs, and run history",
    ],
  },
  {
    icon: svg(<><path d="M12 3l7 3v5c0 4.6-3.1 7.8-7 9-3.9-1.2-7-4.4-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></>),
    n: "03",
    short: "Safety",
    title: "Run it safely - don't get banned",
    summary: "Warmup, limits, deliverability, and the guardrails that keep accounts alive.",
    lessons: [
      "Account warmup and human-paced limits",
      "Email deliverability: domains, DKIM/SPF, inbox health",
      "Daily caps and rate limits that keep accounts alive",
      "The Telegram human-approval gate",
      "Guardrails: brand voice, do-not-contact, kill switch",
      "What to do when something breaks",
    ],
  },
  {
    icon: svg(<><path d="M12 3l7 6-7 12-7-12 7-6z" /><path d="M5 9h14" /><path d="M12 3v18" /></>),
    n: "04",
    short: "Obsidian",
    title: "Obsidian: the second brain",
    summary: "Give your agent memory - a vault it reads from and writes back to.",
    lessons: [
      "Why your agent needs a second brain",
      "Set up the Obsidian vault as its knowledge base",
      "Structure it: ICP, offers, voice, and playbooks",
      "Feed context in - and how the agent retrieves it",
      "Keep the brain fresh with notes, logs, and learnings",
    ],
  },
  {
    icon: ICON.linkedin,
    n: "05",
    short: "LinkedIn",
    title: "Build the LinkedIn Setter",
    summary: "An appointment setter that sources, messages, and books - with your approval.",
    lessons: [
      "How the setter works: source → score → send → book",
      "Define your ICP and your lead sources",
      "Mine competitor threads for warm, in-market people",
      "Write openers that sound like you",
      "The Telegram approval gate in action",
      "Go live and book your first calls",
    ],
  },
  {
    icon: ICON.pipeline,
    n: "06",
    short: "Pipeline",
    title: "Build the Lead Pipeline Agent",
    summary: "Raw list to enrollable leads: score, verify, validate, export.",
    lessons: [
      "Bring in a raw list: CSV, Parquet, or Maps",
      "Score and qualify each lead against your offer",
      "Verify the company and validate every email",
      "Export only what's worth sending",
      "Own your pipeline data end to end",
    ],
  },
  {
    icon: ICON.carousel,
    n: "07",
    short: "Carousels",
    title: "Build the Carousel Factory",
    summary: "A URL or transcript into a finished LinkedIn carousel and post copy.",
    lessons: [
      "Turn a URL, transcript, or doc into a carousel",
      "On-brand image generation and layout",
      "Write the post copy that earns the swipe",
      "Export the PDF and publish to LinkedIn",
    ],
  },
  {
    icon: ICON.seo,
    n: "08",
    short: "SEO",
    title: "Build the SEO Growth Agent",
    summary: "An SEO operator: intent, campaigns, backlinks, and deploy hooks.",
    lessons: [
      "Find winnable intent - not vanity keywords",
      "Run the strategist, campaign, and backlink roles",
      "Generate briefs and written content",
      "Submit backlinks and deploy on a schedule",
    ],
  },
  {
    icon: ICON.video,
    n: "09",
    short: "YouTube",
    title: "Build the YouTube Automation Agent",
    summary: "Roadmaps, storyboards, and SEO so YouTube is a system, not a scramble.",
    lessons: [
      "Build the channel roadmap and calendar",
      "Storyboard the video: hook, scenes, b-roll",
      "Generate the script and short-form cuts",
      "YouTube SEO: titles, tags, and metadata",
      "Ship on a repeatable weekly cadence",
    ],
  },
  {
    icon: ICON.maps,
    n: "10",
    short: "Maps",
    title: "Build the Google Maps Agent",
    summary: "Local leads from Maps-style sources - owned data before paid APIs.",
    lessons: [
      "Pull local businesses from Maps-style sources",
      "Use owned data and scraping before paid APIs",
      "Verify a real email for every lead",
      "Route into the lead pipeline, qualified",
      "Turn the list into a live campaign",
    ],
  },
  {
    icon: ICON.reddit,
    n: "11",
    short: "Reddit",
    title: "Build the Reddit Engagement Agent",
    summary: "Multi-account Reddit with warmup, a human voice, and safe posting.",
    lessons: [
      "Set up multiple accounts with safe warmup",
      "Write in a casual voice that doesn't get removed",
      "Browser posting for when the API gets blocked",
      "Config-driven personas and strategy",
      "DEMO mode, pause switch, and staying un-banned",
    ],
  },
  {
    icon: ICON.signals,
    n: "12",
    short: "Signals",
    title: "Build the Buying Signals Agent",
    summary: "Funding, hiring, and growth signals - your \"why now\" for outreach.",
    lessons: [
      "Pull funding, hiring, M&A, and growth signals via RSS",
      "Add optional sources and own your data",
      "Score and route each signal to the right play",
      "Wire signals into the Setter, SEO, and pipeline",
      "Run it on a 3×/day cadence",
    ],
  },
  {
    icon: ICON.sec,
    n: "13",
    short: "SEC",
    title: "Build the SEC Form 4 Agent",
    summary: "EDGAR Form 4 pulls, scored, for wealth and fintech prospecting.",
    lessons: [
      "Pull EDGAR Form 4 filings - free primary data",
      "Score filings for the wealth and fintech niche",
      "Export a clean, scored shortlist",
      "Stay compliance-minded before any outreach",
      "Hand off to the LinkedIn Setter for follow-up",
    ],
  },
  {
    icon: svg(<><path d="M4 4h7l9 9-7 7-9-9V4z" /><circle cx="8" cy="8" r="1.4" /></>),
    n: "14",
    short: "Sell",
    title: "Sell it: position, package, price",
    summary: "Turn the agents into an offer people pay for - and close the first client.",
    lessons: [
      "Position the offer so it sells itself",
      "Package agents into a productized service",
      "Pricing and retainers - what to actually charge",
      "Build the offer and the sales page",
      "Run the sales call and handle objections",
      "Land your first paying client",
    ],
  },
  {
    icon: svg(<><circle cx="9" cy="8" r="3" /><path d="M3.5 19.5c0-3 2.7-5 5.5-5s5.5 2 5.5 5" /><path d="M16 5.5a3 3 0 0 1 0 6" /><path d="M17.5 14.6c2 .6 3.5 2.2 3.5 4.4" /></>),
    n: "15",
    short: "Scale",
    title: "Scale: clients, delivery, white-label",
    summary: "Deliver reliably, white-label it, and grow it into real recurring revenue.",
    lessons: [
      "White-label ACA for your clients",
      "Onboard a new client in a day",
      "Deliver reliably without babysitting",
      "Support, retention, and recurring revenue",
      "Hire and delegate as you grow",
    ],
  },
];
