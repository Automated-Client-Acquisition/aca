import { CountStat } from "@/components/marketing/CountStat";
import { useLeadMagnetSubscribe } from "@/hooks/useLeadMagnetSubscribe";
import "@/styles/aca-home.css";
import "@/styles/lead-magnet-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Free lead-magnet capture page: the YouTube automation agent. Angle (from ACA
// idea youtubeAgent): it studies what's already ranking in your niche, finds
// the gaps, and hands you a month of videos built to beat them - each with a
// ready-to-read script. "I haven't opened a blank doc since." source="youtube-agent".
export default function YoutubeAutomationAgent() {
  const sub = useLeadMagnetSubscribe("youtube-agent");

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
              <span className="lm-lp__eyebrow"><i />Free agent build · a month of scripts in one sitting</span>
              <h1 className="lm-lp__title">
                A month of videos built to beat <em>what's already ranking<span aria-hidden="true">.</span></em>
              </h1>
              <p className="lm-lp__lead">
                Learn to build it yourself - you get the <b>exact prompts + step-by-step guide</b> for the YouTube
                agent that studies what's already winning in your niche, finds the <b>gaps nobody's covering</b>, and
                hands you a month of videos built to beat them, each with a <b>ready-to-read script</b>. Copy, paste,
                and run it on your own channel.
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
                      id="youtube-email"
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

            {/* Bespoke visual: what's ranking now → the gap the agent found → your video built to beat it */}
            <div className="lm-lp__phone-wrap">
              <div className="lm-lp__phone-glow" aria-hidden="true" />

              <div className="lm-lp__chip lm-lp__chip--a" aria-hidden="true">
                <b>30</b><span>videos in one sitting</span>
              </div>
              <div className="lm-lp__chip lm-lp__chip--b" aria-hidden="true">
                <b>0</b><span>blank docs</span>
              </div>

              <div className="lm-lp__panel" role="img" aria-label="The YouTube agent showing what ranks now, the content gap it found, and your video built to beat the current number one">
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3V9z" /></svg>
                  </span>
                  <span className="h"><b>Your niche · ranking now</b><span>gap → your script</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__rank-row">
                    <span className="pos">#1</span>
                    <span className="lm-lp__rank-thumb" aria-hidden="true" />
                    <span className="t">Cold Email Tips That Still Work<span>3 years ago · thin, no chapters</span></span>
                  </div>
                  <div className="lm-lp__rank-row">
                    <span className="pos">#2</span>
                    <span className="lm-lp__rank-thumb" aria-hidden="true" />
                    <span className="t">Best Cold Email Tools 2023<span>18 months ago · outdated</span></span>
                  </div>
                  <div className="lm-lp__rank-row lm-lp__rank-row--gap">
                    <span className="pos" aria-hidden="true">◇</span>
                    <span className="t"><span className="lm-lp__rank-gap-lbl">Gap the agent found</span>Nobody's covered deliverability for 2026</span>
                  </div>
                  <div className="lm-lp__rank-row lm-lp__rank-row--yours">
                    <span className="pos" aria-hidden="true">▲</span>
                    <span className="lm-lp__rank-thumb" aria-hidden="true" />
                    <span className="t">Cold Email Deliverability in 2026 (the 4 things that matter)<span>your script · built to beat #1</span></span>
                  </div>
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
            Not a teaser. The exact copy-paste prompts, the research and scripting logic, and the step-by-step setup
            to stand up your own YouTube agent on your channel.
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
                <h3>Finds the gaps nobody covers</h3>
                <p>It spots what the top videos are missing and builds a video designed to be better and more thorough.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">3</span>
              <div>
                <h3>A month of videos in one sitting</h3>
                <p>Sit down once and walk away weeks ahead - a full month planned instead of a day behind.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">4</span>
              <div>
                <h3>A ready-to-read script for each</h3>
                <p>Every video comes with an angle and a script you can read straight to camera. Just record.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">5</span>
              <div>
                <h3>The plan carries over</h3>
                <p>It keeps the roadmap, so next month starts half done - posting weekly finally becomes doable.</p>
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
            <CountStat target={30} suffix="" label="Days of video, one sitting" />
            <CountStat target={0} prefix="0" suffix="" label="Blank docs to stare at" />
            <CountStat target={0} prefix="Beat" suffix="" label="Built on what already ranks" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="lm-lp__sec lm-lp__sec--alt">
        <div className="lm-lp__wrap">
          <div className="lm-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="lm-lp__sec-h">Four moves. <em>Niche to a month of scripts.</em></h2>
          <p className="lm-lp__sec-sub">The agent owns the part that stalls you - the blank doc. You just record.</p>

          <div className="lm-lp__pipe">
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">01</span>
              <h3>Tell it your channel</h3>
              <p>Give it your topic - it goes and checks what's already working in your niche.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">02</span>
              <h3>Find the gaps</h3>
              <p>It spots what the ranking videos miss - the angles nobody's covered well.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">03</span>
              <h3>Plan a month, built to beat</h3>
              <p>A full month of videos, each built to be better and more thorough than what ranks now.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">04</span>
              <h3>Hands you the scripts</h3>
              <p>An angle and a ready-to-read script for every one. You show up and record.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== OBJECTION KILLER (dark) ============== */}
      <section className="lm-lp__sec lm-lp__control">
        <div className="lm-lp__wrap">
          <div className="lm-lp__control-grid">
            <div>
              <div className="lm-lp__sec-tag"><b>03</b>"I can shoot - I just run out of ideas worth shooting"</div>
              <h2>Exactly. <em>So the agent owns the ideas, not you.</em></h2>
              <p>
                Most creators don't stall on the camera - they stall on the blank doc every Monday, guessing at
                topics with no idea if they'll land. This agent studies your niche continuously and hands you a
                ranked, ready-to-shoot roadmap built on what's already proven to work.
              </p>
              <ul>
                <li><span>A roadmap built from <b>real ranking gaps</b>, not a brainstorm.</span></li>
                <li><span>Every video <b>built to beat the current #1</b> - better and more thorough.</span></li>
                <li><span>A <b>ready-to-read script</b> for each, so all that's left is to record.</span></li>
              </ul>
            </div>
            <div className="lm-lp__control-visual">
              <div className="lm-lp__panel" style={{ animationDelay: "0.4s" }}>
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3V9z" /></svg>
                  </span>
                  <span className="h"><b>This month's plan</b><span>week 3 · script ready</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__rank-row lm-lp__rank-row--yours">
                    <span className="pos" aria-hidden="true">▲</span>
                    <span className="lm-lp__rank-thumb" aria-hidden="true" />
                    <span className="t">Why your cold emails hit spam (and the 4 fixes)<span>hook + 6 scenes + script · ready</span></span>
                  </div>
                  <div className="lm-lp__rank-row">
                    <span className="pos">2</span>
                    <span className="lm-lp__rank-thumb" aria-hidden="true" />
                    <span className="t">The inbox-rotation setup nobody explains<span>queued · week 3</span></span>
                  </div>
                  <div className="lm-lp__rank-row">
                    <span className="pos">3</span>
                    <span className="lm-lp__rank-thumb" aria-hidden="true" />
                    <span className="t">I sent 10k cold emails - here's the data<span>queued · week 4</span></span>
                  </div>
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
          <h2>Turn YouTube into a system. <em>Never face a blank doc again.</em></h2>
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
