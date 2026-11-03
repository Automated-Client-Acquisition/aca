import { useEffect, useState } from "react";
import { useSignalsSubscribe } from "@/hooks/useSignalsSubscribe";

const DISMISS_KEY = "aca:signals-sticky-dismissed";

// Persistent daily-signals opt-in bar. Slides in once the hero capture
// (#signals-hero-email) scrolls out of view, so the opt-in is always one field
// away through the long feed. Dismissible (remembered for the session) and
// hidden again whenever the user scrolls back up to the hero form.
export function SignalsStickyCapture() {
  const { email, setEmail, status, error, valid, submit } = useSignalsSubscribe();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const hero = document.getElementById("signals-hero-email");
    if (!hero) {
      // Fallback if the hero input isn't on the page: show past a scroll depth.
      const onScroll = () => setVisible(window.scrollY > 640);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => window.removeEventListener("scroll", onScroll);
    }
    const io = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: "-72px 0px 0px 0px" },
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  const shown = visible || status === "submitting";

  return (
    <div
      className={`signals-sticky ${shown ? "is-visible" : ""}`}
      role="region"
      aria-label="Subscribe to daily buying signals"
      aria-hidden={!shown}
    >
      <div className="signals-sticky__inner">
        {status === "done" ? (
          <p className="signals-sticky__done">
            <span className="signals-sticky__check" aria-hidden="true">✓</span>
            You're in - your first signals land tomorrow morning.
          </p>
        ) : (
          <>
            <span className="signals-sticky__label">
              <span className="live-dot" aria-hidden="true" />
              Get tomorrow's buying signals
            </span>
            <form
              className="signals-sticky__form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                aria-label="Work email address"
                autoComplete="email"
                disabled={status === "submitting"}
                tabIndex={shown ? 0 : -1}
              />
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!valid || status === "submitting"}
                tabIndex={shown ? 0 : -1}
              >
                {status === "submitting" ? "Adding…" : "Get them free"}
              </button>
            </form>
            {error ? <span className="signals-sticky__error">{error}</span> : null}
          </>
        )}
        <button
          type="button"
          className="signals-sticky__close"
          aria-label="Dismiss"
          onClick={dismiss}
          tabIndex={shown ? 0 : -1}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
