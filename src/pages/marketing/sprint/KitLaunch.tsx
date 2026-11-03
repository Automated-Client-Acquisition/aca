import { Link } from "react-router-dom";
import { KIT, OTO2_PAYMENT_LINK } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";
import "@/styles/marketing-specialized.css";

// Kit funnel OTO 2 ($97): Launch With Us - a live group working session where
// we install + aim the buyer's agent with them and review their first offer.
// Access/implementation value (different category than OTO 1's assets).
export default function KitLaunch() {
  const nextHref = "/kit/welcome";
  const canBuy = OTO2_PAYMENT_LINK.length > 0;

  return (
    <div className="sf">
      <div className="sf__bar">Step 3 of 3 · Last step before your welcome page</div>

      <main className="sf__letter sf__wrap">
        <header className="sf__head sf__head--light" style={{ paddingBottom: 0 }}>
          <div className="sf__prehead">Final offer - {KIT.oto2.seats} seats per session</div>
          <h1 className="sf__h1" style={{ fontSize: "clamp(28px,5vw,42px)" }}>
            Want to launch yours <em>with us, live?</em>
          </h1>
        </header>

        <p>
          The walkthrough gets your agent running. But there are two places where doing it alone costs
          people days: <b>aiming it at the right niche</b>, and <b>making the first offer</b>. On the
          Launch Session we do both with you, live.
        </p>
        <img
          className="sf__shot"
          src="/offers/launch-ticket.jpg"
          alt="Your ticket to the Launch Session - live, we install yours with you, 20 seats per session"
          decoding="async"
        />
        <ul>
          <li>
            <b>We install together.</b> A live group working session - you share your screen when
            you're stuck, and we fix it on the spot. Nobody leaves without their agent running.
          </li>
          <li>
            <b>We aim it with you.</b> You'll tell us your city/niche/offer, and we'll dial in your
            targeting live - the difference between output that sells and output that sits.
          </li>
          <li>
            <b>We review your first offer.</b> Your first outreach message or sample package, marked
            up before you send it - so your first impression isn't your worst one.
          </li>
          <li>
            <b>Recording included</b> - rewatch your own review any time.
          </li>
        </ul>
        <p>
          Sessions run every week and we cap them at <b>{KIT.oto2.seats} builders</b> so everyone's
          screen actually gets looked at.
        </p>

        <div className="sf__stack">
          <h3>The Launch Session</h3>
          <div className="sf__stack-row"><span>Live group install + fix-it session</span><span className="v">$197</span></div>
          <div className="sf__stack-row"><span>Your targeting dialed in, live</span><span className="v">$147</span></div>
          <div className="sf__stack-row"><span>Your first offer reviewed before it goes out</span><span className="v">$147</span></div>
          <div className="sf__stack-total">
            <span className="was">Worth $491</span>
            <span className="now">This page only: ${KIT.oto2.price}</span>
          </div>
        </div>

        {canBuy ? (
          <>
            <a className="sf__cta" href={OTO2_PAYMENT_LINK}>
              YES! Launch Mine With You - ${KIT.oto2.price}
            </a>
            <p className="sf__cta-note">One-time payment · {KIT.oto2.seats} seats per session</p>
            <Link className="sf__decline" to={nextHref}>
              No thanks - I'll launch on my own with the walkthrough. Take me to my welcome page.
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
