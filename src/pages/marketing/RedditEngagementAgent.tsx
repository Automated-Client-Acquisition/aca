import { CountStat } from "@/components/marketing/CountStat";
import { useLeadMagnetSubscribe } from "@/hooks/useLeadMagnetSubscribe";
import "@/styles/aca-home.css";
import "@/styles/lead-magnet-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Free lead-magnet capture page: the Reddit engagement agent. Angle (from ACA
// idea redditAgent): Reddit is full of buyers asking "what should I use?" - the
// agent runs dozens of karma-warmed, protected accounts that find those threads
// and reply in a human voice, so you get there before they hit Google, without
// getting banned. source="reddit-agent".
export default function RedditEngagementAgent() {
  const sub = useLeadMagnetSubscribe("reddit-agent");

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
              <span className="lm-lp__eyebrow"><i />Free agent build · warm buyers, no bans</span>
              <h1 className="lm-lp__title">
                Get in the threads where buyers ask <em>"what should I use?"<span aria-hidden="true"></span></em>
              </h1>
              <p className="lm-lp__lead">
                Learn to build it yourself - you get the <b>exact prompts + step-by-step guide</b> for the Reddit
                agent that runs dozens of karma-warmed, protected accounts, finds the threads where your buyers are
                asking what to use, and drafts a reply in a <b>real human voice</b> - so you're in front of them
                <b> before they ever hit Google</b>. Copy, paste, and run it on your own accounts.
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
                      id="reddit-email"
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

            {/* Bespoke visual: a Reddit thread with a buyer asking + the agent's human-voice reply */}
            <div className="lm-lp__phone-wrap">
              <div className="lm-lp__phone-glow" aria-hidden="true" />

              <div className="lm-lp__chip lm-lp__chip--a" aria-hidden="true">
                <b>0</b><span>bans</span>
              </div>
              <div className="lm-lp__chip lm-lp__chip--b" aria-hidden="true">
                <b>Dozens</b><span>of warmed accounts</span>
              </div>

              <div className="lm-lp__panel" role="img" aria-label="A Reddit thread where a buyer asks which tool to use, with the agent's human-voice reply drafted from a karma-warmed, protected account">
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">r/</span>
                  <span className="h"><b>r/SaaS</b><span>a buyer is asking right now</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__card">
                    <div className="lm-lp__reddit-post">
                      <div className="lm-lp__reddit-votes" aria-hidden="true">
                        <span className="up">▲</span>342<span>▼</span>
                      </div>
                      <div>
                        <div className="lm-lp__reddit-sub">u/growthlead · 2h</div>
                        <div className="lm-lp__reddit-title">What cold email tool are people using that isn't $200/mo?</div>
                        <div className="lm-lp__reddit-meta">💬 47 comments · rising</div>
                      </div>
                    </div>
                  </div>
                  <div className="lm-lp__reddit-reply">
                    <div className="who"><span aria-hidden="true">↩</span> Your agent · drafted in a human voice</div>
                    <p>"Been down this exact road - most of the cheap ones fall over on deliverability. What actually worked for me was…"</p>
                  </div>
                  <div className="lm-lp__reddit-acct">
                    <span className="ok" aria-hidden="true">●</span> u/casey_builds · warmed 21d · 4.2k karma · <span className="ok">protected</span>
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
            Not a teaser. The exact copy-paste prompts, the warmup logic and voice, and the step-by-step setup to
            stand up your own Reddit agent on your accounts.
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
                <h3>Dozens of accounts, real karma</h3>
                <p>Each one warmed up with genuine karma first, so it reads like a regular, not a day-old throwaway.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">3</span>
              <div>
                <h3>Replies in a real human voice</h3>
                <p>Casual, config-driven personas that fit Reddit - helpful first, so the reply sticks instead of getting removed.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">4</span>
              <div>
                <h3>Every account protected</h3>
                <p>Human-paced, browser-fallback posting when the API blocks - built so nothing gets flagged.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">5</span>
              <div>
                <h3>There before Google</h3>
                <p>Buyers research on Reddit before they ever search. You're in the conversation first.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">6</span>
              <div>
                <h3>DEMO mode + pause switch</h3>
                <p>Test it dry before it posts live, and stop the whole thing with one switch. You stay in control.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== STATS BAND ============== */}
      <section className="lm-lp__sec lm-lp__statsband">
        <div className="lm-lp__wrap">
          <div className="lm-lp__statsband-grid">
            <CountStat target={0} prefix="Dozens" suffix="" label="Warmed accounts working at once" />
            <CountStat target={0} prefix="Human" suffix="" label="Voice that doesn't get removed" />
            <CountStat target={0} prefix="0" suffix="" label="Bans - protected by design" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="lm-lp__sec lm-lp__sec--alt">
        <div className="lm-lp__wrap">
          <div className="lm-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="lm-lp__sec-h">Four moves. <em>Niche to warm reply.</em></h2>
          <p className="lm-lp__sec-sub">The agent works the boring, risky part end-to-end - you stay in control.</p>

          <div className="lm-lp__pipe">
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">01</span>
              <h3>Warm up safely</h3>
              <p>Tell it your niche - it warms dozens of accounts with real karma before any of them post.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">02</span>
              <h3>Find the buyers</h3>
              <p>It hunts the exact threads where people are asking what to use in your space.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">03</span>
              <h3>Reply in a human voice</h3>
              <p>Helpful, casual, on-brand - a reply that reads like a real person, not a pitch.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">04</span>
              <h3>Work every thread, protected</h3>
              <p>Across dozens of accounts, on its own - with DEMO mode and a pause switch in your hands.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== OBJECTION KILLER (dark) ============== */}
      <section className="lm-lp__sec lm-lp__control">
        <div className="lm-lp__wrap">
          <div className="lm-lp__control-grid">
            <div>
              <div className="lm-lp__sec-tag"><b>03</b>"Isn't Reddit automation a fast track to a ban?"</div>
              <h2>Only if you rush it. <em>The agent doesn't.</em></h2>
              <p>
                Most people get removed because they show up on a day-old account and pitch. This agent warms every
                account with real karma first, writes like an actual Redditor, paces itself like a human, and falls
                back to the browser when the API blocks - so it works the threads without tripping a flag.
              </p>
              <ul>
                <li><span>Real karma warmup - <b>no day-one throwaway</b> behavior that gets flagged.</span></li>
                <li><span>A voice that's <b>helpful first</b>, so the reply sticks instead of getting removed.</span></li>
                <li><span><b>DEMO mode and a pause switch</b> keep you fully in control.</span></li>
              </ul>
            </div>
            <div className="lm-lp__control-visual">
              <div className="lm-lp__panel" style={{ animationDelay: "0.4s" }}>
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">r/</span>
                  <span className="h"><b>r/Entrepreneur</b><span>reply approved · posted</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__card">
                    <div className="lm-lp__reddit-post">
                      <div className="lm-lp__reddit-votes" aria-hidden="true">
                        <span className="up">▲</span>+14<span>▼</span>
                      </div>
                      <div>
                        <div className="lm-lp__reddit-sub">your reply · top comment</div>
                        <div className="lm-lp__reddit-title">"Ended up building something small for this myself - happy to share what worked."</div>
                        <div className="lm-lp__reddit-meta">💬 3 replies · "this is exactly what I needed"</div>
                      </div>
                    </div>
                  </div>
                  <div className="lm-lp__reddit-acct">
                    <span className="ok" aria-hidden="true">●</span> soft mention only when asked · <span className="ok">no flags</span>
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
          <h2>Get in front of buyers on Reddit. <em>Before they ever hit Google.</em></h2>
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
