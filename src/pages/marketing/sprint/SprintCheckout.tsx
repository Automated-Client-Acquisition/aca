import { useMemo, useState } from "react";
import { CHECKOUT_FN_URL } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";

// Shared checkout page for the $27 front-end funnels (/kit/order and
// /studio/order render this with their own offer config). Direct-response
// order-form conventions: contact details FIRST, compact yes/no bumps with a
// visible ADDED state, then an in-form order review right above the pay
// button (mobile buyers never scroll past the aside, so the review must live
// in the form). Sticky order summary aside on desktop. Lead is captured via
// submit-playbook-lead BEFORE the Stripe redirect so abandoned carts enter
// the email system.

type Bump = { key: string; price: number; title: string; desc: string };

export type CheckoutConfig = {
  offer: "kit" | "studio";
  leadSource: string;
  productName: string;
  productSub: string;
  price: number;
  renewalPrice: number;
  includes: string[];
  bumps: Bump[];
  image: string;
  imageAlt: string;
  barNote: string; // e.g. "running today" / "writing today"
};

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
    <path d="M8.5 12l2.5 2.5 4.5-4.5" />
  </svg>
);
const BoltIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
  </svg>
);

// Card / wallet brand marks - uniform white card chips, real brand shapes and
// colors (drawn inline; no external assets, no font dependence).
const AppleGlyph = () => (
  <svg viewBox="0 0 384 512" width="11" height="14" aria-hidden="true">
    <path
      fill="#000"
      d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM255.5 96.3c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
    />
  </svg>
);
const GoogleGlyph = () => (
  <svg viewBox="0 0 48 48" width="13" height="13" aria-hidden="true">
    <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.9 6.6-9.6 6.6-16.2z" />
    <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.2H4.2v5.7C7.8 40.9 15.3 46 24 46z" />
    <path fill="#FBBC05" d="M11.6 28.1c-.5-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.2C2.8 17.1 2 20.4 2 24s.8 6.9 2.2 9.8l7.4-5.7z" />
    <path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.3 30 2 24 2 15.3 2 7.8 7.1 4.2 14.2l7.4 5.7c1.7-5.3 6.6-9.1 12.4-9.1z" />
  </svg>
);
const MastercardMark = () => (
  <svg viewBox="0 0 40 24" width="30" height="18" aria-hidden="true">
    <circle cx="15" cy="12" r="9.5" fill="#EB001B" />
    <circle cx="25" cy="12" r="9.5" fill="#F79E1B" />
    <path d="M20 4.6a9.5 9.5 0 0 1 0 14.8 9.5 9.5 0 0 1 0-14.8z" fill="#FF5F00" />
  </svg>
);
function PaymentLogos() {
  return (
    <div className="sf__paylogos" aria-label="Accepted payment methods">
      <span className="sf__paylogo" title="Visa">
        <b style={{ fontStyle: "italic", color: "#1A1F71", fontSize: 13, letterSpacing: "-0.02em" }}>VISA</b>
      </span>
      <span className="sf__paylogo" title="Mastercard"><MastercardMark /></span>
      <span className="sf__paylogo sf__paylogo--amex" title="American Express">
        <b>AMEX</b>
      </span>
      <span className="sf__paylogo" title="Apple Pay">
        <AppleGlyph />
        <b style={{ color: "#000", fontSize: 12.5, marginLeft: 3 }}>Pay</b>
      </span>
      <span className="sf__paylogo" title="Google Pay">
        <GoogleGlyph />
        <b style={{ color: "#5F6368", fontSize: 12.5, marginLeft: 3 }}>Pay</b>
      </span>
      <span className="sf__paylogo" title="Link by Stripe">
        <b style={{ color: "#00B377", fontSize: 13, letterSpacing: "-0.01em" }}>link</b>
      </span>
    </div>
  );
}

