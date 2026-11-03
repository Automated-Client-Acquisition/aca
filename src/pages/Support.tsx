import { useState } from "react";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { SUPPORT_EMAIL } from "@/config/site";
import "@/styles/aca-home.css";

const faqs = [
  {
    q: "How do I contact support?",
    a: `Email us at ${SUPPORT_EMAIL} and we'll get back to you as soon as possible.`,
  },
  {
    q: "How do I connect a LinkedIn, Instagram, WhatsApp, Email, Telegram, or SMS account?",
    a: "Go to Settings → Connected Accounts and follow the prompts to link your channel through Unipile. If a connection drops or shows an error, disconnecting and reconnecting the account usually resolves it.",
  },
  {
    q: "How do I cancel or change my subscription?",
    a: "You can manage your ACA Xtreme membership and billing details from Settings → Billing. Cancelling stops future charges; you'll keep access until the end of your current billing period.",
  },
  {
    q: "Why isn't my campaign sending messages?",
    a: "Check that the campaign is active, your connected account is healthy (not disconnected or rate-limited), and your leads meet any conditions in the sequence. If the issue persists, contact support with your campaign name and we'll investigate.",
  },
  {
    q: "How do I request a data export or account deletion?",
    a: `Email ${SUPPORT_EMAIL} with your account email and request. See our Privacy Policy for details on your data rights.`,
  },
];

export default function Support() {
  const [open, setOpen] = useState(0);

  return (
    <>
      <MarketingNav />
      <main className="aca-marketing">
        <section className="section section--tight" style={{ paddingTop: 80 }}>
          <div className="wrap">
            <header className="sect-head" style={{ margin: "0 auto 48px", alignItems: "center", textAlign: "center" }}>
              <span className="kicker">Support</span>
              <h1 className="h-hero">We're here to <em>help</em>.</h1>
              <p className="lead" style={{ margin: "0 auto" }}>
                Need a hand with Automated Client Acquisition? Reach out directly or check the answers below.
              </p>
            </header>

            <div
              className="aca-card"
              style={{
                maxWidth: 680,
                margin: "0 auto 72px",
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 20,
              }}
            >
              <div>
                <h2 className="h-card" style={{ fontSize: 20 }}>Contact us</h2>
                <p style={{ color: "var(--muted)", margin: "6px 0 0", fontSize: 15 }}>
                  Our team typically responds within one business day.
                </p>
              </div>
              <a className="btn btn--primary" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
            </div>

            <header className="sect-head">
              <span className="kicker">FAQ</span>
              <h2 className="h-section">Common questions.</h2>
            </header>
            <div className="faq__list">
              {faqs.map((f, i) => (
                <div
                  key={f.q}
                  className={"faq__item" + (open === i ? " faq__item--open" : "")}
                  onClick={() => setOpen(open === i ? -1 : i)}
                >
                  <div className="faq__q">{f.q}<span className="faq__q__icon">+</span></div>
                  <div className="faq__a">{f.a}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
