import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { findProfession } from "@/components/marketing/how-we-work/professions";
import { supabase } from "@/integrations/supabase/client";
import { useSEO } from "@/hooks/useSEO";
import "@/styles/aca-home.css";
import "@/styles/how-we-work.css";
import "@/styles/marketing-continuity.css";

/* ─────────────────────────────────────────────────────────────
   /quote — the quote questionnaire.

   Five questions, then straight to /book. Deliberately separate
   from /get-started, which is self-serve product onboarding and a
   different journey entirely.

   Submission reuses the existing submit-playbook-lead function so
   nothing new has to be deployed. Name / email / company URL map
   onto real columns; the four quote numbers go into `outcome` as
   one readable line, because playbook_leads has no columns for
   them and adding some would mean a migration plus a function
   redeploy. See the note in the handover if you want them typed.
   ───────────────────────────────────────────────────────────── */

const MEETINGS = ["100", "200", "300", "400"];
const BUDGETS = ["$5k", "$10k", "$25k", "$50k+"];

export default function Quote() {
  const { profession: slug } = useParams<{ profession?: string }>();
  const p = findProfession(slug);
  const navigate = useNavigate();

  const [meetings, setMeetings] = useState("");
  const [budget, setBudget] = useState("");
  const [clv, setClv] = useState("20000");
  const [closeRate, setCloseRate] = useState("20");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = !!meetings && !!budget && !!name.trim() && emailOk && !!website.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("submit-playbook-lead", {
        body: {
          fullName: name.trim(),
          email: email.trim(),
          website: website.trim(),
          playbookSlug: "quote-request",
          niche: p.label,
          /* Structured for the emails, which lay these out as a table. The
             readable line below is what lands in playbook_leads.outcome,
             since the table has no columns for them. */
          quote: { meetings, budget, clv, closeRate },
          outcome:
            `${meetings} meetings wanted over 6 months · budget ${budget}/mo · ` +
            `customer worth $${Number(clv || 0).toLocaleString()} · close rate ${closeRate}%`,
          source: p.slug ? `quote-${p.slug}` : "quote",
        },
      });
      if (fnError) throw fnError;
      /* The function answers 200 with an { error } body on a failed insert,
         so a transport-only check would send people to the calendar with
         their answers dropped on the floor. */
      const payload = data as { error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      navigate("/book");
    } catch {
      setSending(false);
      setError("That didn't send. Try again, or book a time directly.");
    }
  }

  const seo = useSEO({
    title: slug ? `Get a quote: ${p.label}` : "Get a quote",
    // Profession variants of the questionnaire are the same form: keep /quote as the indexed page.
    noindex: !!slug,
    description:
      "Five questions and we'll put a number on it: how many meetings you want, what you're willing to spend, and what a customer is worth to you.",
    canonical: "/quote",
  });

  return (
    <>
      {seo}
      <MarketingNav />
      <main className="aca-marketing mkt-page mkt-quote">
        <section className="hw-hero" style={{ paddingBottom: 24 }}>
          <div className="wrap">
            <div className="hw-hero__top">
              <span className="kicker">Get a quote</span>
              <h1 className="hw-hero__h">
                Five questions, then <em>a number<span className="dot">.</span></em>
              </h1>
              <p className="hw-hero__sub">
                Enough for us to size the build and tell you what it costs. Takes
                about a minute, then you pick a time to go through it.
              </p>
            </div>

            <form className="qz" onSubmit={submit}>
              <div className="qz__q" role="radiogroup" aria-labelledby="q1">
                <p className="qz__legend" id="q1">
                  <span className="qz__n">01</span> How many meetings do you want over
                  the next 6 months?
                </p>
                <div className="qz__opts">
                  {MEETINGS.map((m) => (
                    <label key={m} className={"qz__opt" + (meetings === m ? " qz__opt--on" : "")}>
                      <input
                        type="radio"
                        name="meetings"
                        value={m}
                        checked={meetings === m}
                        onChange={() => setMeetings(m)}
                      />
                      {m}
                    </label>
                  ))}
                </div>
              </div>

              <div className="qz__q" role="radiogroup" aria-labelledby="q2">
                <p className="qz__legend" id="q2">
                  <span className="qz__n">02</span> What is your monthly budget?
                </p>
                <div className="qz__opts">
                  {BUDGETS.map((b) => (
                    <label key={b} className={"qz__opt" + (budget === b ? " qz__opt--on" : "")}>
                      <input
                        type="radio"
                        name="budget"
                        value={b}
                        checked={budget === b}
                        onChange={() => setBudget(b)}
                      />
                      {b}
                    </label>
                  ))}
                </div>
              </div>

              <div className="qz__q">
                <p className="qz__legend">
                  <span className="qz__n">03</span> What is a customer worth to you?
                </p>
                <div className="qz__money">
                  <span>$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={Number(clv || 0).toLocaleString()}
                    onChange={(e) => setClv(e.target.value.replace(/[^0-9]/g, ""))}
                    aria-label="Customer lifetime value"
                  />
                </div>
              </div>

              <div className="qz__q">
                <p className="qz__legend">
                  <span className="qz__n">04</span> What is your average close rate?
                </p>
                <div className="qz__rate">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={closeRate}
                    onChange={(e) => setCloseRate(e.target.value)}
                    aria-label="Average close rate"
                  />
                  <span className="qz__pct">{closeRate}%</span>
                </div>
              </div>

              <div className="qz__q">
                <p className="qz__legend">
                  <span className="qz__n">05</span> Where should we send it?
                </p>
                <div className="qz__fields">
                  <input
                    type="text"
                    placeholder="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                  <input
                    type="email"
                    placeholder="Work email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                  <input
                    type="text"
                    placeholder="Company URL"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    autoComplete="url"
                  />
                </div>
              </div>

              {error && <p className="qz__err">{error}</p>}

              <div className="qz__submit">
                <button type="submit" className="btn btn--primary btn--lg" disabled={!ready || sending}>
                  {sending ? "Sending…" : <>Next, pick a time <span className="arrow">→</span></>}
                </button>
                <span className="qz__note">No call required to get the number.</span>
              </div>
            </form>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
