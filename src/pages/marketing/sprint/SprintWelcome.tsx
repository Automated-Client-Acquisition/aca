import { SPRINT, SKOOL_URL } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";

// Thank-you / welcome page. No pitch - buyers already hold membership (it's in
// the ticket). Job #1: onboarding momentum (email, community, calendar, ACA
// login) so day one of the Sprint starts warm and month two of the membership
// takes care of itself.
export default function SprintWelcome() {
  return (
    <div className="sf">
      <div className="sf__bar">
        Welcome aboard - Sprint starts <b>{SPRINT.startLabel}</b>
      </div>

      <main className="sf__letter sf__wrap">
        <header className="sf__head sf__head--light" style={{ paddingBottom: 0 }}>
          <div className="sf__prehead">Order confirmed</div>
          <h1 className="sf__h1" style={{ fontSize: "clamp(26px,5vw,38px)" }}>
            You're in. Here's exactly what to do next.
          </h1>
          <p className="sf__sub">
            Do these four things today - they take 10 minutes and make Day 1 twice as valuable.
          </p>
        </header>

        <div style={{ marginTop: 26 }}>
          <div className="sf__step">
            <span className="sf__step-n">1</span>
            <div>
              <h4>Open your confirmation email</h4>
              <p>
                It has your receipt, your ACA login, and your Sprint calendar invites. Not there in 5
                minutes? Check spam/promotions, then email us and we'll sort it.
              </p>
            </div>
          </div>
          <div className="sf__step">
            <span className="sf__step-n">2</span>
            <div>
              <h4>Join the community and say hi</h4>
              <p>
                Your 30 days of ACA Xtreme start now - don't wait for Day 1.{" "}
                <a href={SKOOL_URL} target="_blank" rel="noopener noreferrer">Join here</a>, introduce
                yourself in #new-builders, and tell us what you sell. The intros thread is where
                Sprint teammates find each other.
              </p>
            </div>
          </div>
          <div className="sf__step">
            <span className="sf__step-n">3</span>
            <div>
              <h4>Put the five sessions in your calendar</h4>
              <p>
                Accept the invites the moment they land. Builders who attend live finish; builders who
                "watch later" usually don't. Protect the hour.
              </p>
            </div>
          </div>
          <div className="sf__step">
            <span className="sf__step-n">4</span>
            <div>
              <h4>Do the 10-minute prep</h4>
              <p>
                Before Day 1, jot down: who your best client ever was, what you sold them, and what it
                was worth. That's it - Day 1 turns those three answers into your targeting.
              </p>
            </div>
          </div>
        </div>

        <div className="sf__guarantee" style={{ marginTop: 30 }}>
          <h3>One promise back from us</h3>
          <p>
            Show up and build, and your agent is live by Friday - that's the deal, and it's covered by
            the Live-By-Friday guarantee. See you {SPRINT.startLabel}.
          </p>
        </div>

        <div className="sf__disclose">
          <b>Billing reminder (no surprises):</b> your ticket included 30 days of ACA Xtreme. It
          renews at ${SPRINT.renewalPrice}/month after - cancel anytime in one click from your
          account. Your receipt lists everything you bought today.
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
