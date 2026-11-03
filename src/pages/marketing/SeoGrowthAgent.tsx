import { CountStat } from "@/components/marketing/CountStat";
import { useLeadMagnetSubscribe } from "@/hooks/useLeadMagnetSubscribe";
import "@/styles/aca-home.css";
import "@/styles/lead-magnet-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Free lead-magnet capture page: the SEO growth agent. Angle (from ACA idea
// seoAgent): it does what a $3k/mo agency pod does - writes the content, and
// actually GOES AND GETS the backlinks (not a spreadsheet of "opportunities"),
// climbing Google + getting cited in AI answers. source="seo-agent".
export default function SeoGrowthAgent() {
  const sub = useLeadMagnetSubscribe("seo-agent");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sub.submit();
  }

  return (
    <div className="lm-lp">
      {/* ============== HERO (dark) ============== */}
      <section className="lm-lp__hero">
        <div className="lm-lp__wrap">
          <nav className="lm-lp__nav">
            <span className="lm-lp__brand">ACA<b>.</b></span>
            <span className="lm-lp__navnote">Free agent build · no credit card</span>
          </nav>

          <div className="lm-lp__hero-grid">
            <div>
              <span className="lm-lp__eyebrow"><i />Free agent build · on the keys you already have</span>
              <h1 className="lm-lp__title">
                A $3k/mo agency pod - <em>that actually ships<span aria-hidden="true">.</span></em>
              </h1>
              <p className="lm-lp__lead">
                Learn to build it yourself - you get the <b>exact prompts + step-by-step guide</b> for the SEO agent
                that writes content around what people actually search, then <b>goes and gets the backlinks
                itself</b> - not a spreadsheet of "opportunities" you have to chase. Copy, paste, and run it on the
                keys you already have.
              </p>

              {sub.status === "done" ? (
                <div className="lm-lp__hero-done">
                  <span className="chk" aria-hidden="true">✓</span>
                  <div>
                    <h3>Check your inbox.</h3>
                    <p>
                      We just emailed you the exact prompts and the full build guide - it lands in under a minute.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <form className="lm-lp__form" onSubmit={onSubmit}>
                    <input
                      id="seo-email"
                      type="email"
                      value={sub.email}
                      onChange={(e) => sub.setEmail(e.target.value)}
                      placeholder="you@company.com"
                      aria-label="Work email address"
                      autoComplete="email"
                      disabled={sub.status === "submitting"}
                    />
                    <button type="submit" className="lm-lp__submit" disabled={!sub.valid || sub.status === "submitting"}>
                      {sub.status === "submitting" ? "Sending…" : "Send me the prompts →"}
                    </button>
                  </form>
                  {sub.error ? <p className="lm-lp__form-error">{sub.error}</p> : null}
                  <div className="lm-lp__trust">
                    <span>Instant delivery</span>
                    <span>No credit card</span>
                    <span>Unsubscribe anytime</span>
                  </div>
                </>
              )}
            </div>

            {/* Bespoke visual: a SERP with your result climbing + backlinks flipping to "accepted" */}
            <div className="lm-lp__phone-wrap">
              <div className="lm-lp__phone-glow" aria-hidden="true" />

              <div className="lm-lp__chip lm-lp__chip--a" aria-hidden="true">
                <b>#8 → #3</b><span>climbing</span>
              </div>
              <div className="lm-lp__chip lm-lp__chip--b" aria-hidden="true">
                <b>$0</b><span>agency retainer</span>
              </div>

              <div className="lm-lp__viz" role="img" aria-label="A Google results page where your article is climbing from position 8 to 3, with backlinks the agent submitted flipping to accepted">
                <div className="lm-lp__serp-bar">cold email deliverability checklist</div>
                <div className="lm-lp__serp-body">
                  <div className="lm-lp__serp-row lm-lp__serp-row--dim">
                    <div className="u">competitor.com › blog</div>
                    <div className="h">The Cold Email Deliverability Guide</div>
                  </div>
                  <div className="lm-lp__serp-row lm-lp__serp-row--yours">
                    <div className="u">yoursite.com › deliverability</div>
                    <div className="h">Cold Email Deliverability Checklist (2026)<span className="move">▲ #8 → #3</span></div>
                  </div>
                  <div className="lm-lp__serp-row lm-lp__serp-row--dim">
                    <div className="u">olddomain.com › posts</div>
                    <div className="h">Improve Your Email Deliverability</div>
                  </div>
                </div>
                <div className="lm-lp__serp-links" aria-hidden="true">
                  <span className="chip ok">✓ backlink accepted</span>
                  <span className="chip ok">✓ backlink accepted</span>
                  <span className="chip">submitting…</span>
                  <span className="chip ok">✓ cited in AI answers</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== VALUE - what's inside ============== */}
      <section className="lm-lp__sec lm-lp__sec--paper">
        <div className="lm-lp__wrap">
          <div className="lm-lp__sec-tag"><b>01</b>What you get</div>
          <h2 className="lm-lp__sec-h">Everything to build it yourself - <em>nothing held back.</em></h2>
          <p className="lm-lp__sec-sub">
            Not a teaser. The exact copy-paste prompts, the strategist/content/backlink roles, and the step-by-step
            setup to stand up your own SEO agent on the tools you already pay for.
          </p>

          <div className="lm-lp__values">
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">1</span>
              <div>
                <h3>The full agent prompt</h3>
                <p>Copy, paste, and run. The exact prompt that powers the whole agent - no prompt engineering required.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">2</span>
              <div>
                <h3>Actually gets the backlinks</h3>
                <p>Your old agency sent a spreadsheet of "opportunities." This agent goes and gets them, then submits on a schedule.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">3</span>
              <div>
                <h3>Strategist, content, backlinks in one</h3>
                <p>Three specialist roles run as a single agent, working from the same plan - a whole pod, no retainer.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">4</span>
              <div>
                <h3>Gets you cited in AI answers</h3>
                <p>Not just Google - a 360° SEO + GEO machine that gets you surfaced in LLM search too.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">5</span>
              <div>
                <h3>Runs on the keys you already have</h3>
                <p>Your own Ahrefs/SEMrush-class data, no agency markup - the $3k a month stays in your pocket.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">6</span>
              <div>
                <h3>Step-by-step setup guide</h3>
                <p>Wire it up today, even if you've never built an agent before. We walk you through every step.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== STATS BAND ============== */}
      <section className="lm-lp__sec lm-lp__statsband">
        <div className="lm-lp__wrap">
          <div className="lm-lp__statsband-grid">
            <CountStat target={3000} prefix="$3k+" suffix="/mo" label="Agency retainer, replaced" />
            <CountStat target={3} suffix="" label="Agency-pod roles, one agent" />
            <CountStat target={0} prefix="Ships" suffix="" label="On a schedule, not a to-do list" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="lm-lp__sec lm-lp__sec--alt">
        <div className="lm-lp__wrap">
          <div className="lm-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="lm-lp__sec-h">Four moves. <em>Topic to a link that's live.</em></h2>
          <p className="lm-lp__sec-sub">The agent runs the whole pod end-to-end - the work ships instead of sitting on a list.</p>

          <div className="lm-lp__pipe">
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">01</span>
              <h3>Give it a topic</h3>
              <p>Point it at what you want to rank for - it finds the intent you can actually win.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">02</span>
              <h3>Writes the content</h3>
              <p>Built around what people search, structured to rank - not filler.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">03</span>
              <h3>Gets the backlinks</h3>
              <p>It goes and gets them itself, then submits on a schedule - no chasing anyone.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">04</span>
              <h3>Keeps climbing</h3>
              <p>Google rankings and AI citations rise while you run the business.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== OBJECTION KILLER (dark) ============== */}
      <section className="lm-lp__sec lm-lp__control">
        <div className="lm-lp__wrap">
          <div className="lm-lp__control-grid">
            <div>
              <div className="lm-lp__sec-tag"><b>03</b>"Isn't SEO a slow, expensive agency retainer?"</div>
              <h2>It's slow <em>because it's a to-do list.</em></h2>
              <p>
                Agencies charge $3,000 a month and hand you a spreadsheet of backlink "opportunities" that get
                planned and never built. Rankings sit still while you wait on someone else's calendar. The agent
                runs the same three roles continuously and actually ships the work - so the line keeps climbing.
              </p>
              <ul>
                <li><span>Runs the <b>same three roles</b> an agency pod bills $3k/mo for.</span></li>
                <li><span>It <b>builds the backlinks</b>, not lists them - and submits on a schedule.</span></li>
                <li><span>Climbs <b>Google and AI answers</b>, on the keys you already pay for.</span></li>
              </ul>
            </div>
            <div className="lm-lp__control-visual">
              <div className="lm-lp__viz" style={{ animationDelay: "0.4s" }}>
                <div className="lm-lp__serp-bar">best cold email tool for agencies</div>
                <div className="lm-lp__serp-body">
                  <div className="lm-lp__serp-row lm-lp__serp-row--yours">
                    <div className="u">yoursite.com › agencies</div>
                    <div className="h">Best Cold Email Tool for Agencies (2026)<span className="move">▲ #6 → #2</span></div>
                  </div>
                  <div className="lm-lp__serp-row lm-lp__serp-row--dim">
                    <div className="u">roundupblog.com › tools</div>
                    <div className="h">12 Cold Email Tools Compared</div>
                  </div>
                </div>
                <div className="lm-lp__serp-links" aria-hidden="true">
                  <span className="chip ok">✓ 4 backlinks live</span>
                  <span className="chip">2 submitted</span>
                  <span className="chip ok">✓ cited by AI</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== FINAL CTA (red) ============== */}
      <section className="lm-lp__sec lm-lp__final">
        <div className="lm-lp__wrap">
          <span className="lm-lp__eyebrow"><i />Free · instant access</span>
          <h2>Get the agency pod. <em>Keep the $3k a month.</em></h2>
          <p>Drop your email and we'll send the exact prompts and the full build guide right now.</p>

          {sub.status === "done" ? (
            <p className="lm-lp__final-done">✓ Sent - check your inbox.</p>
          ) : (
            <>
              <form className="lm-lp__final-form" onSubmit={onSubmit}>
                <input
                  type="email"
                  value={sub.email}
                  onChange={(e) => sub.setEmail(e.target.value)}
                  placeholder="you@company.com"
                  aria-label="Work email address"
                  autoComplete="email"
                  disabled={sub.status === "submitting"}
                />
                <button type="submit" disabled={!sub.valid || sub.status === "submitting"}>
                  {sub.status === "submitting" ? "Sending…" : "Send me the prompts"}
                </button>
              </form>
              <p className="lm-lp__final-note">Instant delivery · no credit card · unsubscribe in one click</p>
            </>
          )}
        </div>
      </section>

      {/* ============== FOOTER ============== */}
      <footer className="lm-lp__foot">
        <div className="lm-lp__wrap">
          <div className="lm-lp__foot-row">
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
