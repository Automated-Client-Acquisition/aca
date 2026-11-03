import { useState } from "react";
import { useParams } from "react-router-dom";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { LoopBoard } from "@/components/marketing/how-we-work/LoopBoard";
import { findProfession, PROFESSIONS } from "@/components/marketing/how-we-work/professions";
import { useSEO } from "@/hooks/useSEO";
import "@/styles/aca-home.css";
import "@/styles/how-we-work.css";
import "@/styles/marketing-continuity.css";

/* ─────────────────────────────────────────────────────────────
   /how-we-work, the playbook page.

   Written for a B2B owner who wants meetings, has heard "AI agent"
   a hundred times, and wants to see the actual work. It is the
   companion to the YouTube walkthrough, so the register is plain
   and spoken: short sentences, contractions, active voice, and the
   count framed as reassurance rather than as a workload the reader
   takes on.

   The spine is PLAYBOOK: 18 steps in the order they happen. The
   board above it carries the same step numbers, so a viewer can
   follow the video against either one. Anything that only restates
   a step has been removed on purpose, repeatedly.
   ───────────────────────────────────────────────────────────── */

type StageKey =
  | "find"
  | "qualify"
  | "enrich"
  | "reach"
  | "amplify"
  | "convert"
  | "compound";

/* ── Why an agent at all ──────────────────────────────────────
   The educational beat. Not "we have eight agents", but what an
   agent is actually good at, what it is deliberately not allowed
   near, and why that split is the design rather than a limitation. */
const AGENT_DOES = [
  "Watch every source, all day, and catch the trigger the hour it appears",
  "Read a company and score the fit, with the reasoning written down",
  "Find the right person and a route that actually resolves",
  "Check exclusions and suppression before every single send",
  "Draft the first line from the signal that surfaced them",
  "Pick the mailbox, pace the send, watch inbox placement",
  "Sort replies by intent and stop every sequence the moment one lands",
];

const HUMAN_DOES = [
  "The conversation. All of it, assisted by AI",
  "Deciding whether a lukewarm reply is worth pushing on",
  "Setting the offer, the positioning and the price",
  "The meeting, the proposal, the negotiation",
  "Judging whether an odd-shaped company is worth an exception",
  "Anything where being wrong is expensive",
];

const CREW = [
  {
    name: "Scout",
    color: "var(--hw-find)",
    role: "Finds the signal",
    does: "Watches every source continuously and picks up the moment a company shows it has the problem. Merges duplicates into one record with every reason attached.",
    tools: "source watchers · scrapers · dedupe",
    model: "Fast model + rules",
  },
  {
    name: "Analyst",
    color: "var(--hw-qualify)",
    role: "Decides if they fit",
    does: "Reads the company like a good salesperson would: the site, the positioning, who they sell to. Scores it against your ICP and writes down why.",
    tools: "company read · ICP scoring",
    model: "Frontier model",
  },
  {
    name: "Warden",
    color: "var(--hw-qualify)",
    role: "Says no",
    does: "Exclusions, suppression, existing customers, anyone who asked not to be contacted, anyone who bounced. Runs on rules. No model gets a vote.",
    tools: "suppression · exclusions · DNC",
    model: "Rules only",
  },
  {
    name: "Resolver",
    color: "var(--hw-enrich)",
    role: "Finds the route",
    does: "Runs the providers one by one, verifies the result itself, and goes looking again when something comes back invalid instead of sending anyway.",
    tools: "providers · verifier · re-search",
    model: "Rules + fast model",
  },
  {
    name: "Scribe",
    color: "var(--hw-reach)",
    role: "Writes the opener",
    does: "Builds the first line from the signal that surfaced this company, in your voice. Then checks its own work for broken variables before anything ships.",
    tools: "copy draft · variable check",
    model: "Frontier model",
  },
  {
    name: "Dispatch",
    color: "var(--hw-reach)",
    role: "Gets it delivered",
    does: "Picks the mailbox, respects the daily cap, paces it like a person, rotates domains, and pulls one out the moment placement drops.",
    tools: "mailbox rotation · pacing · placement",
    model: "Rules only",
  },
  {
    name: "Listener",
    color: "var(--hw-convert)",
    role: "Reads the reply",
    does: "Reads every reply and sorts it: interested, out of office, wrong person, bounce, not now. Stops every sequence that lead is in, then wakes a human with the full thread.",
    tools: "intent classify · sequence stop · notify",
    model: "Frontier model",
  },
  {
    name: "Curator",
    color: "var(--hw-compound)",
    role: "Closes the loop",
    does: "After a deal signs, works out what the buyers had in common, rewrites the ICP filters, and seeds the lookalikes for the next round.",
    tools: "trait analysis · audience seed",
    model: "Frontier model",
  },
];

