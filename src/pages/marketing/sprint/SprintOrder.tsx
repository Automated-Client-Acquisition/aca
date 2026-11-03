import { useMemo, useState } from "react";
import { SPRINT, CHECKOUT_FN_URL } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";

type BumpKey = keyof typeof SPRINT.bumps;

// Order form: recap + 3 order bumps + email capture, then hands off to the
// create-sprint-checkout edge function (Stripe Checkout: $27 one-time + bumps
// + the $67/mo membership with a 30-day trial). Email is also captured as a
// playbook lead (source "sprint-checkout") BEFORE redirect, so an abandoned
// cart still enters the email system.
export default function SprintOrder() {
  const [email, setEmail] = useState("");
  const [bumps, setBumps] = useState<Record<BumpKey, boolean>>({
    recordings: false,
    shield: false,
    maps: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const total = useMemo(
    () =>
      SPRINT.price +
      (Object.keys(bumps) as BumpKey[]).reduce(
        (sum, k) => sum + (bumps[k] ? SPRINT.bumps[k].price : 0),
        0
      ),
    [bumps]
  );

  function toggle(k: BumpKey) {
    setBumps((b) => ({ ...b, [k]: !b[k] }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailValid || submitting) return;
    setSubmitting(true);
    setError(null);

    // Fire-and-forget lead capture so abandoners get follow-up emails.
    void fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-playbook-lead`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ email, source: "sprint-checkout" }),
    }).catch(() => {});

    try {
      const res = await fetch(CHECKOUT_FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          email,
          bumps: (Object.keys(bumps) as BumpKey[]).filter((k) => bumps[k]),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout is not available right now.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong - please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="sf">
      <div className="sf__bar">
        Almost there - Sprint starts <b>{SPRINT.startLabel}</b>
      </div>

      <main className="sf__letter sf__wrap">
        <header className="sf__head sf__head--light" style={{ paddingBottom: 0 }}>
          <h1 className="sf__h1" style={{ fontSize: "clamp(26px,5vw,36px)" }}>
            Save your seat in the 5-Day Build Sprint
          </h1>
          <p className="sf__sub">
            You're one step from a working AI setter on your own LinkedIn - built live with us,
            starting {SPRINT.startLabel}.
          </p>
        </header>

        <form className="sf__order-card" onSubmit={onSubmit}>
          <div className="sf__order-item">
            <span className="n">
              The First Client Machine Sprint - 5 live build days + your finished AI setter + the
              9-stage playbook + 30 days of ACA Xtreme (the platform + community)
            </span>
            <span className="p">${SPRINT.price}</span>
          </div>

          {/* ---------- BUMP 1: recordings ---------- */}
          <div className="sf__bump">
            <label>
              <input type="checkbox" checked={bumps.recordings} onChange={() => toggle("recordings")} />
              <span>
                <span className="t">
                  YES! Add <b>Lifetime Sprint Recordings</b> for just{" "}
                  <span className="pr">${SPRINT.bumps.recordings.price}</span>
                </span>
                <span className="d">
                  Every session recorded, yours forever. Miss a day, rewatch the tricky parts, or
                  rebuild the whole thing for a client later. Most builders add this - life happens.
                </span>
              </span>
            </label>
          </div>

          {/* ---------- BUMP 2: deliverability ---------- */}
          <div className="sf__bump">
            <label>
              <input type="checkbox" checked={bumps.shield} onChange={() => toggle("shield")} />
              <span>
                <span className="t">
                  YES! Add <b>The Deliverability Shield</b> for just{" "}
                  <span className="pr">${SPRINT.bumps.shield.price}</span>
                </span>
                <span className="d">
                  The done-for-you version of Day 3: domain setup checklists, the warm-up schedule,
                  and the exact safe daily limits - copy-paste configs instead of notes. Protects the
                  asset the whole machine depends on: your ability to land in the inbox.
                </span>
              </span>
            </label>
          </div>

          {/* ---------- BUMP 3: maps agent ---------- */}
          <div className="sf__bump">
            <label>
              <input type="checkbox" checked={bumps.maps} onChange={() => toggle("maps")} />
              <span>
                <span className="t">
                  YES! Add <b>The Maps Lead Machine</b> for just{" "}
                  <span className="pr">${SPRINT.bumps.maps.price}</span>
                </span>
                <span className="d">
                  A second finished agent: it pulls local businesses in any niche and city off Google
                  Maps, finds the owner's email, and verifies it - so your new setter never runs out
                  of fresh leads to work. Install guide included.
                </span>
              </span>
            </label>
          </div>

          <div className="sf__field">
            <label htmlFor="sprint-email">Your best email (login + calendar invites go here)</label>
            <input
              id="sprint-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="sf__order-total">
            <span className="lbl">Order total (one-time today)</span>
            <span className="amt">${total}</span>
          </div>

          <button className="sf__cta" type="submit" disabled={!emailValid || submitting}>
            {submitting ? "Opening secure checkout…" : `Complete My Order - $${total}`}
          </button>
          {error ? <p className="sf__error">{error}</p> : null}

          <div className="sf__trust">
            <span>🔒 Secure checkout (Stripe)</span>
            <span>Live-By-Friday guarantee</span>
            <span>Instant confirmation</span>
          </div>

          <div className="sf__disclose">
            <b>Billing, in plain English:</b> you pay <b>${total} once today</b>. Your ticket includes
            30 days of ACA Xtreme; after 30 days it renews at <b>${SPRINT.renewalPrice}/month</b>{" "}
            unless you cancel - one click, anytime, even day 29. You keep the agent and playbook
            either way.
          </div>
        </form>
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
