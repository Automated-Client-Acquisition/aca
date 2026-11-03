import { Link } from "react-router-dom";
import { SPRINT, OTO2_PAYMENT_LINK } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";

// OTO 2: VIP upgrade ($97) - the personal-attention tier. Different value
// category than OTO 1 (that was assets; this is access). Capped seats keep the
// promise deliverable and the urgency honest.
export default function SprintVip() {
  const nextHref = "/sprint/welcome";
  const canBuy = OTO2_PAYMENT_LINK.length > 0;

  return (
    <div className="sf">
      <div className="sf__bar">Step 3 of 3 · Last step before your welcome page</div>

      <main className="sf__letter sf__wrap">
        <header className="sf__head sf__head--light" style={{ paddingBottom: 0 }}>
          <div className="sf__prehead">Final offer - {SPRINT.oto2.seats} seats per Sprint, first come first served</div>
          <h1 className="sf__h1" style={{ fontSize: "clamp(26px,5vw,38px)" }}>
            Want us to <em>personally</em> make sure yours works?
          </h1>
        </header>

        <p>
          Everyone in the Sprint builds the same machine. But there are two variables no group session
          can fully fix for you: <b>your targeting</b> and <b>your messages</b>. Get those two right
          and an average build books calls. Get them wrong and even a perfect build goes quiet.
        </p>
        <p><b>VIP means we fix those two with you, directly:</b></p>
        <ul>
          <li>
            <b>Your targeting, reviewed by us.</b> Before Day 2, we personally review who you're
            aiming the machine at and tighten it - the single highest-leverage fix there is.
          </li>
          <li>
            <b>Your messages, rewritten by us.</b> We take your draft openers and follow-ups and mark
            them up line by line, in your voice, against what's currently converting.
          </li>
          <li>
            <b>A Day-4 hot seat.</b> When your machine goes live, you get a dedicated slot: we look at
            your first sends and replies together and correct course on the spot.
          </li>
          <li>
            <b>Front of the queue</b> in every Q&amp;A, all five days.
          </li>
        </ul>
        <p>
          We cap VIP at <b>{SPRINT.oto2.seats} builders per Sprint</b> because this is real, personal
          review time - it doesn't scale, and we won't pretend it does.
        </p>

        <div className="sf__stack">
          <h3>VIP Upgrade</h3>
          <div className="sf__stack-row"><span>Personal targeting review before Day 2</span><span className="v">$197</span></div>
          <div className="sf__stack-row"><span>Line-by-line message markup</span><span className="v">$197</span></div>
          <div className="sf__stack-row"><span>Day-4 live hot seat on your machine</span><span className="v">$147</span></div>
          <div className="sf__stack-row"><span>Priority Q&amp;A all week</span><span className="v">$47</span></div>
          <div className="sf__stack-total">
            <span className="was">Worth $588</span>
            <span className="now">This page only: ${SPRINT.oto2.price}</span>
          </div>
        </div>

        {canBuy ? (
          <>
            <a className="sf__cta" href={OTO2_PAYMENT_LINK}>
              YES! Upgrade Me To VIP - ${SPRINT.oto2.price}
            </a>
            <p className="sf__cta-note">One-time payment · {SPRINT.oto2.seats} seats only</p>
            <Link className="sf__decline" to={nextHref}>
              No thanks - I'll figure out my targeting and messages on my own. Take me to my welcome page.
            </Link>
          </>
        ) : (
          <Link className="sf__cta" to={nextHref}>Continue to my welcome page →</Link>
        )}
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
