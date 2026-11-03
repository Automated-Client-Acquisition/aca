import { CountStat } from "@/components/marketing/CountStat";
import { useLeadMagnetSubscribe } from "@/hooks/useLeadMagnetSubscribe";
import "@/styles/aca-home.css";
import "@/styles/lead-magnet-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Free lead-magnet capture page: the carousel factory agent. Angle (from ACA
// idea carouselAgent): you never touch Canva or log into a platform - you drop
// a link in Telegram and it builds an on-brand carousel and publishes it to
// every TikTok/IG/LinkedIn account at once. source="carousel-agent".
export default function CarouselFactoryAgent() {
  const sub = useLeadMagnetSubscribe("carousel-agent");

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
              <span className="lm-lp__eyebrow"><i />Free agent build · never open Canva again</span>
              <h1 className="lm-lp__title">
                Drop a link in Telegram. <em>Get it posted everywhere<span aria-hidden="true">.</span></em>
              </h1>
              <p className="lm-lp__lead">
                Learn to build it yourself - you get the <b>exact prompts + step-by-step guide</b> for the carousel
                agent that turns a Telegram message or a URL into a finished, on-brand carousel, then publishes it to
                <b> all your TikTok, Instagram, and LinkedIn accounts at once</b>. Copy, paste, and run it - no Canva,
                no SaaS subscription.
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
                      id="carousel-email"
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

            {/* Bespoke visual: a Telegram link → a fanned on-brand deck → published to 3 platforms at once */}
            <div className="lm-lp__phone-wrap">
              <div className="lm-lp__phone-glow" aria-hidden="true" />

              <div className="lm-lp__chip lm-lp__chip--a" aria-hidden="true">
                <b>1</b><span>text message</span>
              </div>
              <div className="lm-lp__chip lm-lp__chip--b" aria-hidden="true">
                <b>$0</b><span>no Canva, no SaaS</span>
              </div>

              <div className="lm-lp__panel" role="img" aria-label="A YouTube link dropped into Telegram becomes a fanned on-brand carousel, published to TikTok, Instagram, and LinkedIn at once">
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M21 5 3 12l6 2 2 6 3-4 4 3 3-14z" /></svg>
                  </span>
                  <span className="h"><b>Carousel Factory</b><span>from one Telegram message</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__deck-trigger">🔗 you: youtube.com/watch?v=… <b>→ make a carousel</b></div>
                  <div className="lm-lp__deck-fan" aria-hidden="true">
                    <div className="lm-lp__deck-slide"><div className="bar" /><div className="ln" /><div className="ln s" /></div>
                    <div className="lm-lp__deck-slide"><div className="bar" /><div className="ln" /><div className="ln s" /></div>
                    <div className="lm-lp__deck-slide"><div className="bar" /><div className="ln" /><div className="ln s" /></div>
                    <div className="lm-lp__deck-slide"><div className="bar" /><div className="ln" /><div className="ln s" /></div>
                  </div>
                  <div className="lm-lp__deck-publish">
                    Published to
                    <span className="plat">TikTok</span>
                    <span className="plat">Instagram</span>
                    <span className="plat">LinkedIn</span>
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
            Not a teaser. The exact copy-paste prompts, the generation and brand rules, and the step-by-step setup
            to stand up your own carousel agent on your keys.
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
                <h3>On-brand, every time</h3>
                <p>Your colours, fonts, and style baked in - every deck looks like your brand made it, not a template.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">3</span>
              <div>
                <h3>Writes the caption too</h3>
                <p>Post copy that earns the swipe, written in your voice - not just the slides.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">4</span>
              <div>
                <h3>Publishes everywhere at once</h3>
                <p>From that same chat it pushes live to all your TikTok, Instagram, and LinkedIn accounts - no scheduler.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">5</span>
              <div>
                <h3>No designer, no SaaS</h3>
                <p>Pennies per deck on your own keys - no Canva seat, no per-export fee, no scheduling tool.</p>
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
            <CountStat target={1} suffix="" label="Telegram message to publish" />
            <CountStat target={3} suffix="+" label="Accounts posted at once" />
            <CountStat target={0} prefix="$0" suffix="" label="No Canva, no SaaS, no designer" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="lm-lp__sec lm-lp__sec--alt">
        <div className="lm-lp__wrap">
          <div className="lm-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="lm-lp__sec-h">Four moves. <em>Link to live, everywhere.</em></h2>
          <p className="lm-lp__sec-sub">You stay in Telegram the whole time - no Canva, no logins, no scheduler.</p>

          <div className="lm-lp__pipe">
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">01</span>
              <h3>Drop a link in Telegram</h3>
              <p>A message, a URL, or a video link - that's the whole input.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">02</span>
              <h3>It builds the deck</h3>
              <p>Pulls the strongest points into a finished carousel in your brand, and writes the caption.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">03</span>
              <h3>You approve</h3>
              <p>A quick look, right there in the chat - nothing goes out without your say-so.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">04</span>
              <h3>Posts everywhere at once</h3>
              <p>Live to all your TikTok, Instagram, and LinkedIn accounts - straight from the chat.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== OBJECTION KILLER (dark) ============== */}
      <section className="lm-lp__sec lm-lp__control">
        <div className="lm-lp__wrap">
          <div className="lm-lp__control-grid">
            <div>
              <div className="lm-lp__sec-tag"><b>03</b>"Isn't a carousel half a day of design work?"</div>
              <h2>It was. <em>Now it's a text message.</em></h2>
              <p>
                Between the design tool, writing every slide from a blank frame, the caption, then exporting and
                posting to each account one at a time, a single carousel eats half a day. This agent owns research
                through publish as one job - you drop a link into Telegram and approve what comes back.
              </p>
              <ul>
                <li><span>One video link becomes <b>a week of posts</b>, across every account.</span></li>
                <li><span>Runs from a <b>text message</b> - no design software to open.</span></li>
                <li><span>Publishes to <b>every account at once</b>, no separate scheduling tool.</span></li>
              </ul>
            </div>
            <div className="lm-lp__control-visual">
              <div className="lm-lp__panel" style={{ animationDelay: "0.4s" }}>
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M21 5 3 12l6 2 2 6 3-4 4 3 3-14z" /></svg>
                  </span>
                  <span className="h"><b>Before the coffee's cold</b><span>1 link → 5 posts</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__deck-trigger">🔗 you: [podcast episode] <b>→ 5 carousels</b></div>
                  <div className="lm-lp__deck-fan" aria-hidden="true">
                    <div className="lm-lp__deck-slide"><div className="bar" /><div className="ln" /><div className="ln s" /></div>
                    <div className="lm-lp__deck-slide"><div className="bar" /><div className="ln" /><div className="ln s" /></div>
                    <div className="lm-lp__deck-slide"><div className="bar" /><div className="ln" /><div className="ln s" /></div>
                    <div className="lm-lp__deck-slide"><div className="bar" /><div className="ln" /><div className="ln s" /></div>
                  </div>
                  <div className="lm-lp__deck-publish">
                    Live on
                    <span className="plat">TikTok</span>
                    <span className="plat">IG</span>
                    <span className="plat">LinkedIn</span>
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
          <h2>A week of posts from one link. <em>Straight from a text.</em></h2>
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
