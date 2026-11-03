import { CountStat } from "@/components/marketing/CountStat";
import { useLeadMagnetSubscribe } from "@/hooks/useLeadMagnetSubscribe";
import "@/styles/aca-home.css";
import "@/styles/lead-magnet-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Free lead-magnet capture page: the lead pipeline agent. Angle (from ACA idea
// leadAgent): it doesn't just clean a list - it reads each lead's site + LinkedIn,
// writes a business analysis, keeps only who fits what you sell, verifies the
// email, and loads the keepers into your sequence. "Nobody needs Clay."
// source="lead-pipeline-agent".
export default function LeadPipelineAgent() {
  const sub = useLeadMagnetSubscribe("lead-pipeline-agent");

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
              <span className="lm-lp__eyebrow"><i />Free agent build · researched, not just cleaned</span>
              <h1 className="lm-lp__title">
                Every lead in your sequence - <em>already researched<span aria-hidden="true">.</span></em>
              </h1>
              <p className="lm-lp__lead">
                Learn to build it yourself - you get the <b>exact prompts + step-by-step guide</b> for the lead
                pipeline agent that takes any raw list, <b>reads each lead's site and LinkedIn</b>, keeps only the
                ones who fit what you sell, verifies the email, and loads the keepers straight into your sequence.
                Copy, paste, and run it on your own keys.
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
                      id="leadpipeline-email"
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

            {/* Bespoke visual: raw list rows being researched + verified, funneling to a clean sequence */}
            <div className="lm-lp__phone-wrap">
              <div className="lm-lp__phone-glow" aria-hidden="true" />

              <div className="lm-lp__chip lm-lp__chip--a" aria-hidden="true">
                <b>Any</b><span>raw list</span>
              </div>
              <div className="lm-lp__chip lm-lp__chip--b" aria-hidden="true">
                <b>$0</b><span>enrichment bill</span>
              </div>

              <div className="lm-lp__panel" role="img" aria-label="Raw list rows the agent is researching: site and LinkedIn read, ICP-matched or dropped, email verified, then funneled from 2,400 down to 598 clean leads">
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                  </span>
                  <span className="h"><b>Raw list · 2,400 rows</b><span>researching each lead</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__lead-row">
                    <span className="co">Brightline Co</span>
                    <span className="steps" aria-hidden="true"><span>W</span><span>in</span><span>✓</span><span>✉</span></span>
                  </div>
                  <div className="lm-lp__lead-row lm-lp__lead-row--drop">
                    <span className="co">Nextgen LLC</span>
                    <span className="steps" aria-hidden="true"><span>W</span><span>in</span><span>✕</span></span>
                  </div>
                  <div className="lm-lp__lead-row">
                    <span className="co">Summit Partners</span>
                    <span className="steps" aria-hidden="true"><span>W</span><span>in</span><span>✓</span><span>✉</span></span>
                  </div>
                  <div className="lm-lp__lead-funnel" aria-hidden="true">
                    <div><b>2,400</b><span>raw in</span></div>
                    <div><b>612</b><span>ICP match</span></div>
                    <div><b>598</b><span>verified → sequence</span></div>
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
            Not a teaser. The exact copy-paste prompts, the research/scoring/verification logic, and the
            step-by-step setup to stand up your own lead pipeline agent on your keys.
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
                <h3>Keeps only who fits what you sell</h3>
                <p>It checks each lead against your services and drops the ones that don't match. No spray-and-pray.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">3</span>
              <div>
                <h3>Verifies every email</h3>
                <p>Dead addresses never get sent - your sending domain stays protected, bounce rates stay low.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">4</span>
              <div>
                <h3>Loads the keepers into your sequence</h3>
                <p>The survivors land straight in your campaign - no copy-pasting survivors into a CRM by hand.</p>
              </div>
            </div>
            <div className="lm-lp__value">
              <span className="lm-lp__value-n">5</span>
              <div>
                <h3>Any raw list, pennies per lead</h3>
                <p>CSV, Parquet, or a Maps export - on your own keys. No enrichment tool, no separate verifier, no researcher.</p>
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
            <CountStat target={0} prefix="Researched" suffix="" label="Not just cleaned - every lead" />
            <CountStat target={100} suffix="%" label="Emails verified before send" />
            <CountStat target={0} prefix="$0" suffix="" label="Enrichment subscription needed" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="lm-lp__sec lm-lp__sec--alt">
        <div className="lm-lp__wrap">
          <div className="lm-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="lm-lp__sec-h">Four moves. <em>Raw list to loaded sequence.</em></h2>
          <p className="lm-lp__sec-sub">The agent does the research, vetting, and cleaning you'd otherwise do by hand - for pennies.</p>

          <div className="lm-lp__pipe">
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">01</span>
              <h3>Drop in any list</h3>
              <p>CSV, Parquet, or a Maps export - it doesn't matter where the list came from.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">02</span>
              <h3>Research each lead</h3>
              <p>It reads the website and LinkedIn and writes a quick business analysis of who they are.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">03</span>
              <h3>Match &amp; verify</h3>
              <p>Checks each one against your offer, drops the misfits, and verifies the survivors' emails.</p>
            </div>
            <div className="lm-lp__pipe-step">
              <span className="lm-lp__pipe-node">04</span>
              <h3>Loads your sequence</h3>
              <p>Only researched, ICP-matched, verified leads land in your campaign, ready to send.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== OBJECTION KILLER (dark) ============== */}
      <section className="lm-lp__sec lm-lp__control">
        <div className="lm-lp__wrap">
          <div className="lm-lp__control-grid">
            <div>
              <div className="lm-lp__sec-tag"><b>03</b>"Doesn't Clay / an enrichment tool already do this?"</div>
              <h2>They clean a list. <em>This one researches it.</em></h2>
              <p>
                Enrichment tools append a job title and a guessed email behind a monthly bill. This agent opens
                every lead's website and LinkedIn, writes an analysis of what they actually do, and only keeps the
                ones that fit what you sell - so what lands in your sequence is already qualified, not just enriched.
              </p>
              <ul>
                <li><span>Replaces the <b>enrichment tool, the verifier, and the researcher</b> with one agent.</span></li>
                <li><span>Only keeps leads that <b>match your offer</b> - the rest never reach your sequence.</span></li>
                <li><span>Dead emails never send, so your <b>domain stays protected</b>.</span></li>
              </ul>
            </div>
            <div className="lm-lp__control-visual">
              <div className="lm-lp__panel" style={{ animationDelay: "0.4s" }}>
                <div className="lm-lp__panel-head">
                  <span className="ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                  </span>
                  <span className="h"><b>Loaded to sequence</b><span>598 researched · verified</span></span>
                  <span className="live">Live</span>
                </div>
                <div className="lm-lp__panel-body">
                  <div className="lm-lp__card">
                    <div className="lm-lp__card-top">
                      <span className="lm-lp__card-tag">ICP match · sent to sequence</span>
                      <span className="lm-lp__card-score">✓ verified</span>
                    </div>
                    <div className="lm-lp__card-name"><b>Summit Partners</b> <span>· boutique agency, 12 staff</span></div>
                    <div className="lm-lp__card-quote">"Runs paid ads, no cold-email motion - fits your offer. mike@summit… verified."</div>
                  </div>
                  <div className="lm-lp__lead-funnel" aria-hidden="true">
                    <div><b>2,400</b><span>raw in</span></div>
                    <div><b>612</b><span>ICP match</span></div>
                    <div><b>598</b><span>verified</span></div>
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
          <h2>Only email leads worth emailing. <em>Skip the enrichment bill.</em></h2>
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
