import { useSignalsSubscribe } from "@/hooks/useSignalsSubscribe";

const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

interface Props {
  /** "hero" = compact inline form for the above-the-fold primary CTA;
   *  "band" = full standalone card used lower on the page. */
  variant?: "hero" | "band";
  /** DOM id for the email input - lets a sticky mobile CTA focus it. */
  inputId?: string;
  /** Live count of companies found today, shown as proof in the trust line. */
  liveCount?: number;
}

// Daily-signals lead capture. Reuses the existing submit-playbook-lead edge
// function (source="signals-daily" → own subscriber list + welcome email).
export function SignalsDailyCapture({ variant = "band", inputId, liveCount = 0 }: Props) {
  const { email, setEmail, status, error, valid, submit } = useSignalsSubscribe();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submit();
  }

  const trustLine =
    liveCount > 0
      ? `Free · ${liveCount.toLocaleString()} new companies today · unsubscribe in one click`
      : "Free · one email each morning · unsubscribe in one click";

  const form = (
    <>
      <form className="signals-capture__form" onSubmit={handleSubmit}>
        <input
          id={inputId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          aria-label="Work email address"
          autoComplete="email"
          disabled={status === "submitting"}
        />
        <button type="submit" className="btn btn--primary btn--lg" disabled={!valid || status === "submitting"}>
          {status === "submitting" ? "Adding you…" : "Get tomorrow's signals free"}
        </button>
      </form>
      {error ? <p className="signals-capture__error">{error}</p> : null}
    </>
  );

  // ---- Hero variant: lives inside the hero as the primary CTA ----
  if (variant === "hero") {
    if (status === "done") {
      return (
        <div className="signals-capture-hero signals-capture-hero--done">
          <span className="signals-capture__check" aria-hidden="true">✓</span>
          <p>
            <strong>You're in.</strong> First batch lands tomorrow morning - check your inbox for the welcome email.
          </p>
        </div>
      );
    }
    return (
      <div className="signals-capture-hero">
        {form}
        <p className="signals-capture-hero__trust">
          <span className="live-dot" />
          {trustLine}
        </p>
      </div>
    );
  }

  // ---- Band variant: standalone reinforcement lower on the page ----
  return (
    <section className="section--tight signals-capture-section">
      <div className="wrap">
        <div className="signals-capture">
          {status === "done" ? (
            <div className="signals-capture__done">
              <span className="signals-capture__check" aria-hidden="true">✓</span>
              <h2 className="signals-capture__title">You're in<span className="dot">.</span></h2>
              <p className="signals-capture__sub">
                We just sent a welcome email - your first batch of signals lands tomorrow morning.
              </p>
              <p className="signals-capture__nudge">
                Want signals scoped to <em>your</em> exact offer?{" "}
                <a href={SKOOL_URL} target="_blank" rel="noopener noreferrer">Build one with Hermes →</a>
              </p>
            </div>
          ) : (
            <>
              <span className="signals-capture__kicker">
                <span className="live-dot" />Don't want to check back every day?
              </span>
              <h2 className="signals-capture__title">
                Get tomorrow's signals before <em>your competitors<span className="dot">.</span></em>
              </h2>
              <p className="signals-capture__sub">
                A trigger is only worth money while it's fresh. We email you the day's funding, hiring, and
                leadership moves at 8am - so you reach out first, not after the window closes.
              </p>
              {form}
              <div className="signals-capture__trust">
                <span>One email each morning</span>
                <span>No credit card</span>
                <span>Unsubscribe in one click</span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
