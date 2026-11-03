import { CountStat } from "@/components/marketing/CountStat";
import { useLeadMagnetSubscribe } from "@/hooks/useLeadMagnetSubscribe";
import "@/styles/aca-home.css";
import "@/styles/lead-magnet-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Free lead-magnet capture page: the SEC Form 4 agent. Angle (from ACA idea
// sec4Agent): reach people the WEEK they turn stock into millions in cash -
// insider sales are filed publicly, free, and fresh, and almost no advisor
// checks them. Be the first to call, not the tenth. source="sec-form4-agent".
export default function SecForm4Agent() {
  const sub = useLeadMagnetSubscribe("sec-form4-agent");

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
              <span className="lm-lp__eyebrow"><i />Free agent build · fresh public filings</span>
              <h1 className="lm-lp__title">
                Reach them the week they turn stock into <em>millions in cash<span aria-hidden="true">.</span></em>
              </h1>
              <p className="lm-lp__lead">
                Learn to build it yourself - you get the <b>exact prompts + step-by-step guide</b> for the SEC Form 4
                agent that catches insider stock sales the day they're filed, flags the people who just turned shares
                into <b>real cash</b>, and hands you a scored, review-ready list from <b>free public EDGAR filings</b>.
                Copy, paste, and run it on your own account.
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
                      id="sec4-email"
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

            {/* Bespoke visual: an EDGAR Form 4 filing resolving into a scored, newly-liquid prospect */}
            <div className="lm-lp__phone-wrap">
              <div className="lm-lp__phone-glow" aria-hidden="true" />

              <div className="lm-lp__chip lm-lp__chip--a" aria-hidden="true">
                <b>$2.08M</b><span>just went liquid</span>
              </div>
              <div className="lm-lp__chip lm-lp__chip--b" aria-hidden="true">
                <b>1st</b><span>advisor to call</span>
              </div>

              <div className="lm-lp__viz" role="img" aria-label="An SEC Form 4 filing the agent flagged: a CFO who just sold $2.08M of stock, scored 94, with no advisor of record">
                <div className="lm-lp__filing-ticker" aria-hidden="true">
                  <span>EDGAR</span><i />SEC.GOV<i />FORM 4<i />FILED TODAY
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__filing-head">
                  <span className="lm-lp__filing-doc">Form 4</span>
                  <span className="lm-lp__filing-sub">Statement of Changes in Beneficial Ownership</span>
                </div>
                <div className="lm-lp__filing-body">
                  <div className="lm-lp__filing-label">Reporting person</div>
                  <div className="lm-lp__filing-person">
                    <span className="lm-lp__filing-ava">DC</span>
                    <div>
                      <b>David R. Chen</b>
                      <span>CFO · Meridian Capital Group</span>
                    </div>
                  </div>
                  <div className="lm-lp__filing-label">Transaction · disposed</div>
                  <div className="lm-lp__filing-txn">
                    <span className="q">40,000 sh</span><span className="x">@ $52.10</span>
                    <div className="amt">▲ $2,084,000 <em>converted to cash</em></div>
                  </div>
                  <div className="lm-lp__viz-flag">
                    <span className="lm-lp__viz-flag-lbl">💰 Agent flag · filed 3 days ago</span>
                    <div className="lm-lp__viz-flag-row"><span>Fit score</span><b>94 / 100</b></div>
                    <div className="lm-lp__viz-flag-row"><span>Advisor of record</span><b>None found</b></div>
                    <div className="lm-lp__viz-flag-cta">→ Reach him before the other 9 advisors do</div>
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
            Not a teaser. The exact copy-paste prompts, the scoring logic, and the step-by-step setup to stand up
            your own SEC Form 4 agent today.
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
                <h3>Free, fresh, primary data</h3>
                <p>Straight from public SEC filings. No wealth list everyone else already bought, no per-record data fee.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">3</span>
              <div>
                <h3>Scored so you know who to call first</h3>
                <p>Every filing is ranked against your niche - transaction size, liquidity event, no advisor of record - so you work the best first.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">4</span>
              <div>
                <h3>Be the first, not the tenth</h3>
                <p>You reach people the week they come into money, before a single other advisor has them on a list.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">5</span>
              <div>
                <h3>Review-ready, compliance-minded</h3>
                <p>It hands you a list to review - you decide who to contact. Nothing auto-blasts a regulated prospect.</p>
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
            <CountStat target={0} prefix="$0" suffix="" label="Cost for primary EDGAR data" />
            <CountStat target={0} prefix="Days" suffix="" label="Fresh - not a months-old list" />
            <CountStat target={0} prefix="1st" suffix="" label="Advisor to reach them, not 10th" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="lm-lp__sec lm-lp__sec--alt">
        <div className="lm-lp__wrap">
          <div className="lm-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="lm-lp__sec-h">Four moves. <em>Filing to first call.</em></h2>
          <p className="lm-lp__sec-sub">The agent works the government website nobody checks - you just show up to review and call.</p>

          <div className="lm-lp__pipe">
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">01</span>
              <h3>Catch the filing</h3>
              <p>It watches EDGAR and pulls new Form 4 insider sales the day they're filed - free, primary data.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">02</span>
              <h3>Flag who just got liquid</h3>
              <p>It surfaces the people who just turned a block of stock into real cash - a live liquidity event.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">03</span>
              <h3>Score &amp; prioritize</h3>
              <p>Each one is scored against your niche so you know exactly who to call first.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">04</span>
              <h3>You review, then reach out</h3>
              <p>A review-ready list lands in your hands. You decide who to contact - compliance stays intact.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== OBJECTION KILLER (dark) ============== */}
      <section className="lm-lp__sec lm-lp__control">
        <div className="lm-lp__wrap">
          <div className="lm-lp__control-grid">
            <div>
              <div className="lm-lp__sec-tag"><b>03</b>"But that data is public - anyone can get it"</div>
              <h2>Exactly. <em>And almost no advisor checks it.</em></h2>
              <p>
                The wealth niche's best lead source is a free government website nobody opens. Insider sales are
                filed publicly within days - but digging through EDGAR by hand, scoring each filing, and spotting
                who just came into money is a job no advisor has time for. So they buy the same stale lists
                everyone else has. The agent works EDGAR for you, 24/7.
              </p>
              <ul>
                <li><span>Catches the sale the <b>week it happens</b> - not a list gone cold months ago.</span></li>
                <li><span>Flags the people who just turned stock into <b>real, spendable cash</b>.</span></li>
                <li><span>Scores each one and checks for <b>no advisor of record</b> - so you call the best first.</span></li>
              </ul>
            </div>
            <div className="lm-lp__control-visual">
              <div className="lm-lp__viz" style={{ animationDelay: "0.4s" }}>
                <div className="lm-lp__filing-ticker" aria-hidden="true">
                  <span>EDGAR</span><i />FORM 4<i />6 NEW TODAY
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__filing-head">
                  <span className="lm-lp__filing-doc">Form 4</span>
                  <span className="lm-lp__filing-sub">Newly-liquid prospects, scored</span>
                </div>
                <div className="lm-lp__filing-body">
                  <div className="lm-lp__filing-label">Reporting person</div>
                  <div className="lm-lp__filing-person">
                    <span className="lm-lp__filing-ava">SR</span>
                    <div>
                      <b>Sarah Reyes</b>
                      <span>VP Eng · Northstar Robotics</span>
                    </div>
                  </div>
                  <div className="lm-lp__filing-label">Transaction · option exercise + sale</div>
                  <div className="lm-lp__filing-txn">
                    <span className="q">31,500 sh</span><span className="x">vested + sold</span>
                    <div className="amt">▲ $2,180,000 <em>liquid this week</em></div>
                  </div>
                  <div className="lm-lp__viz-flag">
                    <span className="lm-lp__viz-flag-lbl">🎯 Why call now</span>
                    <div className="lm-lp__viz-flag-row"><span>Fit score</span><b>91 / 100</b></div>
                    <div className="lm-lp__viz-flag-row"><span>Advisor of record</span><b>None found</b></div>
                    <div className="lm-lp__viz-flag-cta">→ First liquidity event · no advisor yet</div>
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
          <h2>Stop buying stale lists. <em>Catch them the week they cash out.</em></h2>
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