export default function SprintCheckout({ config }: { config: CheckoutConfig }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(config.bumps.map((b) => [b.key, false]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const selectedBumps = config.bumps.filter((b) => checked[b.key]);
  const total = useMemo(
    () => config.price + selectedBumps.reduce((sum, b) => sum + b.price, 0),
    [config.price, selectedBumps]
  );

  function toggle(key: string) {
    setChecked((c) => ({ ...c, [key]: !c[key] }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailValid || submitting) return;
    setSubmitting(true);
    setError(null);

    // Lead capture first (fire-and-forget) - abandoned carts get followed up.
    void fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-playbook-lead`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ email, fullName: fullName || undefined, source: config.leadSource }),
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
          offer: config.offer,
          bumps: selectedBumps.map((b) => b.key),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Checkout is not available right now - please try again in a minute.");
      }
      window.location.href = data.url;
    } catch (err) {
      if (err instanceof TypeError) {
        // fetch itself failed - network / offline / blocked
        setError("We couldn't reach the checkout server. Check your internet connection and try again - your selections are saved on this page.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong - please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="sf sf--checkout">
      <div className="sf__bar">
        Almost there - your agent can be <b>{config.barNote}</b>
      </div>

      <main className="sf__checkout">
        <div className="sf__steps-ind" aria-label="Checkout progress">
          <span className="st on"><i>1</i>Your order</span>
          <span className="sep" />
          <span className="st"><i>2</i>Secure payment</span>
          <span className="sep" />
          <span className="st"><i>3</i>Instant access</span>
        </div>

        <header className="sf__checkout-head">
          <h1 className="sf__h1">Claim {config.productName}</h1>
          <p className="sf__sub">
            You'll be installing within two minutes of checkout - 30-day keep-everything guarantee.
          </p>
        </header>

        <div className="sf__checkout-grid">
          {/* ======== LEFT: the order form ======== */}
          <form className="sf__order-card" onSubmit={onSubmit}>
            <div className="sf__co-product">
              <img src={config.image} alt={config.imageAlt} loading="lazy" />
              <div>
                <div className="nm">{config.productName}</div>
                <div className="ds">{config.productSub}</div>
              </div>
              <span className="pr">${config.price}</span>
            </div>

            <div className="sf__co-body">
              {/* ---- 1 · your details ---- */}
              <div className="sf__co-sec"><i>1</i>Your details</div>
              <div className="sf__co-fields">
                <div className="sf__field">
                  <label htmlFor="co-name">Your name</label>
                  <input
                    id="co-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="First and last name"
                    autoComplete="name"
                  />
                </div>
                <div className="sf__field">
                  <label htmlFor="co-email">Your best email</label>
                  <input
                    id="co-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                  />
                  <div className="hint">Your Kit + login are delivered here, instantly.</div>
                </div>
              </div>

              {/* ---- 2 · add-ons ---- */}
              <div className="sf__co-sec"><i>2</i>Boost your order&nbsp;<span className="opt">· optional, one-time</span></div>
              {config.bumps.map((b) => (
                <div className="sf__bump" key={b.key}>
                  <label>
                    <input type="checkbox" checked={checked[b.key]} onChange={() => toggle(b.key)} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="bump-head">
                        <span className="t">
                          {b.title} <span className="pr">+${b.price}</span>
                        </span>
                        <span className="add-tag">{checked[b.key] ? "✓ Added" : "+ Add"}</span>
                      </span>
                      <span className="d">{b.desc}</span>
                    </span>
                  </label>
                </div>
              ))}

              {/* ---- 3 · review & pay ---- */}
              <div className="sf__co-sec"><i>3</i>Review &amp; pay</div>
              <div className="sf__co-review">
                <div className="rw">
                  <span>{config.productName}</span>
                  <span className="v">${config.price}</span>
                </div>
                {selectedBumps.map((b) => (
                  <div className="rw" key={b.key}>
                    <span>{b.title}</span>
                    <span className="v">${b.price}</span>
                  </div>
                ))}
                <div className="rw">
                  <span className="mut">30 days of ACA Xtreme, then ${config.renewalPrice}/mo · cancel anytime</span>
                  <span className="v inc">included</span>
                </div>
                <div className="rw tot">
                  <span>Due today</span>
                  <span className="v">${total}</span>
                </div>
              </div>

              <button className="sf__cta" type="submit" disabled={!emailValid || submitting}>
                {submitting ? "Opening secure checkout…" : `Complete My Order - $${total} →`}
              </button>
              <p className="sf__co-ctanote">
                <b>✓</b> 30-day keep-everything guarantee · one-time payment · instant access
              </p>

              {error ? (
                <div className="sf__error-box" role="alert">
                  <b>Payment didn't start:</b> {error}
                </div>
              ) : null}

              <div className="sf__badges" aria-label="Security and guarantee badges">
                <span className="sf__badge"><LockIcon />256-bit SSL</span>
                <span className="sf__badge"><ShieldIcon />Stripe checkout</span>
                <span className="sf__badge"><ShieldIcon />30-day guarantee</span>
                <span className="sf__badge"><BoltIcon />Instant access</span>
              </div>
              <PaymentLogos />
              <p className="sf__proofline">
                Payment handled by <b>Stripe</b> - we never see or store your card details.
              </p>

              <div className="sf__biltimeline" aria-label="What you pay, when">
                <h4>What you pay, when</h4>
                <div className="track">
                  <div className="node now">
                    <i />
                    <div className="when">Today</div>
                    <div className="amt">${total}</div>
                    <div className="det">one-time · instant access</div>
                  </div>
                  <div className="node inc">
                    <i />
                    <div className="when">Days 1-30</div>
                    <div className="amt">$0</div>
                    <div className="det">ACA Xtreme included</div>
                  </div>
                  <div className="node">
                    <i />
                    <div className="when">Day 30+</div>
                    <div className="amt">${config.renewalPrice}/mo</div>
                    <div className="det">cancel anytime in one click - keep everything</div>
                  </div>
                </div>
              </div>

              <div className="sf__disclose">
                <b>Billing, in plain English:</b> you pay <b>${total} once today</b>. Your Kit includes
                30 days of ACA Xtreme; after 30 days it renews at <b>${config.renewalPrice}/month</b>{" "}
                unless you cancel - one click, anytime, even day 29. You keep the agent and playbook
                either way.
              </div>
            </div>
          </form>

          {/* ======== RIGHT: what you're getting ======== */}
          <aside className="sf__summary" aria-label="What's included">
            <div className="sf__summary-media">
              <img className="sf__summary-img" src={config.image} alt={config.imageAlt} loading="lazy" />
            </div>
            <div className="sf__summary-body">
              <div className="sf__summary-name">Everything in your order</div>
              <div className="sf__summary-sub">{config.productSub}</div>

              <ul className="sf__summary-list">
                {config.includes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              <div className="sf__seal">
                <span className="sf__seal-ring"><b>30</b>DAY</span>
                <p>
                  <b>Keep-everything guarantee.</b> Full refund any time in 30 days - and you keep the
                  agent, the playbook, and the bonuses.
                </p>
              </div>

              <div className="sf__next">
                <h4>What happens after payment</h4>
                <div className="sf__next-step"><i>1</i>Instant email with your Kit, walkthrough, and login</div>
                <div className="sf__next-step"><i>2</i>30-minute copy-paste install - agent live today</div>
                <div className="sf__next-step"><i>3</i>Your 30 days of ACA Xtreme start immediately</div>
              </div>

              <div className="sf__summary-proof">
                These agents run every day inside a community of <b>127+ founders &amp; agencies</b>.
                You're not beta-testing - you're installing.
              </div>
            </div>
          </aside>
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
