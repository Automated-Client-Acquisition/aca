import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "@/styles/aca-home.css";
import "@/styles/autopilot-lp.css";

// ACA product landing: "Warm leads from inbound and outbound - on autopilot."
// Cinematic direct-response layout on the ACA brand system (landing-page-designer
// skill), with AI-filmed ambient loops (GPT Image 2 stills animated via Kling)
// behind the hero, stats band, and final CTA. Single goal: Start free -> /auth.
export default function AutopilotLanding() {
  return (
    <div className="autopilot-lp">
      {/* ============== HERO (dark, filmed) ============== */}
      <section className="autopilot-lp__hero">
        <FilmLoop src="/media/autopilot-hero.mp4" poster="/media/autopilot-hero.jpg" />
        <div className="autopilot-lp__hero-scrim" aria-hidden="true" />
        <div className="autopilot-lp__wrap">
          <nav className="autopilot-lp__nav">
            <span className="autopilot-lp__brand">ACA<b>.</b></span>
            <span className="autopilot-lp__navnote">Free to start · no credit card</span>
          </nav>

          <div className="autopilot-lp__hero-grid">
            {/* Left: pitch + CTA */}
            <div>
              <span className="autopilot-lp__eyebrow"><i />Inbound + outbound · one engine</span>
              <h1 className="autopilot-lp__title">
                Warm leads from inbound and outbound - <em>on autopilot<span aria-hidden="true">.</span></em>
              </h1>
              <p className="autopilot-lp__lead">
                ACA runs the <b>content that pulls buyers in</b> and the <b>outreach that goes and gets them</b> -
                LinkedIn, email, WhatsApp, Instagram, Telegram, SMS. Every reply lands in one inbox with an
                AI draft waiting in your voice. You approve. You close.
              </p>
              <div className="autopilot-lp__cta-row">
                <Link to="/auth" className="autopilot-lp__cta">Start free →</Link>
                <a href="#how-it-works" className="autopilot-lp__cta autopilot-lp__cta--ghost">See how it works</a>
              </div>
              <div className="autopilot-lp__trust">
                <span>No credit card</span>
                <span>6 channels, one sequence</span>
                <span>White-label for agencies</span>
              </div>
            </div>

            {/* Right: ACA inbox / autopilot approval mockup */}
            <div className="autopilot-lp__phone-wrap">
              <div className="autopilot-lp__phone-glow" aria-hidden="true" />

              <div className="autopilot-lp__chip autopilot-lp__chip--a" aria-hidden="true">
                <b>6</b><span>channels</span>
              </div>
              <div className="autopilot-lp__chip autopilot-lp__chip--b" aria-hidden="true">
                <b>1</b><span>inbox</span>
              </div>

              <div className="autopilot-lp__phone" role="img" aria-label="ACA autopilot asks you to approve a drafted reply before it sends">
                <div className="autopilot-lp__phone-screen">
                  <div className="autopilot-lp__tg-head">
                    <span className="autopilot-lp__tg-ava">A</span>
                    <div>
                      <div className="autopilot-lp__tg-name">ACA Autopilot</div>
                      <div className="autopilot-lp__tg-status">reply detected · draft ready</div>
                    </div>
                  </div>
                  <div className="autopilot-lp__tg-body">
                    <div className="autopilot-lp__tg-bubble">
                      <span className="lbl">LinkedIn · ICP match</span>
                      <div><b>Sarah Chen</b> · VP Sales @ Northwind replied: “Interesting - how does this actually work?”</div>
                      <div className="autopilot-lp__tg-quote">
                        “Great question. 20 minutes and I'll show you the exact system on a live account -
                        Thursday or Friday work?”
                      </div>
                    </div>
                    <div className="autopilot-lp__tg-actions">
                      <span className="autopilot-lp__tg-btn autopilot-lp__tg-btn--approve">Approve</span>
                      <span className="autopilot-lp__tg-btn autopilot-lp__tg-btn--edit">Edit</span>
                      <span className="autopilot-lp__tg-btn autopilot-lp__tg-btn--skip">Skip</span>
                    </div>
                    <div className="autopilot-lp__tg-toast"><i />Sent · sequence paused · deal created</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== VALUE - what runs on autopilot ============== */}
      <section className="autopilot-lp__sec autopilot-lp__sec--paper">
        <div className="autopilot-lp__wrap">
          <div className="autopilot-lp__sec-tag"><b>01</b>What runs on autopilot</div>
          <h2 className="autopilot-lp__sec-h">The whole acquisition engine - <em>not another point tool.</em></h2>
          <p className="autopilot-lp__sec-sub">
            One system runs the work of a content team, an SDR team, and an ops person - and hands you
            the conversations.
          </p>

          <div className="autopilot-lp__values">
            <div className="autopilot-lp__value">
              <span className="autopilot-lp__value-n">1</span>
              <div>
                <h4>Content that attracts</h4>
                <p>AI blueprints turn your brand voice into posts, carousels, and video on a schedule - so the right buyers come to you.</p>
              </div>
            </div>
            <div className="autopilot-lp__value">
              <span className="autopilot-lp__value-n">2</span>
              <div>
                <h4>Every lead captured</h4>
                <p>Form fills, DMs, comments, and lead magnets become CRM contacts automatically. Nothing lives in a spreadsheet.</p>
              </div>
            </div>
            <div className="autopilot-lp__value">
              <span className="autopilot-lp__value-n">3</span>
              <div>
                <h4>Enriched and verified</h4>
                <p>Every contact is scored against your ICP; emails are found and verified before a single message sends.</p>
              </div>
            </div>
            <div className="autopilot-lp__value">
              <span className="autopilot-lp__value-n">4</span>
              <div>
                <h4>Outreach on six channels</h4>
                <p>Sequences that switch between LinkedIn, email, WhatsApp and more - with delays, conditions, and sender rotation built in.</p>
              </div>
            </div>
            <div className="autopilot-lp__value">
              <span className="autopilot-lp__value-n">5</span>
              <div>
                <h4>One inbox for everything</h4>
                <p>Every reply from every channel in a single thread-aware view. A real reply pauses the sequence instantly.</p>
              </div>
            </div>
            <div className="autopilot-lp__value">
              <span className="autopilot-lp__value-n">6</span>
              <div>
                <h4>Drafts in your voice</h4>
                <p>Autopilot writes the follow-up for every conversation. You approve, edit, or skip - from your phone.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== STATS BAND (dark, filmed, animated) ============== */}
      <section className="autopilot-lp__sec autopilot-lp__statsband">
        <FilmLoop src="/media/autopilot-ink.mp4" poster="/media/autopilot-ink.jpg" />
        <div className="autopilot-lp__statsband-scrim" aria-hidden="true" />
        <div className="autopilot-lp__wrap">
          <div className="autopilot-lp__statsband-grid">
            <CountStat target={6} suffix="" label="Channels, one sequence" />
            <CountStat target={100} suffix="%" label="Messages you control" />
            <CountStat target={24} suffix="/7" label="Working while you sleep" />
          </div>
        </div>
      </section>

      {/* ============== PIPELINE ============== */}
      <section className="autopilot-lp__sec autopilot-lp__sec--alt" id="how-it-works">
        <div className="autopilot-lp__wrap">
          <div className="autopilot-lp__sec-tag"><b>02</b>How it works</div>
          <h2 className="autopilot-lp__sec-h">Cold to closed. <em>Four moves.</em></h2>
          <p className="autopilot-lp__sec-sub">You set the ICP and connect your channels once. The engine runs the rest.</p>

          <div className="autopilot-lp__pipe">
            <div className="autopilot-lp__pipe-step">
              <span className="autopilot-lp__pipe-node">01</span>
              <h4>Attract</h4>
              <p>Scheduled content and lead magnets pull in-market buyers toward you.</p>
            </div>
            <div className="autopilot-lp__pipe-step">
              <span className="autopilot-lp__pipe-node">02</span>
              <h4>Enrich</h4>
              <p>Contacts are ICP-scored, emails found and verified - only real fits go on.</p>
            </div>
            <div className="autopilot-lp__pipe-step">
              <span className="autopilot-lp__pipe-node">03</span>
              <h4>Reach</h4>
              <p>Multi-channel sequences start real conversations at scale, in your voice.</p>
            </div>
            <div className="autopilot-lp__pipe-step">
              <span className="autopilot-lp__pipe-node">04</span>
              <h4>You close</h4>
              <p>Replies land warm in one inbox with a draft waiting. You show up and close.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== CONTROL / objection-killer (dark) ============== */}
      <section className="autopilot-lp__sec autopilot-lp__control">
        <div className="autopilot-lp__wrap">
          <div className="autopilot-lp__control-grid">
            <div>
              <div className="autopilot-lp__sec-tag"><b>03</b>You stay in control</div>
              <h2>Automation that never <em>sounds automated.</em></h2>
              <p>
                The fear with AI outreach is that it says something dumb to the right person. In ACA,
                nothing sends without your say-so.
              </p>
              <ul>
                <li>Every draft waits for a one-tap <b>approve</b>, <b>edit</b>, or <b>skip</b>.</li>
                <li>A genuine reply <b>stops the sequence instantly</b> - no follow-up ever lands on a live conversation.</li>
                <li>Trained on <b>your brand voice</b>, not a generic template library.</li>
              </ul>
            </div>
            <div className="autopilot-lp__control-visual">
              <div className="autopilot-lp__phone" style={{ transform: "rotate(-1.6deg)" }}>
                <div className="autopilot-lp__phone-screen">
                  <div className="autopilot-lp__tg-head">
                    <span className="autopilot-lp__tg-ava">A</span>
                    <div>
                      <div className="autopilot-lp__tg-name">ACA Autopilot</div>
                      <div className="autopilot-lp__tg-status">3 drafts waiting</div>
                    </div>
                  </div>
                  <div className="autopilot-lp__tg-body" style={{ minHeight: 260 }}>
                    <div className="autopilot-lp__tg-bubble">
                      <span className="lbl">Email · out-of-office detected</span>
                      <div><b>Marcus L.</b> is away until Monday.</div>
                      <div className="autopilot-lp__tg-quote">Sequence paused automatically - resumes Tuesday 9:00 in his timezone.</div>
                    </div>
                    <div className="autopilot-lp__tg-actions">
                      <span className="autopilot-lp__tg-btn autopilot-lp__tg-btn--approve">Looks right</span>
                      <span className="autopilot-lp__tg-btn autopilot-lp__tg-btn--edit">Adjust</span>
                      <span className="autopilot-lp__tg-btn autopilot-lp__tg-btn--skip">Stop</span>
                    </div>
                    <div className="autopilot-lp__tg-toast"><i />Nothing sends without you</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== FINAL CTA (red, filmed) ============== */}
      <section className="autopilot-lp__sec autopilot-lp__final">
        <FilmLoop src="/media/autopilot-silk.mp4" poster="/media/autopilot-silk.jpg" />
        <div className="autopilot-lp__final-scrim" aria-hidden="true" />
        <div className="autopilot-lp__wrap">
          <span className="autopilot-lp__eyebrow"><i />Free to start · every channel included</span>
          <h2>Your pipeline shouldn't depend on <em>your free time.</em></h2>
          <p>Point ACA at your ICP, connect your channels, and let the engine run. Show up only for conversations that matter.</p>
          <div className="autopilot-lp__cta-row" style={{ justifyContent: "center" }}>
            <Link to="/auth" className="autopilot-lp__cta">Start free →</Link>
          </div>
          <p className="autopilot-lp__final-note">No credit card · cancel anytime · white-label for agencies</p>
        </div>
      </section>

      {/* ============== FOOTER ============== */}
      <footer className="autopilot-lp__foot">
        <div className="autopilot-lp__wrap">
          <div className="autopilot-lp__foot-row">
            <span>© {new Date().getFullYear()} Automated Client Acquisition</span>
            <span>
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

// Ambient film loop: muted, looping, lazy - pauses offscreen, hides entirely
// under prefers-reduced-motion (CSS) leaving the section's own background.
function FilmLoop({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true; // ensure the property is set before any play() attempt
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let inView = false;
    // play() can abort if the observer fires before the video has data -
    // retry on loadeddata so the loop always starts once it's ready.
    const tryPlay = () => {
      if (inView) void el.play().catch(() => {});
    };
    const io = new IntersectionObserver(
      (entries) => {
        inView = entries[0].isIntersecting;
        if (inView) tryPlay();
        else el.pause();
      },
      { threshold: 0.05 }
    );
    io.observe(el);
    el.addEventListener("loadeddata", tryPlay);
    return () => {
      io.disconnect();
      el.removeEventListener("loadeddata", tryPlay);
    };
  }, []);

  return (
    <video
      ref={ref}
      className="autopilot-lp__film"
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
    />
  );
}

// Counts up to `target` once scrolled into view.
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
    <div className="autopilot-lp__bigstat" ref={ref}>
      <b>{val}{suffix}</b>
      <span>{label}</span>
    </div>
  );
}
