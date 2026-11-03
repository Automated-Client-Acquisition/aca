import { HeroVideo } from "./mocks";

export function Hero() {
  return (
    <section id="top" className="hero">
      <div className="wrap">
        <div className="hero__top">
          <span className="kicker">
            <i className="live-dot" /> Outbound + inbound + content + replies, all in one system
          </span>
          <h1 className="h-hero">
            Your entire <em>outbound, inbound, and content engine</em>
            <br />
            built for you in <em>minutes</em><span className="dot">.</span>
          </h1>

          <HeroVideo />

          <div className="hero__ctas">
            <a href="/get-started" className="btn btn--primary btn--lg">
              Build my system free <span className="arrow">→</span>
            </a>
            <a href="/sandbox" className="btn btn--ghost btn--lg">
              ▶ See it run on my website (30s, no signup)
            </a>
          </div>
          <p className="hero__finepoint">
            <em>Three days free. No card. Cancel any time.</em>
          </p>
          <div className="hero__assure">
            <span><i className="check" /> First qualified meeting in 11 days, or you don't pay</span>
            <span><i className="check" /> Cancel anytime, no questions asked</span>
            <span><i className="check" /> Live in under 10 minutes</span>
          </div>
        </div>
      </div>
    </section>
  );
}
