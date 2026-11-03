import { GuaranteeCertificate } from "./mocks";

export function GuaranteeSection() {
  return (
    <section id="guarantee" className="section--ink section--guarantee">
      <div className="wrap guarantee__wrap">
        <header className="guarantee__head">
          <span className="kicker kicker--inv">
            <i className="live-dot" /> The close
          </span>
          <h2 className="h-section h-section--inv">
            11 days.<br />
            <em>Or every dollar back<span className="dot">.</span></em>
          </h2>
          <p className="lead lead--inv">
            Sign up. Connect your AI, your senders, your ICP. If we don't put a qualified meeting on your calendar within 11 days, we refund every dollar. No survey, no friction, no "did you really set it up right?" Eleven days is the median time-to-first-meeting across active customers - we're putting our pricing on the line at the median, not the best case.
          </p>
        </header>

        <div className="guarantee__cert-wrap">
          <GuaranteeCertificate />
        </div>

        <div className="guarantee__cta">
          <a href="/get-started" className="btn btn--inverse btn--lg guarantee__cta-btn">
            Start For Free →
          </a>
          <p className="guarantee__cta-sub">
            <span><i className="check check--inv" /> Cancel anytime, no questions asked</span>
            <span><i className="check check--inv" /> Live in under 10 minutes</span>
            <span><i className="check check--inv" /> BYOK from minute one</span>
          </p>
        </div>
      </div>
    </section>
  );
}
