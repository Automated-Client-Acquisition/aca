import { CountStat } from "@/components/marketing/CountStat";
import { useLeadMagnetSubscribe } from "@/hooks/useLeadMagnetSubscribe";
import "@/styles/aca-home.css";
import "@/styles/lead-magnet-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Free lead-magnet capture page: the buying-signals agent. Angle (from ACA idea
// signalAgent): WARM leads based on signals - funding is table stakes everyone
// sells; the edge is custom signals + warm commenters (people publicly reacting
// in your space are showing intent right now). source="buying-signals-agent".
export default function BuyingSignalsAgent() {
  const sub = useLeadMagnetSubscribe("buying-signals-agent");

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
              <span className="lm-lp__eyebrow"><i />Free agent build · warm leads from live signals</span>
              <h1 className="lm-lp__title">
                Warm leads, the second they <em>show they're ready<span aria-hidden="true">.</span></em>
              </h1>
              <p className="lm-lp__lead">
                Learn to build it yourself - you get the <b>exact prompts + step-by-step guide</b> for the
                buying-signals agent that watches 428 sources for the signals <b>you</b> pick (a warm commenter on a
                competitor's post, a job change, a hiring surge, your own trigger) and pings you the moment one
                fires, with the account and <b>the reason to reach out</b>. Copy, paste, and run it on your own keys.
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
                      id="signals-email"
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

            {/* Bespoke visual: a live buying-signals feed, warm commenter on top */}
            <div className="lm-lp__phone-wrap">
              <div className="lm-lp__phone-glow" aria-hidden="true" />

              <div className="lm-lp__chip lm-lp__chip--a" aria-hidden="true">
                <b>428</b><span>sources watched</span>
              </div>
              <div className="lm-lp__chip lm-lp__chip--b" aria-hidden="true">
                <b>Warm</b><span>not cold</span>
              </div>

              <div className="lm-lp__panel" role="img" aria-label="A live buying-signals feed: a warm commenter shopping for a tool, a job change, and a hiring surge, each scored to reach now">
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M3 12h3l2-6 4 13 3-9 1.5 2H21" /></svg>
                  </span>
                  <span className="h"><b>Buying Signals</b><span>428 sources · 3× a day</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__card lm-lp__card--hot">
                    <div className="lm-lp__card-top">
                      <span className="lm-lp__card-tag">Warm commenter</span>
                      <span className="lm-lp__card-score">96 · reach now</span>
                    </div>
                    <div className="lm-lp__card-name"><b>Dana Okafor</b> <span>· commented on a competitor's post</span></div>
                    <div className="lm-lp__card-quote">"Does it integrate with HubSpot? Comparing options this week."</div>
                    <div className="lm-lp__card-cta">→ Reach her while she's still shopping</div>
                  </div>
                  <div className="lm-lp__card">
                    <div className="lm-lp__card-top">
                      <span className="lm-lp__card-tag">Job change</span>
                      <span className="lm-lp__card-score">88</span>
                    </div>
                    <div className="lm-lp__card-name"><b>New VP Sales</b> <span>· Acme Logistics</span></div>
                  </div>
                  <div className="lm-lp__card">
                    <div className="lm-lp__card-top">
                      <span className="lm-lp__card-tag">Hiring surge</span>
                      <span className="lm-lp__card-score">84</span>
                    </div>
                    <div className="lm-lp__card-name"><b>Ridge Analytics</b> <span>· 5 SDR roles this week</span></div>
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
            Not a teaser. The exact copy-paste prompts, the sources and scoring, and the step-by-step setup to
            stand up your own buying-signals agent on your keys.
          </p>

          <div className="lm-lp__values">
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">1</span>
              <div>
                <h3>Warm commenters - the sharpest signal</h3>
                <p>People publicly reacting to posts in your space are showing intent right now. It hands them to you while they're still deciding.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">2</span>
              <div>
                <h3>Signals you define, not a rented menu</h3>
                <p>A keyword you care about, a job change at a target account, a hiring surge, growth motion, or any custom trigger - the list is yours.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">3</span>
              <div>
                <h3>The full agent prompt</h3>
                <p>Copy, paste, and run. The exact prompt that powers the whole agent - no prompt engineering required.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">4</span>
              <div>
                <h3>Every lead carries a reason</h3>
                <p>Not a vague "in-market" score - the actual "why now," so your first message never lands cold.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">5</span>
              <div>
                <h3>Straight into your outreach</h3>
                <p>Warm accounts flow into your LinkedIn, email, and WhatsApp outreach - the list is yours, not rented.</p>
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
            <CountStat target={428} suffix="" label="Sources watched for your signals" />
            <CountStat target={3} suffix="×" label="Checked every single day" />
            <CountStat target={0} prefix="Warm" suffix="" label="Every lead comes with a reason" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="lm-lp__sec lm-lp__sec--alt">
        <div className="lm-lp__wrap">
          <div className="lm-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="lm-lp__sec-h">Four moves. <em>Signal to warm lead.</em></h2>
          <p className="lm-lp__sec-sub">You pick what "ready to buy" means in your market - it watches for exactly that.</p>

          <div className="lm-lp__pipe">
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">01</span>
              <h3>Pick your signals</h3>
              <p>A keyword mention, a warm commenter, a job change, a hiring surge, growth motion, or your own custom trigger.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">02</span>
              <h3>It watches 428 sources</h3>
              <p>Three times a day, for exactly the signals you chose - so you catch the moment one fires.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">03</span>
              <h3>Pings you with the reason</h3>
              <p>The account plus the "why now," the second someone shows real intent - not just when they raised money.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">04</span>
              <h3>Straight into outreach</h3>
              <p>Warm leads flow into your LinkedIn, email, and WhatsApp - every message already has a reason.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== OBJECTION KILLER (dark) ============== */}
      <section className="lm-lp__sec lm-lp__control">
        <div className="lm-lp__wrap">
          <div className="lm-lp__control-grid">
            <div>
              <div className="lm-lp__sec-tag"><b>03</b>"Isn't this just the funding alerts everyone sells?"</div>
              <h2>Funding is table stakes. <em>The warm ones hide in plain sight.</em></h2>
              <p>
                Every competitor buys the same funding alerts - so by the time you reach out, you're pitch number
                fifty. The real intent is public but nobody's watching it: someone commenting on a competitor's
                post asking if it does X, a new VP who owns the budget, a team hiring hard. The agent watches those,
                because you told it to.
              </p>
              <ul>
                <li><span>Catches a <b>warm commenter</b> the afternoon they're shopping, not weeks later.</span></li>
                <li><span>Tracks <b>signals you defined</b> - not a fixed menu you rent from a platform.</span></li>
                <li><span>Hands you the <b>reason</b>, so your first line lands warm instead of cold.</span></li>
              </ul>
            </div>
            <div className="lm-lp__control-visual">
              <div className="lm-lp__panel" style={{ animationDelay: "0.4s" }}>
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M3 12h3l2-6 4 13 3-9 1.5 2H21" /></svg>
                  </span>
                  <span className="h"><b>Warm commenter</b><span>caught 12 min ago</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__card lm-lp__card--hot">
                    <div className="lm-lp__card-top">
                      <span className="lm-lp__card-tag">Reacting in your space</span>
                      <span className="lm-lp__card-score">94 · reach now</span>
                    </div>
                    <div className="lm-lp__card-name"><b>Marcus Bell</b> <span>· Head of Growth, Vantel</span></div>
                    <div className="lm-lp__card-quote">"We're actively looking to switch off ours - what do people rate?"</div>
                    <div className="lm-lp__card-cta">→ "Saw your comment on that thread…"</div>
                  </div>
                  <div className="lm-lp__card">
                    <div className="lm-lp__card-top">
                      <span className="lm-lp__card-tag">Your custom signal</span>
                      <span className="lm-lp__card-score">tracked</span>
                    </div>
                    <div className="lm-lp__card-name"><b>"migrating off [competitor]"</b> <span>· keyword hit</span></div>
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
          <h2>Stop cold-messaging strangers. <em>Reach people the second they're warm.</em></h2>
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