/* ── The playbook ─────────────────────────────────────────────
   The page IS this list. Eighteen steps in the order they happen,
   phrased as work done rather than benefits claimed.

   NB on the source list: it numbered two steps "4", so it is 18
   items, not 17. Two of them are not sequential and are marked as
   such — the sending estate has to warm in parallel or you finish
   the list and then wait a month, and the ad audience fills
   continuously from the moment enrichment starts. */
type Step = { n: string; h: string; b: string; note?: string };
type Phase = { key: string; label: string; color: string; steps: Step[] };

const PLAYBOOK: Phase[] = [
  {
    key: "build",
    label: "Build",
    color: "var(--hw-find)",
    steps: [
      {
        n: "01",
        h: "Build the agent",
        b: "We spin up a server that belongs to you, lock it down, and install the whole toolkit on it. Then we plug it into Telegram so you can just text it. Hermes runs it. So can Claude, or whatever agent you already use. Underneath, ACA holds every lead, sequence, mailbox and conversation.",
      },
      {
        n: "02",
        h: "Point it at the sources and build the list",
        b: "No bought database. We point it at the places where companies show they've got the problem: job posts, funding news, maps, review sites, communities, your competitors' followers. Then we leave it running, so the list keeps growing.",
      },
      {
        n: "03",
        h: "Filter the leads",
        b: "Five gates, cheapest first: hard rules, then how fresh the signal is, then an ICP score, then exclusions, then suppression. Every rejection gets a reason written next to it.",
      },
      {
        n: "04",
        h: "Enrich and verify",
        b: "We find the actual decision maker and a way to reach them that works. Several providers in a row, then we verify it ourselves. If it comes back invalid, we go looking again instead of sending anyway.",
      },
      {
        n: "05",
        h: "Build the outbound engine",
        b: "Separate sending domains, set up properly, and every mailbox warmed before it sends a single campaign email.",
        note: "This one isn't sequential. Warmup takes weeks, so it starts on day one. Otherwise you finish the list and then sit there for a month.",
      },
      {
        n: "06",
        h: "Build ten sequences and the LinkedIn campaigns",
        b: "Ten sequences. Several offers, several openings, all written to be compared. You don't pick the winner here. The market picks it, usually inside a few weeks.",
      },
    ],
  },
  {
    key: "launch",
    label: "Launch",
    color: "var(--hw-reach)",
    steps: [
      {
        n: "07",
        h: "Route the leads into them",
        b: "We load the verified list in and split it so the offers get tested against comparable segments. Suppression gets re-checked at send, not at build.",
      },
      {
        n: "08",
        h: "Build the inbound engine",
        b: "Lead magnets on LinkedIn, deliberately narrow, so the wrong person doesn't bother asking for one.",
      },
      {
        n: "09",
        h: "Automate delivery, filtering and the first line",
        b: "It captures the request, delivers instantly, scores them against the same gates the outbound list gets, and opens with a real question instead of a thank-you page.",
      },
      {
        n: "10",
        h: "Hash everyone enriched into ad audiences",
        b: "Every contact we enrich gets turned into a fingerprint before it leaves your server. Meta and Google can match it. Neither of them ever sees your list.",
        note: "Also not sequential. This one fills up every time step 04 finds someone.",
      },
      {
        n: "11",
        h: "Launch the campaigns and the page they land on",
        b: "LinkedIn, Meta and Google, all pointed at one page. Not a brochure: a calculator that runs their numbers, with the booking form right there on the same screen.",
      },
    ],
  },
  {
    key: "convert",
    label: "Convert",
    color: "var(--hw-convert)",
    steps: [
      {
        n: "12",
        h: "Monitor replies manually",
        b: "A person reads every reply, from both lanes. The second someone replies, every sequence they're in stops. Everywhere. The agent has already pulled the thread, the signal and the score together, so nobody starts cold, and it drafts a reply for the person to change or bin.",
      },
      { n: "13", h: "Book the meeting", b: "On the calendar, with a brief attached: what the signal was, what they scored, and the whole thread." },
      {
        n: "14",
        h: "Pass the booking back to the agent and the ad platforms",
        b: "A booking is a conversion. It goes back to the agent so it learns who books, and to Meta and Google so they stop optimising for clicks and start optimising for meetings.",
        note: "Happens the same second as 15. Both fire off the booking.",
      },
      {
        n: "15",
        h: "Send the pre-appointment sequence",
        b: "Testimonials and case studies that match their situation, plus the confirmation and the no-show nudges. The gap between booking and the call is where most meetings quietly die.",
      },
      { n: "16", h: "Send the summary and the proposal", b: "Same day, while it's still warm. A recap in their words, and a scope built from what they actually said." },
      { n: "17", h: "Run the post-appointment follow-up", b: "Paced, not nagging, with material aimed at whatever they pushed back on. It runs until you get a yes or a clean no." },
    ],
  },
  {
    key: "compound",
    label: "Compound",
    color: "var(--hw-compound)",
    steps: [
      {
        n: "18",
        h: "Signed, and the loop tightens",
        b: "The win goes back to Meta and Google as a lookalike seed, and back to the agent so it rewrites the ICP from who actually bought. Offers that lost get retired. Round three beats round one because it's built on results instead of guesses.",
        note: "Different event from 14. Booked teaches it who books. Signed teaches it who buys.",
      },
    ],
  },
];

