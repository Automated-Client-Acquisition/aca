import { useEffect, useRef, useState } from "react";
import { useMapsSubscribe } from "@/hooks/useMapsSubscribe";
import "@/styles/aca-home.css";
import "@/styles/maps-scraper-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Free lead-magnet capture page: "Turn Google Maps into an unlimited local
// lead pipeline." One goal - capture the email, deliver the 12M business list
// + the Hermes Maps scraper system. Posts via useMapsSubscribe
// (source="maps-scraper" → delivery email with the Google Doc).
export default function GoogleMapsScraper() {
  // One shared opt-in instance so the hero form and the final CTA stay in sync.
  const sub = useMapsSubscribe();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sub.submit();
  }

  return (
    <div className="maps-lp">
      {/* ============== HERO (dark) ============== */}
      <section className="maps-lp__hero">
        <div className="maps-lp__wrap">
          <nav className="maps-lp__nav">
            <span className="maps-lp__brand">ACA<b>.</b></span>
            <span className="maps-lp__navnote">Free system · no credit card</span>
          </nav>

          <div className="maps-lp__hero-grid">
            {/* Left: pitch + form */}
            <div>
              <span className="maps-lp__eyebrow"><i />Free system · 12M businesses inside</span>
              <h1 className="maps-lp__title">
                Turn Google Maps into an <em>unlimited local lead pipeline<span aria-hidden="true">.</span></em>
              </h1>
              <p className="maps-lp__lead">
                Get the <b>list of 12 million businesses</b> plus the <b>Hermes scraper system</b> that pulls any
                local niche off Google Maps, finds the decision-maker's email, verifies it, and hands you a
                ready-to-send pipeline. <b>100% free.</b>
              </p>

              {sub.status === "done" ? (
                <div className="maps-lp__hero-done">
                  <span className="chk" aria-hidden="true">✓</span>
                  <div>
                    <h3>Check your inbox.</h3>
                    <p>
                      We just emailed you the 12M business list and the full Maps scraper system - it lands in under
                      a minute.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <form className="maps-lp__form" onSubmit={onSubmit}>
                    <input
                      id="maps-email"
                      type="email"
                      value={sub.email}
                      onChange={(e) => sub.setEmail(e.target.value)}
                      placeholder="you@company.com"
                      aria-label="Work email address"
                      autoComplete="email"
                      disabled={sub.status === "submitting"}
                    />
                    <button type="submit" className="maps-lp__submit" disabled={!sub.valid || sub.status === "submitting"}>
                      {sub.status === "submitting" ? "Sending…" : "Send me the list + system →"}
                    </button>
                  </form>
                  {sub.error ? <p className="maps-lp__form-error">{sub.error}</p> : null}
                  <div className="maps-lp__trust">
                    <span>Instant delivery</span>
                    <span>No credit card</span>
                    <span>Unsubscribe anytime</span>
                  </div>
                </>
              )}
            </div>

            {/* Right: scraper-to-pipeline mockup */}
            <div className="maps-lp__phone-wrap">
              <div className="maps-lp__phone-glow" aria-hidden="true" />

              <div className="maps-lp__chip maps-lp__chip--a" aria-hidden="true">
                <b>12M</b><span>businesses</span>
              </div>
              <div className="maps-lp__chip maps-lp__chip--b" aria-hidden="true">
                <b>98%</b><span>email deliverable</span>
              </div>

              <div className="maps-lp__phone" role="img" aria-label="The Hermes scraper pulling local businesses off Google Maps and verifying their emails">
                <div className="maps-lp__phone-screen">
                  <div className="maps-lp__tg-head">
                    <span className="maps-lp__tg-ava">H</span>
                    <div>
                      <div className="maps-lp__tg-name">Hermes Maps Scraper</div>
                      <div className="maps-lp__tg-status">scraping · "dentists in Austin"</div>
                    </div>
                  </div>
                  <div className="maps-lp__tg-body">
                    <div className="maps-lp__tg-bubble">
                      <span className="lbl">📍 Found on Google Maps</span>
                      <div><b>Bright Smile Dental</b> · Austin, TX - 4.8★ · 212 reviews · no website chat, runs Google Ads.</div>
                      <div className="maps-lp__tg-quote">
                        Angle found: paying for ads but missing 6+ reviews/mo their top competitor captures.
                      </div>
                    </div>
                    <div className="maps-lp__row">
                      <span className="dot dot--ok" />
                      <span className="name">Dr. Patel</span>
                      <span className="email">drpatel@brightsmile.com</span>
                    </div>
                    <div className="maps-lp__row">
                      <span className="dot dot--ok" />
                      <span className="name">Front Office</span>
                      <span className="email">hello@brightsmile.com</span>
                    </div>
                    <div className="maps-lp__tg-toast"><i />2 emails verified · added to pipeline</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== VALUE - what's inside ============== */}
      <section className="maps-lp__sec maps-lp__sec--paper">
        <div className="maps-lp__wrap">
          <div className="maps-lp__sec-tag"><b>01</b>What you get</div>
          <h2 className="maps-lp__sec-h">The list <em>and</em> the machine that fills it - <em>nothing held back.</em></h2>
          <p className="maps-lp__sec-sub">
            Not a teaser. The full 12M business list plus the complete system to scrape and verify unlimited new ones.
          </p>

          <div className="maps-lp__values">
            <div className="maps-lp__value">
              <span className="maps-lp__value-n">1</span>
              <div>
                <h3>12 million businesses</h3>
                <p>A ready-to-use database of local businesses to start from on day one - no scraping required to get going.</p>
              </div>
            </div>
            <div className="maps-lp__value">
              <span className="maps-lp__value-n">2</span>
              <div>
                <h3>Unlimited Maps scraping</h3>
                <p>The Hermes system pulls any niche in any city straight off Google Maps. Your pipeline never runs dry.</p>
              </div>
            </div>
            <div className="maps-lp__value">
              <span className="maps-lp__value-n">3</span>
              <div>
                <h3>Decision-maker emails</h3>
                <p>It enriches each business - finds the owner or decision-maker's real email, not a generic info@ dead end.</p>
              </div>
            </div>
            <div className="maps-lp__value">
              <span className="maps-lp__value-n">4</span>
              <div>
                <h3>Built-in email verification</h3>
                <p>Every address is verified before it hits your list, so you protect your domain and keep bounce rates low.</p>
              </div>
            </div>
            <div className="maps-lp__value">
              <span className="maps-lp__value-n">5</span>
              <div>
                <h3>The "right angle" playbook</h3>
                <p>The discovery layer that surfaces a real reason to reach out - so cold email to local businesses actually lands.</p>
              </div>
            </div>
            <div className="maps-lp__value">
              <span className="maps-lp__value-n">6</span>
              <div>
                <h3>Step-by-step setup guide</h3>
                <p>Wire it all up today, even if you've never built an agent before. We walk you through every step.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== STATS BAND (animated) ============== */}
      <section className="maps-lp__sec maps-lp__statsband">
        <div className="maps-lp__wrap">
          <div className="maps-lp__statsband-grid">
            <CountStat target={12} suffix="M" label="Businesses in the list" />
            <CountStat target={0} prefix="∞" suffix="" label="Maps scraping, no cap" />
            <CountStat target={100} suffix="%" label="Emails verified before send" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="maps-lp__sec maps-lp__sec--alt">
        <div className="maps-lp__wrap">
          <div className="maps-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="maps-lp__sec-h">Four moves. <em>Google Maps to inbox.</em></h2>
          <p className="maps-lp__sec-sub">The system runs the boring part end-to-end - you only show up to send and book.</p>

          <div className="maps-lp__pipe">
            <div className="maps-lp__pipe-step">
              <span className="maps-lp__pipe-node">01</span>
              <h3>Scrape the niche</h3>
              <p>Point it at any local niche and city - it pulls every matching business straight off Google Maps.</p>
            </div>
            <div className="maps-lp__pipe-step">
              <span className="maps-lp__pipe-node">02</span>
              <h3>Discover the angle</h3>
              <p>It studies each business and surfaces a real, specific reason they'd want to hear from you.</p>
            </div>
            <div className="maps-lp__pipe-step">
              <span className="maps-lp__pipe-node">03</span>
              <h3>Find &amp; verify the email</h3>
              <p>Pulls the decision-maker's email and verifies it, so your list is clean and your domain stays safe.</p>
            </div>
            <div className="maps-lp__pipe-step">
              <span className="maps-lp__pipe-node">04</span>
              <h3>Fill your pipeline</h3>
              <p>Verified contacts plus the angle flow into a ready-to-send pipeline. Rinse and repeat, unlimited.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== OBJECTION KILLER (dark) ============== */}
      <section className="maps-lp__sec maps-lp__control">
        <div className="maps-lp__wrap">
          <div className="maps-lp__control-grid">
            <div>
              <div className="maps-lp__sec-tag"><b>03</b>"But cold email to local businesses is dead"</div>
              <h2>It's not dead. <em>It's just crowded with lazy outreach.</em></h2>
              <p>
                Everyone blasts the same "I can build you a website" template to a generic info@ inbox - so of course
                it doesn't work. The businesses that get good outreach are rare, because almost nobody does the work
                to find a real reason to reach out.
              </p>
              <ul>
                <li><span>The system finds a <b>specific angle</b> for each business - a gap, an ad, a missing review.</span></li>
                <li><span>It reaches the <b>real decision-maker</b>, not a front-desk catch-all address.</span></li>
                <li><span>Verified emails keep you out of spam and protect your sending domain.</span></li>
              </ul>
            </div>
            <div className="maps-lp__control-visual">
              <div className="maps-lp__phone" style={{ transform: "rotate(-1.6deg)" }}>
                <div className="maps-lp__phone-screen">
                  <div className="maps-lp__tg-head">
                    <span className="maps-lp__tg-ava">H</span>
                    <div>
                      <div className="maps-lp__tg-name">Hermes Maps Scraper</div>
                      <div className="maps-lp__tg-status">angle found · roofing co.</div>
                    </div>
                  </div>
                  <div className="maps-lp__tg-body" style={{ minHeight: 260 }}>
                    <div className="maps-lp__tg-bubble">
                      <span className="lbl">🎯 Why they'll reply</span>
                      <div><b>Summit Roofing</b> · 4.9★ but only ranks #6 for "roof repair near me" - losing to a competitor with half the reviews.</div>
                      <div className="maps-lp__tg-quote">
                        "Noticed Summit's got the best reviews in town but you're sitting below 3 shops with worse ratings - here's the 1 thing fixing that…"
                      </div>
                    </div>
                    <div className="maps-lp__row">
                      <span className="dot dot--ok" />
                      <span className="name">Mike (Owner)</span>
                      <span className="email">mike@summitroofs.com</span>
                    </div>
                    <div className="maps-lp__tg-toast"><i />Verified · ready to send</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== FINAL CTA (red) ============== */}
      <section className="maps-lp__sec maps-lp__final">
        <div className="maps-lp__wrap">
          <span className="maps-lp__eyebrow"><i />Free · instant access</span>
          <h2>Grab the 12M list. Build the machine. <em>Own your pipeline.</em></h2>
          <p>Drop your email and we'll send the full business list and the Hermes Maps scraper system right now.</p>

          {sub.status === "done" ? (
            <p className="maps-lp__final-done">✓ Sent - check your inbox.</p>
          ) : (
            <>
              <form className="maps-lp__final-form" onSubmit={onSubmit}>
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
                  {sub.status === "submitting" ? "Sending…" : "Send me the list + system"}
                </button>
              </form>
              <p className="maps-lp__final-note">Instant delivery · no credit card · unsubscribe in one click</p>
            </>
          )}
        </div>
      </section>

      {/* ============== FOOTER ============== */}
      <footer className="maps-lp__foot">
        <div className="maps-lp__wrap">
          <div className="maps-lp__foot-row">
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

// Counts up to `target` once scrolled into view. Pure presentational flourish.
function CountStat({ target, suffix, label, prefix }: { target: number; suffix: string; label: string; prefix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !ran.current) {
          ran.current = true;
          const duration = 1100;
          const start = performance.now();
          const tick = (now: number) => {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(Math.round(eased * target));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  return (
    <div className="maps-lp__bigstat" ref={ref}>
      <b>{prefix ?? ""}{prefix ? "" : val}{suffix}</b>
      <span>{label}</span>
    </div>
  );
}
