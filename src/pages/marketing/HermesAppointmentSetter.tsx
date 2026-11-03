import { useEffect, useRef, useState } from "react";
import { useHermesSubscribe } from "@/hooks/useHermesSubscribe";
import "@/styles/aca-home.css";
import "@/styles/hermes-lp.css";
import "@/styles/marketing-specialized.css";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Free lead-magnet capture page: "How to build a Hermes LinkedIn Appointment
// Setter". One goal - capture the email, deliver the prompt + setup guide.
// Posts via useHermesSubscribe (source="hermes-agent" → delivery email).
export default function HermesAppointmentSetter() {
  // One shared opt-in instance so the hero form and the final CTA stay in sync.
  const sub = useHermesSubscribe();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sub.submit();
  }

  function jumpToForm() {
    const el = document.getElementById("hermes-email");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  }

  return (
    <div className="hermes-lp">
      {/* ============== HERO (dark) ============== */}
      <section className="hermes-lp__hero">
        <div className="hermes-lp__wrap">
          <nav className="hermes-lp__nav">
            <span className="hermes-lp__brand">ACA<b>.</b></span>
            <span className="hermes-lp__navnote">Free build · no credit card</span>
          </nav>

          <div className="hermes-lp__hero-grid">
            {/* Left: pitch + form */}
            <div>
              <span className="hermes-lp__eyebrow"><i />Free agent build · steal the system</span>
              <h1 className="hermes-lp__title">
                A LinkedIn appointment setter that books calls{" "}
                <em>while you sleep<span aria-hidden="true">.</span></em>
              </h1>
              <p className="hermes-lp__lead">
                Get the <b>exact Hermes agent prompt + setup guide</b> for the system that hunts down in-market
                buyers, starts real conversations, and books meetings for you - and you approve every message
                from your phone. <b>100% free.</b>
              </p>

              {sub.status === "done" ? (
                <div className="hermes-lp__hero-done">
                  <span className="chk" aria-hidden="true">✓</span>
                  <div>
                    <h3>Check your inbox.</h3>
                    <p>
                      We just emailed you the agent prompt and the full setup guide - it lands in under a minute.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <form className="hermes-lp__form" onSubmit={onSubmit}>
                    <input
                      id="hermes-email"
                      type="email"
                      value={sub.email}
                      onChange={(e) => sub.setEmail(e.target.value)}
                      placeholder="you@company.com"
                      aria-label="Work email address"
                      autoComplete="email"
                      disabled={sub.status === "submitting"}
                    />
                    <button type="submit" className="hermes-lp__submit" disabled={!sub.valid || sub.status === "submitting"}>
                      {sub.status === "submitting" ? "Sending…" : "Send me the build →"}
                    </button>
                  </form>
                  {sub.error ? <p className="hermes-lp__form-error">{sub.error}</p> : null}
                  <div className="hermes-lp__trust">
                    <span>Instant delivery</span>
                    <span>No credit card</span>
                    <span>Unsubscribe anytime</span>
                  </div>
                </>
              )}
            </div>

            {/* Right: Telegram approval mockup */}
            <div className="hermes-lp__phone-wrap">
              <div className="hermes-lp__phone-glow" aria-hidden="true" />

              <div className="hermes-lp__chip hermes-lp__chip--a" aria-hidden="true">
                <b>40%+</b><span>accept rate</span>
              </div>
              <div className="hermes-lp__chip hermes-lp__chip--b" aria-hidden="true">
                <b>30%+</b><span>reply rate</span>
              </div>

              <div className="hermes-lp__phone" role="img" aria-label="Telegram approval prompt: the agent asks you to approve a message before sending">
                <div className="hermes-lp__phone-screen">
                  <div className="hermes-lp__tg-head">
                    <span className="hermes-lp__tg-ava">H</span>
                    <div>
                      <div className="hermes-lp__tg-name">Hermes Agent</div>
                      <div className="hermes-lp__tg-status">online · awaiting your approval</div>
                    </div>
                  </div>
                  <div className="hermes-lp__tg-body">
                    <div className="hermes-lp__tg-bubble">
                      <span className="lbl">🎯 ICP match</span>
                      <div><b>Sarah Chen</b> · VP Sales @ Northwind - commented on a competitor's post 2h ago.</div>
                      <div className="hermes-lp__tg-quote">
                        "Hey Sarah - saw your take on outbound dying. We just booked 14 calls last week doing the
                        opposite. Worth a quick swap of notes?"
                      </div>
                    </div>
                    <div className="hermes-lp__tg-actions">
                      <span className="hermes-lp__tg-btn hermes-lp__tg-btn--approve">Approve</span>
                      <span className="hermes-lp__tg-btn hermes-lp__tg-btn--edit">Edit</span>
                      <span className="hermes-lp__tg-btn hermes-lp__tg-btn--skip">Skip</span>
                    </div>
                    <div className="hermes-lp__tg-toast"><i />Approved · sent · meeting booked</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== VALUE - what's inside ============== */}
      <section className="hermes-lp__sec hermes-lp__sec--paper">
        <div className="hermes-lp__wrap">
          <div className="hermes-lp__sec-tag"><b>01</b>What you get</div>
          <h2 className="hermes-lp__sec-h">Everything to build it yourself - <em>nothing held back.</em></h2>
          <p className="hermes-lp__sec-sub">
            Not a teaser. The complete blueprint to stand up your own appointment setter today.
          </p>

          <div className="hermes-lp__values">
            <div className="hermes-lp__value">
              <span className="hermes-lp__value-n">1</span>
              <div>
                <h3>The full agent prompt</h3>
                <p>Copy, paste, and run. The exact prompt that powers the whole system - no prompt engineering required.</p>
              </div>
            </div>
            <div className="hermes-lp__value">
              <span className="hermes-lp__value-n">2</span>
              <div>
                <h3>Competitor post mining</h3>
                <p>It finds your competitors' best-performing posts and harvests every person engaging with them.</p>
              </div>
            </div>
            <div className="hermes-lp__value">
              <span className="hermes-lp__value-n">3</span>
              <div>
                <h3>Automatic ICP filtering</h3>
                <p>Only the people who match your exact offer make it through. You never waste a message on the wrong lead.</p>
              </div>
            </div>
            <div className="hermes-lp__value">
              <span className="hermes-lp__value-n">4</span>
              <div>
                <h3>One-tap Telegram approval</h3>
                <p>Every message waits for your tap before it sends. The agent never goes rogue or says anything off-brand.</p>
              </div>
            </div>
            <div className="hermes-lp__value">
              <span className="hermes-lp__value-n">5</span>
              <div>
                <h3>Step-by-step setup guide</h3>
                <p>Wire it up and go live today - even if you've never built an AI agent before. We walk you through every step.</p>
              </div>
            </div>
            <div className="hermes-lp__value">
              <span className="hermes-lp__value-n">6</span>
              <div>
                <h3>Books calls on autopilot</h3>
                <p>Conversations move toward a booked meeting without you babysitting the inbox. You just show up.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== STATS BAND (animated) ============== */}
      <section className="hermes-lp__sec hermes-lp__statsband">
        <div className="hermes-lp__wrap">
          <div className="hermes-lp__statsband-grid">
            <CountStat target={40} suffix="%+" label="Connection accept rate" />
            <CountStat target={30} suffix="%+" label="Reply rate" />
            <CountStat target={100} suffix="%" label="Messages you approve" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="hermes-lp__sec hermes-lp__sec--alt">
        <div className="hermes-lp__wrap">
          <div className="hermes-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="hermes-lp__sec-h">Four moves. <em>Zero manual prospecting.</em></h2>
          <p className="hermes-lp__sec-sub">The agent runs the boring part end-to-end - you only show up to booked calls.</p>

          <div className="hermes-lp__pipe">
            <div className="hermes-lp__pipe-step">
              <span className="hermes-lp__pipe-node">01</span>
              <h3>Finds what's working</h3>
              <p>Scans competitors and surfaces the posts already pulling real engagement.</p>
            </div>
            <div className="hermes-lp__pipe-step">
              <span className="hermes-lp__pipe-node">02</span>
              <h3>Pulls the commenters</h3>
              <p>Harvests everyone who engaged - warm people who already raised their hand.</p>
            </div>
            <div className="hermes-lp__pipe-step">
              <span className="hermes-lp__pipe-node">03</span>
              <h3>Filters to your ICP</h3>
              <p>Only the people who fit your exact offer make it through. No spray-and-pray.</p>
            </div>
            <div className="hermes-lp__pipe-step">
              <span className="hermes-lp__pipe-node">04</span>
              <h3>Books the meeting</h3>
              <p>Reaches out in your voice and drives the conversation to a booked call.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== CONTROL / TELEGRAM (dark) ============== */}
      <section className="hermes-lp__sec hermes-lp__control">
        <div className="hermes-lp__wrap">
          <div className="hermes-lp__control-grid">
            <div>
              <div className="hermes-lp__sec-tag"><b>03</b>You stay in control</div>
              <h2>Full automation - <em>without losing your voice.</em></h2>
              <p>
                The fear with AI outreach is it'll say something dumb and torch your reputation. Hermes can't.
                Before anything sends, it pings you in Telegram with the exact draft.
              </p>
              <ul>
                <li>One tap to <b>approve</b>, <b>edit</b>, or <b>skip</b> - right from your phone.</li>
                <li>Nothing goes out off-brand, off-script, or to the wrong person.</li>
                <li>Set it loose on volume, keep a human hand on every message.</li>
              </ul>
            </div>
            <div className="hermes-lp__control-visual">
              <div className="hermes-lp__phone" style={{ transform: "rotate(-1.6deg)" }}>
                <div className="hermes-lp__phone-screen">
                  <div className="hermes-lp__tg-head">
                    <span className="hermes-lp__tg-ava">H</span>
                    <div>
                      <div className="hermes-lp__tg-name">Hermes Agent</div>
                      <div className="hermes-lp__tg-status">3 drafts waiting</div>
                    </div>
                  </div>
                  <div className="hermes-lp__tg-body" style={{ minHeight: 260 }}>
                    <div className="hermes-lp__tg-bubble">
                      <span className="lbl">Reply detected</span>
                      <div><b>Marcus L.</b> replied: "Sounds interesting - what's the catch?"</div>
                      <div className="hermes-lp__tg-quote">"No catch. 20 min, I'll show you exactly how we'd run it for your team. Thursday or Friday work?"</div>
                    </div>
                    <div className="hermes-lp__tg-actions">
                      <span className="hermes-lp__tg-btn hermes-lp__tg-btn--approve">Approve</span>
                      <span className="hermes-lp__tg-btn hermes-lp__tg-btn--edit">Edit</span>
                      <span className="hermes-lp__tg-btn hermes-lp__tg-btn--skip">Skip</span>
                    </div>
                    <div className="hermes-lp__tg-toast"><i />Sent in your voice</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== FINAL CTA (red) ============== */}
      <section className="hermes-lp__sec hermes-lp__final">
        <div className="hermes-lp__wrap">
          <span className="hermes-lp__eyebrow"><i />Free · instant access</span>
          <h2>Steal the system. Book the calls. <em>Keep the credit.</em></h2>
          <p>Drop your email and we'll send the full Hermes appointment-setter prompt and setup guide right now.</p>

          {sub.status === "done" ? (
            <p className="hermes-lp__final-done">✓ Sent - check your inbox.</p>
          ) : (
            <>
              <form className="hermes-lp__final-form" onSubmit={onSubmit}>
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
                  {sub.status === "submitting" ? "Sending…" : "Send me the build"}
                </button>
              </form>
              <p className="hermes-lp__final-note">Instant delivery · no credit card · unsubscribe in one click</p>
            </>
          )}
        </div>
      </section>

      {/* ============== FOOTER ============== */}
      <footer className="hermes-lp__foot">
        <div className="hermes-lp__wrap">
          <div className="hermes-lp__foot-row">
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
function CountStat({ target, suffix, label }: { target: number; suffix: string; label: string }) {
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
    <div className="hermes-lp__bigstat" ref={ref}>
      <b>{val}{suffix}</b>
      <span>{label}</span>
    </div>
  );
}
