export function FinalCTA() {
  return (
    <section id="book" className="section--ink cta">
      <div className="wrap">
        <span className="kicker kicker--inv">
          <i className="live-dot" /> Ready when you are
        </span>
        <h2 className="h-section h-section--inv">
          Your AI is ready.
          <br />
          <em>The infrastructure isn't sold separately anywhere else<span className="dot">.</span></em>
        </h2>
        <p className="cta__sub">
          Plug in your model, your senders, and your ICP. We'll have a meeting on your calendar in 11 days, or you don't pay.
        </p>
        <div className="cta__btns">
          <a href="/get-started" className="btn btn--inverse btn--lg">Start For Free →</a>
          <a
            href="/support"
            className="btn btn--ghost btn--lg"
            style={{
              background: "transparent",
              borderColor: "rgba(255,255,255,0.3)",
              color: "#fff",
            }}
          >
            Book a 15-minute walkthrough
          </a>
        </div>
        <p className="cta__reassure">
          Cancel anytime, no questions asked. BYOK. Live in under 10 minutes. 11-day meeting guarantee on the Pro plan.
        </p>
      </div>
    </section>
  );
}