/* ── The takeaway ─────────────────────────────────────────────
   The whole board reduces to these. Written so a viewer can act on
   them tomorrow without buying anything, which is the point: this
   page is the companion to the video, not a brochure. */
const RULES: { r: string; why: string }[] = [
  { r: "Never send cold volume from your primary domain.",
    why: "It's the address your contracts come from. Buy separate ones that read like you, and keep the real one out of the blast radius." },
  { r: "A new mailbox sends nothing for weeks.",
    why: "Warm it, then ramp. A mailbox that jumps straight to volume lands in spam and tends to stay there." },
  { r: "Many mailboxes at small daily caps, never one at a big one.",
    why: "One mailbox sending a thousand messages is the clearest spammer signal there is." },
  { r: "If you can't name the trigger in the first line, don't send it.",
    why: "\"You might need this\" and \"you were dealing with this last Tuesday\" are not the same email." },
  { r: "A signal older than a quarter is trivia, not a trigger.",
    why: "Freshness is a filter, not a nice-to-have. Old signals read as research, not relevance." },
  { r: "Rules for facts, models only for judgement.",
    why: "No model should get a vote on whether a company has eleven employees. Save the expensive thinking for whether they actually fit." },
  { r: "Log the reason for every rejection.",
    why: "A funnel you can't audit is a funnel you can't fix. You want to know why 9,000 rows got dropped." },
  { r: "Verify every address, and re-search the invalid ones.",
    why: "A pattern-guessed address bounces, and bounces are charged to the domain, not to the row." },
  { r: "Check suppression before every send, not once at list build.",
    why: "People become customers, complain, or bounce between the build and the send. Most leaks happen in that gap." },
  { r: "Measure inbox placement, not open rates.",
    why: "You can post a healthy open rate and still be in the spam folder for the segment that actually matters." },
  { r: "A reply stops every sequence that person is in, immediately.",
    why: "Nothing kills a warm conversation faster than an automated follow-up two days after they said yes." },
  { r: "No reply is not a no. Retarget instead.",
    why: "Most people never reply to a first email. Put them in a hashed ad audience and let recognition do the work the inbox couldn't." },
  { r: "Let whoever signs rewrite the ICP.",
    why: "Build the next list from the traits of people who actually bought, not from the profile you guessed at the start." },
];

