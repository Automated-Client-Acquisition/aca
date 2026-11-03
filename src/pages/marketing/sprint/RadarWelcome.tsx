import { RADAR, SKOOL_URL } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";
import "@/styles/marketing-specialized.css";

// Radar funnel thank-you page. No pitch - momentum toward an installed agent
// and a first collection run today.
export default function RadarWelcome() {
  return (
    <div className="sf">
      <div className="sf__bar">
        Welcome - let's get your agent <b>watching the market today</b>
      </div>

      <main className="sf__letter sf__wrap">
        <header className="sf__head sf__head--light" style={{ paddingBottom: 0 }}>
          <div className="sf__prehead">Order confirmed</div>
          <h1 className="sf__h1" style={{ fontSize: "clamp(28px,5vw,42px)" }}>
            You're in. Your agent can be live within the hour.
          </h1>
          <p className="sf__sub">Four steps. Don't save them for the weekend - momentum is the whole game.</p>
        </header>

        <img
          className="sf__shot"
          src="/radar/radar-bundle.jpg"
          alt="Your Buying Signals Kit: the agent, the First Meeting Playbook, the walkthrough, both bonuses, and 30 days of ACA Xtreme - all yours now"
          decoding="async"
          style={{ marginTop: 22 }}
        />

        <div style={{ marginTop: 26 }}>
          <div className="sf__step">
            <span className="sf__step-n">1</span>
            <div>
              <h4>Open your confirmation email</h4>
              <p>
                Your Kit, the install walkthrough, and your ACA login are inside. Not there in 5
                minutes? Check spam/promotions, then email us and we'll sort it.
              </p>
            </div>
          </div>
          <div className="sf__step">
            <span className="sf__step-n">2</span>
            <div>
              <h4>Do the 30-minute install now</h4>
              <p>
                Follow the walkthrough top to bottom - it sets up Hermes Agent (the free, open-source
                runtime your agent lives in) and then your agent, copy-paste, done. The single biggest
                predictor of who books meetings with this: installing today instead of "this weekend."
              </p>
            </div>
          </div>
          <div className="sf__step">
            <span className="sf__step-n">3</span>
            <div>
              <h4>Run your first collection</h4>
              <p>
                Describe who you sell to and let the agent pull its first batch of signals today -
                your proof feed. The First Meeting Playbook shows you exactly which ones to act on
                first and what to send.
              </p>
            </div>
          </div>
          <div className="sf__step">
            <span className="sf__step-n">4</span>
            <div>
              <h4>Post your win in the community</h4>
              <p>
                Your 30 days of ACA Xtreme start now - <a href={SKOOL_URL} target="_blank" rel="noopener noreferrer">join here</a>,
                introduce yourself, and post your first signal batch. The weekly live builds are where
                your one agent becomes a stack.
              </p>
            </div>
          </div>
        </div>

        <div className="sf__guarantee" style={{ marginTop: 30 }}>
          <h3>Remember the deal</h3>
          <p>
            30 days, keep-everything guarantee. The only way to lose here is to let the Kit sit in
            your inbox while buying windows open and close. Install it today - future you says
            thanks.
          </p>
        </div>

        <div className="sf__disclose">
          <b>Billing reminder (no surprises):</b> your Kit included 30 days of ACA Xtreme. It renews
          at ${RADAR.renewalPrice}/month after - cancel anytime in one click from your account. Your
          receipt lists everything you bought today.
        </div>
      </main>

      <footer className="sf__foot">
        <div className="sf__wrap">
          © {new Date().getFullYear()} Automated Client Acquisition · <a href="/privacy">Privacy</a> ·{" "}
          <a href="/terms">Terms</a>
        </div>
      </footer>
    </div>
  );
}
