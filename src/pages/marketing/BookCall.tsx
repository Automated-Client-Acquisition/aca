import { useEffect } from "react";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { useSEO } from "@/hooks/useSEO";
import "@/styles/aca-home.css";
import "@/styles/how-we-work.css";
import "@/styles/marketing-continuity.css";

/* ─────────────────────────────────────────────────────────────
   /book — the step after the quote questionnaire.

   The calendar is a LeadConnector (GHL) widget. Its embed script
   sizes the iframe by postMessage, so the iframe carries no height
   of its own: the CSS gives it a min-height that covers the widget
   before the script lands, and the script takes over after.

   Keep the iframe id exactly as GHL issued it — form_embed.js
   matches on it when it posts the resize message back.
   ───────────────────────────────────────────────────────────── */

const BOOKING_ID = "ohaSz8OGLdAdWrBWVcqm";
const IFRAME_ID = `${BOOKING_ID}_1785948235060`;
const EMBED_SCRIPT = "https://link.msgsndr.com/js/form_embed.js";

export default function BookCall() {
  const seo = useSEO({
    title: "Book your call",
    description:
      "Pick a time. We walk through your market, what the agents would watch for, and what the first ninety days would actually look like.",
    canonical: "/book",
  });

  /* The widget script is global and idempotent-ish, but mounting it twice
     leaves two listeners resizing the same frame, so it is added once per
     mount and removed on the way out. */
  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${EMBED_SCRIPT}"]`
    );
    if (existing) return;
    const s = document.createElement("script");
    s.src = EMBED_SCRIPT;
    s.type = "text/javascript";
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
    };
  }, []);

  return (
    <>
      {seo}
      <MarketingNav />
      <main className="aca-marketing mkt-page mkt-book">
        <section className="hw-hero" style={{ paddingBottom: 24 }}>
          <div className="wrap">
            <div className="hw-hero__top">
              <span className="kicker">Last step</span>
              <h1 className="hw-hero__h">
                Pick a time that <em>suits you<span className="dot">.</span></em>
              </h1>
              <p className="hw-hero__sub">
                Thirty minutes. We go through your market, what the agents would
                watch for in it, and what the first ninety days would actually look
                like. If it isn't a fit we'll say so on the call.
              </p>
            </div>

            <div className="hw-cal">
              <iframe
                src={`https://api.leadconnectorhq.com/widget/booking/${BOOKING_ID}`}
                id={IFRAME_ID}
                title="Book a call"
                allow="payment"
                scrolling="no"
              />
            </div>

            <p className="hw-cal__note">
              Trouble with the calendar?{" "}
              <a
                href={`https://api.leadconnectorhq.com/widget/booking/${BOOKING_ID}`}
                target="_blank"
                rel="noreferrer"
              >
                Open it in a new tab
              </a>
              .
            </p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