const FAQS = [
  {
    q: "Is this just an AI that sends emails?",
    a: "No. The sending is the smallest part. Most of the work is upstream, finding companies showing they have the problem right now, throwing away the ones that don't fit, finding a contact route that actually resolves, and building sending infrastructure that gets messages delivered. And it stops entirely at the reply: a person handles every real conversation.",
  },
  {
    q: "Where does Hermes actually run?",
    a: "On a VPS provisioned for you, not inside a shared app you rent by the seat. We secure it first (key-based access, firewalled, isolated, backed up), then install its skills, dependencies and agents, then connect it to Telegram so you can talk to it from your phone. It stays on permanently, which is the point: the source watchers keep running overnight and at weekends, which is when a lot of the signals actually appear. Your keys and your prospect data stay on your machine.",
  },
  {
    q: "Why build secondary domains instead of just using ours?",
    a: "Because cold volume from your primary domain puts the one address you can't afford to lose at risk: the one your invoices, contracts and client threads come from. Secondary domains are registered, authenticated and warmed to look and read like you, and they carry all the cold volume. If one gets damaged, it is replaced. Your real domain is never in the blast radius.",
  },
  {
    q: "What actually happens to our contact data before it goes to ad platforms?",
    a: "It gets turned into a fingerprint before it leaves. The platform can match that against its own users, not a readable list of your prospects. Customers and existing opportunities are excluded from acquisition audiences and used only as lookalike seeds.",
  },
  {
    q: "How long before meetings start appearing?",
    a: "The list build and qualification is the fast part. The constraint is infrastructure: mailboxes have to warm before they can carry volume, and rushing that is how campaigns land in spam permanently. Expect the first weeks to be building and testing, with volume ramping as reputation earns it. Anyone promising meetings in week one is skipping the warmup.",
  },
  {
    q: "Which AI model do you use?",
    a: "Several, deliberately. Deterministic rules handle facts like headcount and geography, no model gets a vote on those. Fast, cheap models do high-volume sorting. The strongest models are reserved for genuine judgement calls, like reading a company and deciding whether it truly fits. The system is model-agnostic and runs on your own keys, so it improves as the models do without you being locked to one vendor.",
  },
  {
    q: "What if our ICP is wrong?",
    a: "It usually is, at first, everyone's is. That is what the loop is for. The traits shared by people who actually signed become filters for the next build, and the traits shared by people who ghosted get filtered out. Round three targets meaningfully better than round one because it was built from outcomes rather than assumptions.",
  },
];

