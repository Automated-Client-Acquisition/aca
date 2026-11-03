import { Link } from "react-router-dom";
import { CountStat } from "@/components/marketing/CountStat";
import { RADAR } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";
import "@/styles/marketing-specialized.css";

// testimonial.to "Wall of Love" v2 embed, verbatim per their snippet.
function TestimonialWall() {
  return (
    <iframe
      id="testimonialto-34b55ae9-b1be-4e1f-97f8-eeee0d51bfb5"
      src="https://embed-v2.testimonial.to/w/automated-client-acquisition?id=34b55ae9-b1be-4e1f-97f8-eeee0d51bfb5"
      title="What members say about ACA"
      frameBorder="0"
      scrolling="no"
      width="100%"
      height="800"
      style={{ display: "block", width: "100%", border: 0 }}
      loading="lazy"
    />
  );
}

// The THIRD $27 front end (/radar) - avatar: B2B founders, consultants and
// agencies who want warm pipeline for their OWN business (distinct from
// /kit's local-lead opportunity seekers and /studio's creators). One agent,
// pre-picked (Buying Signals). Continuity disclosed 3×. Hero shows the real
// live-feed packshot until the VSL is produced.
export default function RadarSalesPage() {
  const orderHref = "/radar/order";

  return (
    <div className="sf sf--has-sticky">
      <div className="sf__bar">
        Instant access · Warm leads <b>on your desk tomorrow morning</b> · No cold lists, no code
      </div>

      {/* ================= HERO ================= */}
      <header className="sf__hero">
        <div className="sf__wrap--wide">
          <nav className="sf__nav">
            <span className="sf__brand">ACA<b>.</b></span>
            <span className="sf__navnote">For B2B founders &amp; agencies · no code</span>
          </nav>

          <div className="sf__hero-inner">
            <span className="sf__eyebrow"><i />For people ready to use and sell AI agents</span>
            <h1 className="sf__h1">
              How to launch an AI agent that finds buyers <em>the week they're ready to buy.</em>
            </h1>
            <p className="sf__sub">
              Even if your cold outreach gets ignored and you hate prospecting. The agent watches the
              market around the clock - funding rounds, new sales leaders, hiring sprees, launches -
              and hands you <b>warm companies with a real reason to talk, non-stop</b>. The 3-minute
              demo below shows the real feed it collected today.
            </p>

            <div className="sf__vsl">
              <div className="sf__panel-glow" aria-hidden="true" />
              <div className="sf__chip sf__chip--a" aria-hidden="true">
                <b>8 types</b><span>of buying signals watched 24/7</span>
              </div>
              <div className="sf__chip sf__chip--b" aria-hidden="true">
                <b>210k ★</b><span>the runtime it runs on</span>
              </div>
              {/* Mini VSL: 2m50s Kern-framework demo built from the real live feed */}
              <video
                className="sf__vsl-video"
                src="/radar/radar-demo.mp4"
                poster="/radar/radar-demo-poster.jpg"
                controls
                playsInline
                preload="metadata"
              />
            </div>

            <Link className="sf__cta" to={orderHref}>YES! Give Me My Signals Agent - ${RADAR.price} →</Link>
            <p className="sf__cta-note">Instant access · 30-day keep-everything guarantee · Cancel anytime</p>
          </div>
        </div>
      </header>

      {/* ================= LETTER INTRO ================= */}
      <main>
        <section className="sf__sec">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <p>
              <b>Somewhere right now, a company just raised money, hired a new VP of Sales, and started
              a hiring spree - and for the next few weeks they will say yes to conversations they'd
              have ignored last month.</b>
            </p>
            <p>Hold that thought, because it's the whole opportunity on this page.</p>
            <p>
              If you want a pipeline that fills itself instead of another morning of cold-list
              prospecting… or maybe you're tired of sending a hundred messages to people who weren't
              in the market for what you sell… or perhaps you've watched competitors "get lucky" with
              perfectly-timed outreach and thought <i>how do they always know?</i>…
            </p>
            <p>
              Maybe you're a founder doing your own sales. Maybe you run an agency and the next client
              always arrives too slowly. Maybe you've been circling the idea of{" "}
              <b>selling warm-lead feeds to other businesses</b>: an actual AI agent business. But
              nobody would show you the first rung of the ladder.
            </p>
            <p>
              Then this is going to be the most important page you read this year, because you're
              about to discover the REAL way people book B2B meetings with AI: <b>without cold lists,
              without spraying a thousand messages, and without a single "just checking in."</b>
            </p>
            <p>
              My name is Cedric, and I built what you're about to see because I got burned by the
              other way first.
            </p>
            <p>
              I know what it's like to buy the database, blast the sequence, and watch a 0.5% reply
              rate come back. And I know the worst feeling of all: being <i>good enough at what you
              sell</i>, but invisible because you talk to buyers at the wrong moment.
            </p>
            <p>So let me save you three months.</p>
          </div>
        </section>

        {/* ================= 01 · THE ONE IDEA ================= */}
        <section className="sf__sec sf__sec--paper">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>01</b>The one idea that changes everything</div>
            <h2>Nobody replies to cold. <em>Everybody replies at the right moment.</em></h2>
            <p>
              See, the most common belief that keeps B2B pipelines empty is that <b>outreach is a
              numbers game</b> - send more, book more. And as you're about to see, that's backwards.
              The companies that just raised a round, just hired a sales leader, just opened twenty
              job listings - they're not "leads." They're <b>buyers in motion</b>. Something changed,
              money is moving, and new priorities need vendors.
            </p>
            <p>
              Now here's the unlock: <span className="sf__mark">every one of those moments is public
              information the day it happens.</span> Funding announcements, executive appointments,
              hiring pages, product launches - it's all out there. And watching thousands of sources
              around the clock is the single thing AI agents are best at on planet Earth.
            </p>
            <p>
              So while everyone else buys stale databases and sprays sequences, the people quietly
              booking meetings run ONE agent that produces the most valuable thing in B2B sales:
              <b> the right company at the right week, with the reason to talk attached.</b> They use
              it for their own pipeline - and the sharp ones sell the feed to clients who'd pay
              monthly for it.
            </p>
            <p>
              No cold lists needed, because the market tells you who's buying. No volume needed,
              because ten well-timed messages out-book a thousand cold ones. No credibility needed,
              because your opener isn't a pitch - it's "congrats on the round; here's what usually
              breaks next."
            </p>
          </div>
        </section>

        {/* ================= STAT BAND ================= */}
        <section className="sf__sec sf__sec--dark">
          <div className="sf__wrap--wide">
            <div className="sf__statband-grid">
              <CountStat target={8} suffix="" label="Types of buying signals the agent watches, 24/7" />
              <CountStat target={210} suffix="k" label="GitHub stars on the runtime your agent runs on" />
              <CountStat target={127} suffix="+" label="Founders & agencies running these agents inside" />
            </div>
          </div>
        </section>

        {/* ================= 02 · THE MONEY MOTION ================= */}
        <section className="sf__sec">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>02</b>The money motion: steal this even if you never buy</div>
            <h2>The <em>Warm Window Method</em>, in three moves</h2>

            <div className="sf__pipe">
              <div className="sf__pipe-step">
                <span className="sf__pipe-node">1</span>
                <h3>Let the agent watch the market</h3>
                <p>
                  Tell it who you sell to. It monitors funding rounds, leadership changes, hiring
                  demand, launches, expansions - eight signal types - and every morning hands you the
                  companies where something just changed. This is the part my agent does while you
                  sleep.
                </p>
              </div>
              <div className="sf__pipe-step">
                <span className="sf__pipe-node">2</span>
                <h3>Reach out inside the window</h3>
                <p>
                  A company that raised on Tuesday is staffing up by Friday. Your first message leads
                  with <i>their</i> news, not your pitch - which is why it gets read. The window is
                  weeks, not months, and you're in it first.
                </p>
              </div>
              <div className="sf__pipe-step">
                <span className="sf__pipe-node">3</span>
                <h3>Convert the reply into a meeting</h3>
                <p>
                  When the reason to talk is real and the timing is theirs, "open to a quick call?"
                  stops being an interruption. That's a booked meeting - or, run this for clients,
                  and it's a warm-lead feed businesses pay for every month.
                </p>
              </div>
            </div>

            <p>
              Read those three steps again. Notice what's <i>missing</i>: no bought lists, no
              thousand-row sequences, no "bumping this to the top of your inbox." The entire motion is
              "watch for the moment, show up with the reason, take the meeting."
            </p>

            <h3>The receipts from the feed you saw at the top</h3>
            <p>
              That image is a real slice of the agent's live feed - <b>collected today</b>: a $900M
              facility, a $7.5M Series A, two brand-new sales leaders, a $300M raise in motion.
              Companies with money moving and reasons to talk:
            </p>
            <img
              className="sf__shot"
              src="/radar/radar-packshot.jpg"
              alt="Real buying signals collected today: Nscale, KOR Protocol, Gridcog, Bidbus, InteleTravel, Apo, GoKwik, Lovable"
              decoding="async"
            />
            <p className="sf__shot-cap">the live feed, today's collection · every row is a public, checkable event. That's what real looks like.</p>

            <h3>The two details that separate the booked from the ignored</h3>
            <p>
              <b>Detail #1: the signal is the opener.</b> "Congrats on the Series A - usually the next
              six months break the onboarding process" out-performs any pitch ever written, because it
              proves you pay attention to <i>them</i>. The agent attaches the signal to every lead so
              the opener writes itself.
            </p>
            <p>
              <b>Detail #2: fresh beats complete.</b> A perfectly-enriched contact from a stale
              database loses to a half-enriched company whose news broke this morning. Timing is the
              moat - which is exactly why the agent runs non-stop instead of exporting a one-time
              list.
            </p>
            <p>
              If the free method on this page is already sharper than the last course you paid for…
              you can imagine what the finished system is like. Which brings me to it.
            </p>
          </div>
        </section>

        {/* ================= 03 · WHAT'S INSIDE ================= */}
        <section className="sf__sec sf__sec--paper">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>03</b>What's inside</div>
            <h2>Introducing: <em>The Buying Signals Kit</em></h2>
            <img
              className="sf__shot"
              src="/radar/radar-bundle.jpg"
              alt="The Buying Signals Kit bundle: the agent, the First Meeting Playbook, the 30-Minute Launch Walkthrough, both bonuses, and 30 days of ACA Xtreme"
              decoding="async"
            />
            <p>
              <b>If you're serious about a pipeline that fills itself (like, this-week-serious),
              you're going to love this.</b> The Kit is everything above, finished and handed to you.
              Not instructions for building an agent. <b>The agent.</b> Not theory about warm
              windows. The playbook with every script. Not "good luck with the tech." A copy-paste
              walkthrough that has it running in about 30 minutes.
            </p>
            <p>
              And understand what you're actually buying, because it isn't software: <b>it's the
              first rung of an AI agent business.</b> The agent is your inventory. Its warm-lead feed
              is your product. The playbook is your sales motion. Use it for your own pipeline, sell
              the feed to clients - and once you're inside, add agent after agent until "I use AI"
              becomes "I sell AI." That's the opportunity, and it starts at rung one, tonight, for
              ${RADAR.price}.
            </p>

            <div className="sf__comp">
              <div className="sf__comp-tag">Component #1 · value $297</div>
              <h3>The Buying Signals Agent - finished and yours</h3>
              <p>
                The same agent feeding our community's pipelines every day, delivered ready to
                install. Point it at the market you sell into, and it watches eight signal types
                around the clock and delivers warm companies with the reason-to-talk attached.
              </p>
              <ul>
                <li>The eight signal types it watches - and which two quietly produce the most booked meetings (it's not funding).</li>
                <li>Why it attaches the source event to every lead: your opener writes itself from the signal.</li>
                <li>The dedupe-and-freshness step that keeps the feed clean instead of echoing the same news five times.</li>
                <li>How it exports straight into your outreach stack, so a signal becomes a sent message the same day.</li>
              </ul>
            </div>

            <div className="sf__comp">
              <div className="sf__comp-tag">Component #2 · value $47</div>
              <h3>The 30-Minute Launch Walkthrough</h3>
              <p>
                The exact reason "I'm not technical" doesn't apply here. You follow along on screen:
                copy, paste, click. Your agent is alive at the end. Including:
              </p>
              <ul>
                <li>The full install, keystroke by keystroke: the runtime goes in with one command, your agent with one more.</li>
                <li>How to describe your ICP so the feed is on-target from day one instead of week three.</li>
                <li>Your first collection run and how to read it like an operator, not a spectator.</li>
                <li>What "good" looks like: the freshness checklist a signal must pass before you act on it.</li>
              </ul>
            </div>

            <div className="sf__comp">
              <div className="sf__comp-tag">Component #3 · value $147</div>
              <h3>The First Meeting Playbook</h3>
              <p>
                The Warm Window Method, weaponized. Everything between "my agent found a signal" and
                "a meeting is on my calendar": scripted, sequenced, and priced if you sell the feed.
                You'll discover:
              </p>
              <ul>
                <li>The word-for-word first message for each signal type. It leads with their news and never mentions AI.</li>
                <li>The 48-hour rule: when a signal is hot, when it's warm, and when to let it go.</li>
                <li>The follow-up that converts a polite reply into a calendar link without a whiff of desperation.</li>
                <li>How to turn one booked meeting into a referral loop inside the same company.</li>
                <li>The agency pivot: packaging the feed as a monthly deliverable clients pay for.</li>
                <li>What to say when they ask "how did you know?" The honest answer that makes you MORE credible.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ================= 04 · THE ENGINE ================= */}
        <section className="sf__sec sf__sec--dark">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>04</b>The engine underneath</div>
            <h2>Your agent runs on the <em>fastest-growing software on Earth</em></h2>
            <p>
              The Kit's agent runs on <b>Hermes Agent</b>: the free, open-source AI agent runtime.
              Which means it lives on YOUR machine, runs on YOUR keys, and no company can ever
              paywall it, cap it, or take it away. And this isn't some niche tool you've never heard
              of for a reason:
            </p>
            <div className="sf__proof">
              Hermes is the <b>fastest-growing open-source AI agent on GitHub: 210k stars</b>. And
              it just <b>overtook OpenClaw</b>, the software Nvidia's CEO called "the most important
              software release probably ever." You're not betting on a fad. You're installing the
              thing the industry is standardizing on before most people know how to use it.
              <cite>GitHub star count and rankings as of this writing. Sources: CNBC, Forbes</cite>
            </div>
            <img
              className="sf__shot"
              src="/kit/proof-hermes-github.png"
              alt="The Hermes Agent GitHub repository showing 210k stars"
              decoding="async"
            />
            <p className="sf__shot-cap">github.com/NousResearch/hermes-agent - 210k stars, 38.4k forks</p>
            <img
              className="sf__shot"
              src="/kit/proof-forbes.png"
              alt="Forbes headline: Hermes Agentic AI Overtakes OpenClaw, 10 Shifts Leaders Need To Know"
              decoding="async"
            />
            <p className="sf__shot-cap">Forbes, May 25 2026</p>
            <img
              className="sf__shot"
              src="/kit/proof-cnbc.png"
              alt="CNBC headline: Nvidia CEO Jensen Huang calls OpenClaw 'the most important software release probably ever'"
              decoding="async"
            />
            <p className="sf__shot-cap">CNBC, March 5 2026. The software Hermes just overtook.</p>
          </div>
        </section>

        {/* ================= 05 · THE DEAL ================= */}
        <section className="sf__sec">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>05</b>The deal</div>
            <h2>Let's talk about what this <em>should</em> cost</h2>
            <p>
              Intent-data platforms - the enterprise tools that sell exactly this kind of signal -
              start around $12,000 <i>a year</i> and won't return your call without a demo and a
              contract. The mid-market "signals" SaaS tier runs $99 to $500 a month, forever. An SDR
              who manually stalks the news for you? That's a salary.
            </p>

            <div className="sf__mathcard" aria-label="Cost comparison">
              <h3>The ways to get warm pipeline</h3>
              <div className="mrow">
                <span className="n">Enterprise intent-data platform<small>annual contract, demo required</small></span>
                <span className="p">$12,000+/yr</span>
              </div>
              <div className="mrow">
                <span className="n">Signals / alerts SaaS<small>every month, forever</small></span>
                <span className="p">$99-500/mo</span>
              </div>
              <div className="mrow">
                <span className="n">An SDR watching the news<small>plus management, plus ramp time</small></span>
                <span className="p">a salary</span>
              </div>
              <div className="mrow win">
                <span className="n">The Buying Signals Kit - finished agent + playbook<small>one-time · 30 days of ACA Xtreme included</small></span>
                <span className="p">${RADAR.price}</span>
              </div>
            </div>

            <p>
              Or forget the alternatives and just look at the math of the thing itself: what is ONE
              well-timed B2B meeting worth to you? For most people reading this page, a single closed
              deal pays for this Kit hundreds of times over. That's the whole point of a front-end
              product like this - it's designed to be the easiest yes of your year.
            </p>

            <div className="sf__proof">
              And these aren't prototypes. This exact agent and its eight siblings run every day
              inside a community of <b>127+ founders and agencies</b>. One 3-person agency's setter
              booked <b>11 sales calls in its first two weeks</b>. The Buying Signals Agent in your
              Kit comes from the same production library, not a tutorial.
              <cite>Member results, not a promise. Your income depends on your effort and your market.</cite>
            </div>

            <h3>Don't take my word for it. Here's the room you're joining.</h3>
            <div className="sf__wall">
              <TestimonialWall />
            </div>

            <h3>And because you're getting in at launch, I'm stacking the deck</h3>
            <div className="sf__bonus">
              <span className="sf__bonus-n">Bonus 1</span>
              <div>
                <h3>The 8 Signals Cheat Sheet - <span className="v">$47 value, free today</span></h3>
                <p>
                  Every signal type the agent watches, ranked by how fast it converts to a meeting -
                  what each one means, the window it opens, and the one signal beginners chase that
                  almost never buys.
                </p>
              </div>
            </div>
            <div className="sf__bonus">
              <span className="sf__bonus-n">Bonus 2</span>
              <div>
                <h3>The Signal Scoring Sheet - <span className="v">$37 value, free today</span></h3>
                <p>
                  Which of today's signals to act on FIRST when the feed hands you twenty - scored by
                  deal size, urgency, and fit, so your best hour of outreach goes where the money is
                  moving fastest.
                </p>
              </div>
            </div>
            <div className="sf__bonus">
              <span className="sf__bonus-n">Bonus 3</span>
              <div>
                <h3>30 days inside ACA Xtreme - <span className="v">$67 value, included</span></h3>
                <p>
                  The platform your agent plugs into (outreach, unified inbox, CRM) plus the room
                  where 127+ people are building AI agent businesses with weekly live build calls.
                  The "never stuck at step 3 alone" insurance. After your 30 days it's $
                  {RADAR.renewalPrice}/month, cancel anytime in one click.
                </p>
              </div>
            </div>

            <div className="sf__stack">
              <h3>Everything you get today</h3>
              <div className="sf__stack-row"><span>✅ <b>The Buying Signals Agent:</b> finished, installed in ~30 min, warm leads non-stop</span><span className="v">$297</span></div>
              <div className="sf__stack-row"><span>✅ <b>The 30-Minute Launch Walkthrough:</b> copy-paste install, zero code</span><span className="v">$47</span></div>
              <div className="sf__stack-row"><span>✅ <b>The First Meeting Playbook:</b> the Warm Window Method, scripted end to end</span><span className="v">$147</span></div>
              <div className="sf__stack-row"><span>✅ <b>Bonus: The 8 Signals Cheat Sheet:</b> every signal, ranked by speed to meeting</span><span className="v">$47</span></div>
              <div className="sf__stack-row"><span>✅ <b>Bonus: The Signal Scoring Sheet:</b> where your best hour goes first</span><span className="v">$37</span></div>
              <div className="sf__stack-row"><span>✅ <b>Bonus: 30 days of ACA Xtreme:</b> platform + weekly live builds + the room</span><span className="v">$67</span></div>
              <div className="sf__stack-total">
                <span className="was">Total value: $642</span>
                <span className="now">Today: ${RADAR.price}</span>
              </div>
            </div>

            <p>
              So here's the moment of truth. Everything above is honestly worth $642. And if all it
              did was land you ONE well-timed meeting, it would be worth ten times that.
            </p>
            <p>
              <b>Today, on this page, you get the entire Buying Signals Kit for ${RADAR.price}.</b>{" "}
              Less than dinner. Less than one month of the cheapest alerts tool - for the machine
              that replaces it.
            </p>
            <p>
              Why so cheap? No mystery: some of you will love working with us, stay in the community,
              and grow from there. The ${RADAR.price} just filters for people who'll actually show
              up. That's the whole "catch."
            </p>

            <Link className="sf__cta" to={orderHref}>YES! Give Me My Signals Agent - ${RADAR.price} →</Link>
            <p className="sf__cta-note">Instant access · watching the market tonight</p>

            <div className="sf__guarantee">
              <h3>The 30-Day "Keep Everything" Guarantee</h3>
              <p>
                Install the agent. Run a collection. Open the playbook. If you don't think this was
                worth ten times the ${RADAR.price}, email one word: "refund". Any time in 30 days,
                and every cent comes back. <b>Keep the agent. Keep the playbook. Keep both
                bonuses.</b> No forms, no phone call, no "let me offer you a discount instead."
              </p>
              <p>
                Worst case: you get a working AI agent and a meeting-booking playbook for free. Best
                case: next week you open a conversation with a company the morning their news broke -
                and they take the call. <b>This decision is easy.</b>
              </p>
            </div>

            <div className="sf__urgency">
              <b>Fair warning about the price:</b> ${RADAR.price} is the launch price, and it exists
              to build our first wave of case studies. When we have them, it goes up. And the bonuses
              come off the table first. There's no fake countdown clock on this page - but every week
              you wait is a week of buying windows that opened and closed without you in them.
            </div>

            <h2>Let's put it all on one screen</h2>
            <p>
              For ${RADAR.price} - one-time, today - you get the finished Buying Signals Agent
              ($297), the 30-Minute Launch Walkthrough ($47), the First Meeting Playbook ($147), the
              8 Signals Cheat Sheet ($47), the Signal Scoring Sheet ($37), and 30 days inside ACA
              Xtreme ($67). That's $642 of tools and playbooks for the price of a pizza - protected
              by a 30-day guarantee where you keep everything even if you refund.
            </p>

            <div className="sf__disclose">
              <b>The straight answer on billing:</b> ${RADAR.price} once today. Your Kit includes 30
              days of ACA Xtreme. After 30 days it renews at <b>${RADAR.renewalPrice}/month</b>{" "}
              unless you cancel: one click, anytime, even day 29. Cancel and you still keep the
              agent, the playbook, and the bonuses.
            </div>

            <h2>Fair questions, straight answers</h2>
            <div className="sf__faq">
              <details>
                <summary>Where do the signals actually come from?</summary>
                <p>
                  Public sources: funding announcements, press, executive appointments, company hiring
                  pages, launches. Every signal links back to its source event - you can check each
                  one yourself, the way you could with the feed at the top of this page.
                </p>
              </details>
              <details>
                <summary>Do I need to know how to code, or buy anything else?</summary>
                <p>
                  No code - the install is copy-paste with a walkthrough. The only extra is tiny: the
                  AI runs on your own key (a few dollars a month for most people, pay-as-you-go), and
                  the walkthrough shows you exactly where to get it.
                </p>
              </details>
              <details>
                <summary>What do the agents actually run on?</summary>
                <p>
                  Hermes Agent: the free, open-source AI agent runtime with 210k GitHub stars, the
                  fastest-growing agent in the world. It recently overtook OpenClaw (the software
                  Nvidia's CEO called "the most important software release probably ever") as the
                  most-used open-source agent. Your agent runs on your own machine with your own keys
                  - nobody can cap it or shut it off. The walkthrough installs Hermes for you (one
                  command). Every agent in our library installs into it the same way.
                </p>
              </details>
              <details>
                <summary>I sell something niche. Will the signals fit MY market?</summary>
                <p>
                  You aim the agent at your ICP - industry, size, geography - and it watches that
                  slice of the market. Signals are universal (money raised, leaders hired, teams
                  growing); the targeting is yours.
                </p>
              </details>
              <details>
                <summary>How fast can I realistically book a meeting?</summary>
                <p>
                  Your agent can be running today and hand you fresh signals this week. How fast that
                  becomes meetings depends on you actually sending the playbook's messages. We won't
                  promise you revenue - anyone who does is lying. We promise a working agent, the
                  exact playbook, and a room full of people who'll help.
                </p>
              </details>
              <details>
                <summary>What if I'd rather do outbound at volume too?</summary>
                <p>
                  Add the other two outbound agents at checkout for ${RADAR.bumps.duo.price}: the
                  Lead Pipeline Agent (researches and qualifies prospects end to end) and the AI
                  Setter (books calls from LinkedIn, in your voice). Warm windows for timing, volume
                  for coverage.
                </p>
              </details>
              <details>
                <summary>What is ACA Xtreme, exactly?</summary>
                <p>
                  Our platform + community. The platform handles the plumbing an agent needs
                  (outreach, unified inbox, CRM); the community is 127+ founders and agencies with
                  weekly live build calls. First 30 days are in your Kit; then $
                  {RADAR.renewalPrice}/month, cancel anytime in one click.
                </p>
              </details>
              <details>
                <summary>What if it doesn't work for me?</summary>
                <p>30 days, full refund, keep everything. One email, zero questions.</p>
              </details>
            </div>
          </div>
        </section>

        {/* ================= FINAL CTA ================= */}
        <section className="sf__final">
          <div className="sf__wrap">
            <h2>You're one agent away from <em>never prospecting cold again.</em></h2>
            <p>
              Somewhere in your market this week, a company raised money, hired a closer, and started
              looking for exactly what you sell. The only question is whether you find out this week -
              or read about it in their case study next year.
            </p>
            <Link className="sf__cta" to={orderHref}>YES! Give Me My Signals Agent - ${RADAR.price} →</Link>
            <p className="sf__cta-note">Instant access · 30-day keep-everything guarantee</p>
          </div>
        </section>
      </main>

      <div className="sf__sticky">
        <span>The Buying Signals Kit · watching tonight</span>
        <Link to={orderHref}>Get it for ${RADAR.price} →</Link>
      </div>

      <footer className="sf__foot">
        <div className="sf__wrap">
          © {new Date().getFullYear()} Automated Client Acquisition ·{" "}
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
          <br />
          Dollar figures describe what businesses commonly pay for intent data and related services.
          Not a promise of what you'll earn. Results require real effort and vary.
        </div>
      </footer>
    </div>
  );
}