export default function HowWeWork() {
  const { profession: slug } = useParams<{ profession?: string }>();
  const p = findProfession(slug);

  /* The stage only tints the board now, there is no stage panel to
     scroll to: the detail lives in each box's card and in the steps. */
  const [stage, setStage] = useState<StageKey>("find");
  const [openFaq, setOpenFaq] = useState(-1);

  const seo = useSEO({
    title: `How ${p.headline} book ${p.volume} with AI agents, no tech skills`,
    description:
      `The full playbook for ${p.label.toLowerCase()}: AI agent infrastructure installed on your own server, eight agents that build your list from live buying signals, filter it against your ICP, enrich and verify it, run email, LinkedIn and paid audiences together, and hand every real reply to a human. No technical skills needed.`,
    canonical: p.slug ? `/how-we-work/${p.slug}` : "/how-we-work",
    keywords: [
      `AI appointment setting for ${p.label.toLowerCase()}`,
      `lead generation for ${p.label.toLowerCase()}`,
      "Hermes AI agent",
      "AI SDR",
      "cold email infrastructure",
      "ICP filtering",
      "book more B2B meetings",
    ],
  });

  return (
    <>
      {seo}
      <MarketingNav />
      <main className="aca-marketing mkt-page mkt-methodology">
        {/* ── Hero ──────────────────────────────────────────── */}
        <section className="hw-hero">
          <div className="wrap">
            <div className="hw-hero__top">
              <span className="kicker">AI agent infrastructure · {p.label}</span>
              <h1 className="hw-hero__h">
                How {p.headline} use AI agent infrastructure to book{" "}
                {p.volume} <em>without any technical skills<span className="dot">.</span></em>
              </h1>
              <p className="hw-hero__sub">{p.lede}</p>
            </div>

            {/* The walkthrough. Set videoId on the profession to swap the
                placeholder for the embed; each playbook gets its own. */}
            <div className="hw-video">
              {p.videoId ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${p.videoId}`}
                  title={`How ${p.headline} book meetings with AI agents`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div className="hw-video__slot">
                  <span className="hw-video__play" aria-hidden="true">▶</span>
                  <span className="hw-video__label">Walkthrough video</span>
                </div>
              )}
            </div>

            <div className="hw-hero__ctas">
              <a href={p.slug ? `/quote/${p.slug}` : "/quote"} className="btn btn--primary btn--lg">
                Get a quote <span className="arrow">→</span>
              </a>
              <a href="#rules" className="btn btn--ghost btn--lg">
                Just show me the rules
              </a>
            </div>
          </div>
        </section>

        {/* ── The board ─────────────────────────────────────── */}
        <section className="section section--tight" id="board" style={{ paddingTop: 8 }}>
          <div className="wrap">
            <LoopBoard active={stage} onPick={setStage} profession={p} />
          </div>
        </section>

        {/* ── The playbook ──────────────────────────────────── */}
        <section className="section section--tight" style={{ paddingTop: 0 }} id="playbook">
          <div className="wrap">
            <header className="sect-head">
              <span className="kicker">What actually happens</span>
              <h2 className="h-section">
                Here's the whole thing, <em>start to finish<span className="dot">.</span></em>
              </h2>
              <p className="lead">
                Eighteen things have to happen between a stranger and a meeting on
                your calendar. Here they are in the order they happen, so you can
                see exactly what's involved. Seventeen of them run on their own. The
                one that doesn't is the conversation, and that's on purpose.
              </p>
            </header>

            {PLAYBOOK.map((ph) => (
              <div className="hw-phase" key={ph.key} style={{ ["--c" as string]: ph.color }}>
                <div className="hw-phase__label">
                  <span>{ph.label}</span>
                </div>
                <ol className="hw-steps2">
                  {ph.steps.map((st) => (
                    <li key={st.n}>
                      <span className="hw-steps2__n">{st.n}</span>
                      <div>
                        <h3>{st.h}</h3>
                        <p>{st.b}</p>
                        {st.note && <p className="hw-steps2__note">{st.note}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>

        {/* ── The agent crew ────────────────────────────────── */}
        <section className="section section--tight" style={{ paddingTop: 0 }} id="crew">
          <div className="wrap">
            <header className="sect-head">
              <span className="kicker">Why an agent</span>
              <h2 className="h-section">
                It does the 90% <em>that isn't selling<span className="dot">.</span></em>
              </h2>
              <p className="lead">
                The hours in outbound aren't in the sending. They're in the research:
                reading a company's site to work out whether they're a fit, hunting down
                the right person, checking you haven't already emailed them, writing an
                opener that references something real. Done properly that's ten or
                fifteen minutes a prospect. An agent does it in seconds and shows its
                working. Across a few thousand companies, that's a full-time job you
                get back.
              </p>
              <p className="lead">
                And it isn't smarter than your best salesperson. It's more consistent.
                It doesn't get bored on row 400, doesn't skip the suppression check on a
                Friday, and never sends without verifying first.
              </p>
            </header>

            <div className="hw-split">
              <div className="hw-split__col" style={{ ["--c" as string]: "var(--hw-find)" }}>
                <span className="hw-split__k">The agents handle this</span>
                <p className="hw-split__note">High volume, low judgement.</p>
                <ul>
                  {AGENT_DOES.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <div className="hw-split__col" style={{ ["--c" as string]: "var(--hw-convert)" }}>
                <span className="hw-split__k">Only a person does this</span>
                <p className="hw-split__note">
                  Low volume, high judgement. The agent drafts and briefs. The person
                  decides and sends.
                </p>
                <ul>
                  {HUMAN_DOES.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="hw-split__close">
              That split is the whole design, not a limitation we're working around.
              The agents take the part that's volume so a person has time for the part
              that's judgement. Take the agents away and someone does ten thousand
              research tasks by hand. Take the person away and you have a robot
              negotiating with your next client. Neither of those is a business.
            </p>

            <p className="hw-crew__lead">
              Here's the crew, and what each one is allowed to touch.
            </p>

            <div className="hw-crew">
              {CREW.map((a) => (
                <article className="hw-agent" key={a.name} style={{ ["--c" as string]: a.color }}>
                  <div className="hw-agent__top">
                    <i />
                    <span className="hw-agent__name">{a.name}</span>
                  </div>
                  <h3 className="hw-agent__role">{a.role}</h3>
                  <p className="hw-agent__does">{a.does}</p>
                  <div className="hw-agent__meta">
                    <span>{a.tools}</span>
                    <b>{a.model}</b>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── What we watch for in this market ──────────────── */}
        <section className="section section--tight" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <header className="sect-head">
              <span className="kicker">Buying signals</span>
              <h2 className="h-section">
                What we watch for <em>in your market<span className="dot">.</span></em>
              </h2>
              <p className="lead">
                Anyone can pull a list. The difference is timing: four moments where
                the same message goes from ignorable to obvious.
              </p>
            </header>
            <div className="hw-signals">
              {p.signals.map((s, i) => (
                <article className="hw-signal" key={s.when}>
                  <span className="hw-signal__k">Trigger {String(i + 1).padStart(2, "0")}</span>
                  <h3 className="hw-signal__when">{s.when}</h3>
                  <p className="hw-signal__why">{s.why}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── The takeaway ──────────────────────────────────── */}
        <section className="section section--tight" style={{ paddingTop: 0 }} id="rules">
          <div className="wrap">
            <header className="sect-head">
              <span className="kicker">The short version</span>
              <h2 className="h-section">
                13 things we learned <em>the hard way<span className="dot">.</span></em>
              </h2>
              <p className="lead">
                If you take nothing else from this page, take these. Most of them you
                can use tomorrow, with or without an agent running them.
              </p>
            </header>
            <ol className="hw-rules">
              {RULES.map((x, i) => (
                <li key={x.r}>
                  <span className="hw-rules__n">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <b>{x.r}</b>
                    <span>{x.why}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── FAQ ───────────────────────────────────────────── */}
        <section className="section section--tight" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <header className="sect-head">
              <span className="kicker">FAQ</span>
              <h2 className="h-section">
                Common <em>questions<span className="dot">.</span></em>
              </h2>
            </header>
            <div className="hw-faq">
              {FAQS.map((f, i) => (
                <div
                  key={f.q}
                  className={"hw-faq__item" + (openFaq === i ? " hw-faq__item--open" : "")}
                  onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                >
                  <div className="hw-faq__q">
                    {f.q}
                    <i>+</i>
                  </div>
                  <div className="hw-faq__a">{f.a}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ─────────────────────────────────────── */}
        {/* One crawlable link to every industry version of this page. */}
        <section className="section">
          <div className="wrap">
            <h2 className="h-section" style={{ marginBottom: 20 }}>
              The same playbook, <em>for your industry</em>.
            </h2>
            <ul style={{ display: "flex", flexWrap: "wrap", gap: "10px 12px", listStyle: "none", padding: 0, margin: 0 }}>
              {PROFESSIONS.filter((x) => x.slug !== p.slug).map((x) => (
                <li key={x.slug}>
                  <a href={`/how-we-work/${x.slug}`} className="btn btn--ghost">{x.label}</a>
                </li>
              ))}
              {p.slug ? (
                <li><a href="/how-we-work" className="btn btn--ghost">Any B2B business</a></li>
              ) : null}
            </ul>
          </div>
        </section>

        <section className="section--ink cta">
          <div className="wrap">
            <span className="kicker kicker--inv">
              <i className="live-dot" /> Get started
            </span>
            <h2 className="h-section h-section--inv">
              Point this at <em>your market<span className="dot">.</span></em>
            </h2>
            <p className="cta__sub">
              Tell us who {p.possessive} sells to. Hermes builds the list, the
              filters run, the infrastructure warms, and the first conversations
              start, with a human on your side of every one of them.
            </p>
            <div className="cta__btns">
              <a href={p.slug ? `/quote/${p.slug}` : "/quote"} className="btn btn--inverse btn--lg">
                Get a quote →
              </a>
              <a
                href="/pricing"
                className="btn btn--ghost btn--lg"
                style={{ background: "transparent", borderColor: "rgba(255,255,255,0.3)", color: "#fff" }}
              >
                See pricing
              </a>
            </div>
            <p className="cta__reassure">
              Your model, your keys, your tenant. Cancel anytime.
            </p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
