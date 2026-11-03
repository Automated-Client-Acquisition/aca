import { Link } from "react-router-dom";
import { SPRINT } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";

// $27 front end of the cold-traffic funnel: the 5-Day "First Client Machine"
// Build Sprint (includes 30 days of ACA Xtreme, renews at $67/mo - disclosed
// three times on this page). Long-form direct-response letter, no insider
// jargon: cold traffic has never heard of ACA, agents, or Hermes.
export default function SprintSalesPage() {
  const orderHref = "/sprint/order";

  return (
    <div className="sf sf--has-sticky">
      <div className="sf__bar">
        Next Sprint starts <b>{SPRINT.startLabel}</b> · Doors close {SPRINT.doorsCloseLabel} · Limited to {SPRINT.seatsLabel}
      </div>

      <header className="sf__hero">
        <div className="sf__wrap">
          <nav className="sf__nav">
            <span className="sf__brand">ACA<b>.</b></span>
            <span className="sf__navnote">Live build · no experience needed</span>
          </nav>
          <div className="sf__hero-inner">
            <span className="sf__eyebrow"><i />For founders &amp; agencies who need clients - not another course</span>
            <h1 className="sf__h1">
              Build an AI setter that books sales calls for you - <em>live with us, in 5 days.</em>
            </h1>
            <p className="sf__sub">
              You'll install a real AI agent on your own LinkedIn, we'll wire the whole machine behind
              it together, and it'll be out working your leads <b>before Friday</b>. Just $
              {SPRINT.price} - with 30 days of the platform + community that runs it included.
            </p>
            <Link className="sf__cta" to={orderHref}>YES! Save My Seat For ${SPRINT.price} →</Link>
            <p className="sf__cta-note">Live-By-Friday guarantee · Cancel anytime · Instant confirmation</p>
          </div>
        </div>
      </header>

      <main className="sf__letter sf__wrap">

        {/* ============ HOOK STORY (Epiphany Bridge) ============ */}
        <p><b>Dear frustrated founder,</b></p>
        <p>
          If you're tired of watching your calendar sit empty while everyone on LinkedIn seems to be
          "booked out for weeks"... this will be the most important letter you read this year.
        </p>
        <p>Because I was you. Recently.</p>
        <p>
          I needed clients. So I did what everyone tells you to do. I bought the outreach tool. Then
          the tool that finds the leads. Then the tool that warms up the inbox so the first tool's
          emails don't go to spam. Then a CRM to keep track of it all.
        </p>
        <p>
          Nine browser tabs. <span className="sf__mark">Thirteen hundred dollars a month.</span> A
          Google Sheet holding the whole thing together with tape. And you know how many sales calls
          all of that booked me?
        </p>
        <p><b>Almost none.</b></p>
        <p>
          Because every message those tools sent sounded exactly like what it was: a template, blasted
          by software, that every prospect has already deleted a hundred times.
        </p>
        <p>
          The thing that finally worked was embarrassingly simple. The messages that got replies were
          the ones that sounded like <i>me</i> - short, casual, about <i>them</i> - sent to people who
          were already active in my space. The problem was never the message. It was that doing it by
          hand took three hours a day I didn't have.
        </p>
        <p>
          So I built something that does it <i>for</i> me: an AI agent that runs on my own LinkedIn
          account. It finds people already engaging with topics in my niche, figures out which ones
          fit what I sell, writes each of them a message in my voice - and then waits for me to
          approve it from my phone before anything sends.
        </p>
        <p>
          A day's worth of outreach, done before my coffee gets cold. And because every message reads
          like a human wrote it, the numbers stopped looking like spam numbers:
        </p>

        <div className="sf__proof">
          A 3-person agency running this exact system went from 1-2 calls a week to{" "}
          <b>11 booked calls in their first two weeks</b>. The messages hold{" "}
          <b>40%+ connection accepts and 30%+ replies</b> - because they don't sound like a bot.
          <cite>- results from inside our community. Your numbers depend on your offer and your effort.</cite>
        </div>

        <p>
          I've since taught this build to a community of <b>127+ founders and agencies</b>. And I've
          watched where people get stuck. It's never the AI part. It's the plumbing around it. Which
          is exactly why this Sprint exists.
        </p>

        <hr className="sf__hr" />

        {/* ============ PROBLEM AGITATION ============ */}
        <h2>Why "just do outreach" hasn't worked for you</h2>
        <p>Let's be honest about what's actually going on:</p>
        <ul>
          <li>
            <b>The surface problem:</b> your pipeline depends on referrals and luck. Some months are
            great. Some months are terrifying. You can't plan, can't hire, can't breathe.
          </li>
          <li>
            <b>The real problem:</b> you've tried outreach - the templates, maybe a tool, maybe even a
            freelancer - and it produced silence. So now a part of you believes outreach "doesn't work
            in my industry."
          </li>
          <li>
            <b>The unfair part:</b> you shouldn't need $1,300 a month of software and a sales team just
            to <i>talk to people who need what you sell</i>. The big agencies have systems doing this
            every day. You've just never been shown how to build one.
          </li>
        </ul>
        <p>
          Outreach isn't dead. <b>Lazy outreach is dead.</b> The founders quietly booking 10+ calls a
          month aren't sending better templates. They're running a machine that does the research,
          the personalization, and the follow-up automatically - and only pings them to approve and
          show up.
        </p>

        {/* ============ SOLUTION / MECHANISM ============ */}
        <h2>The First Client Machine: the 20% everyone shows off, plus the 80% nobody teaches</h2>
        <p>Every client-getting system that actually works has three parts:</p>
        <ul>
          <li>
            <b>The Agent (the 20%).</b> An AI setter on your own LinkedIn that finds warm prospects,
            qualifies them against what you sell, and writes each one a human-sounding message.
            This is the part everyone posts screenshots of.
          </li>
          <li>
            <b>The Engine (the 80%).</b> Deliverability, sending limits that keep your account safe,
            an inbox that catches every reply, follow-up that never forgets. This is the part that
            decides whether you book calls or burn your account - and it's included: your Sprint
            ticket comes with 30 days of <b>ACA Xtreme</b>, the platform + community where the whole
            engine already runs.
          </li>
          <li>
            <b>The Loop (you, 10 minutes a day).</b> Drafts land on your phone. You tap approve. You
            show up to the calls. That's your job now.
          </li>
        </ul>
        <p>
          In five days, live on Zoom, we build all three parts <b>together</b>. Not theory. Not a
          course you'll never finish. By Friday your agent is live and sending real messages to real
          prospects in your niche.
        </p>

        {/* ============ WHAT'S INSIDE - THE 5 DAYS ============ */}
        <h2>What we build each day</h2>

        <div className="sf__day">
          <span className="sf__day-n">DAY<b>1</b></span>
          <div>
            <h4>Aim the machine</h4>
            <p>
              We nail exactly who you sell to and the one-line offer that makes them reply - then set
              up your accounts the safe way. Get this wrong and no tool can save you; get it right and
              even average messages book calls.
            </p>
          </div>
        </div>
        <div className="sf__day">
          <span className="sf__day-n">DAY<b>2</b></span>
          <div>
            <h4>Install your AI setter</h4>
            <p>
              You install the finished agent on your own LinkedIn - copy, paste, follow along on
              screen. It starts finding people already engaging in your niche and drafting messages
              in your voice, with you approving every one.
            </p>
          </div>
        </div>
        <div className="sf__day">
          <span className="sf__day-n">DAY<b>3</b></span>
          <div>
            <h4>The 80% nobody teaches</h4>
            <p>
              Deliverability, warm-up, safe daily limits, and the unified inbox - the invisible
              plumbing that separates "11 calls in two weeks" from "banned account and spam folder."
              This day alone is worth the ticket.
            </p>
          </div>
        </div>
        <div className="sf__day">
          <span className="sf__day-n">DAY<b>4</b></span>
          <div>
            <h4>Go live</h4>
            <p>
              Your first real connection requests and messages go out - throttled, human-paced, on
              your approval. We watch the first replies land together and handle them the right way.
            </p>
          </div>
        </div>
        <div className="sf__day">
          <span className="sf__day-n">DAY<b>5</b></span>
          <div>
            <h4>From replies to booked calls</h4>
            <p>
              The follow-up system, the booking flow, and your 30-day plan - so the machine keeps
              running after the Sprint ends and warm replies become calls on your calendar.
            </p>
          </div>
        </div>

        <p style={{ marginTop: 18 }}>
          Every session is <b>live</b>, with Q&amp;A until your questions are answered. Roughly 60-90
          minutes a day, and if you miss one, it won't sink you - you can catch up the same evening.
        </p>

        {/* ============ OFFER STACK ============ */}
        <div className="sf__stack">
          <h3>Everything you get when you join today</h3>
          <div className="sf__stack-row"><span><b>5 days of live build sessions</b> - we build it with you, step by step, Q&amp;A included</span><span className="v">$497</span></div>
          <div className="sf__stack-row"><span><b>The finished AI Setter agent</b> - installed on your own account, yours to keep</span><span className="v">$297</span></div>
          <div className="sf__stack-row"><span><b>The 9-stage message playbook</b> - the exact lines holding 40%+ accepts and 30%+ replies</span><span className="v">$97</span></div>
          <div className="sf__stack-row"><span><b>30 days of ACA Xtreme</b> - the platform (deliverability, inbox, CRM) + weekly build calls + the community</span><span className="v">$67</span></div>
          <div className="sf__stack-row"><span><b>The go-live checklist</b> - account-safety limits and launch review, so you never risk a ban</span><span className="v">$47</span></div>
          <div className="sf__stack-total">
            <span className="was">Total value: $1,005</span>
            <span className="now">Today: ${SPRINT.price}</span>
          </div>
        </div>

        <p>
          Why so cheap? Simple: some of you will love working with us, stay in the community, and some
          will eventually join our advanced programs. The ${SPRINT.price} filters for people serious
          enough to show up - that's it. No, there's no catch, and yes, you keep the agent and the
          playbook even if you cancel everything.
        </p>

        <Link className="sf__cta" to={orderHref}>YES! Save My Seat For ${SPRINT.price} →</Link>
        <p className="sf__cta-note">Instant confirmation · Starts {SPRINT.startLabel}</p>

        {/* ============ GUARANTEE ============ */}
        <div className="sf__guarantee">
          <h3>The "Live-By-Friday" Guarantee</h3>
          <p>
            Show up and build with us. If your agent isn't <b>live and sending real messages by
            Friday</b>, email us one word - "refund" - and your ${SPRINT.price} comes straight back.
            Keep the playbook. Keep everything you built. No forms, no phone call, no hard feelings.
          </p>
          <p>
            <b>Worst case:</b> you spend five days building a real asset, it's not for you, and you
            get your money back. <b>Best case:</b> your calendar stops being empty. This decision is
            easy.
          </p>
        </div>

        {/* ============ URGENCY ============ */}
        <div className="sf__urgency">
          <b>Doors close {SPRINT.doorsCloseLabel}.</b> We run one Sprint per month and cap it at{" "}
          {SPRINT.seatsLabel} so live Q&amp;A stays useful. Miss this one and the next build starts a
          month from now - that's another month of an empty calendar you don't get back.
        </div>

        {/* ============ RENEWAL DISCLOSURE ============ */}
        <div className="sf__disclose">
          <b>The straight answer on billing:</b> your ${SPRINT.price} ticket includes your first 30
          days of ACA Xtreme (the platform + community). After 30 days it renews at{" "}
          <b>${SPRINT.renewalPrice}/month</b>. You can cancel in one click from your account, any
          time, even on day 29 - no emails, no retention calls, no hoops. If you cancel, you still
          keep the agent and playbook you built.
        </div>

        {/* ============ FAQ ============ */}
        <h2>Fair questions, straight answers</h2>
        <div className="sf__faq">
          <details>
            <summary>I'm not technical. Can I actually build this?</summary>
            <p>
              Yes - that's the entire point of doing it live. You copy, you paste, you follow along on
              screen. If you can install an app and write an email, you can build this. And when you
              get stuck, you ask in the live Q&amp;A and we fix it together, on the call.
            </p>
          </details>
          <details>
            <summary>How much time does it take?</summary>
            <p>
              About 60-90 minutes a day for five days. After that, the machine runs on roughly 10
              minutes a day - approving messages from your phone and answering warm replies.
            </p>
          </details>
          <details>
            <summary>Will this get my LinkedIn account banned?</summary>
            <p>
              This is exactly why Day 3 exists. The agent sends at human pace, under safe daily
              limits, through LinkedIn's official connected-app layer - and nothing sends without your
              approval. You're never one bad automation away from a ban, because <i>you</i> approve
              every message.
            </p>
          </details>
          <details>
            <summary>I've tried outreach tools before. How is this different?</summary>
            <p>
              Tools blast templates from a shared playbook every prospect has already seen. Your agent
              writes each message individually, in your voice, about the prospect - and targets people
              already active in your niche instead of a cold list. That's why the reply rates look
              nothing like tool reply rates. Plus: nobody hands you a tool here. You build it, live,
              with help - so you actually understand and own it.
            </p>
          </details>
          <details>
            <summary>What is ACA Xtreme exactly?</summary>
            <p>
              It's our platform + community. The platform handles the "80%": deliverability, safe
              sending, the unified inbox, and the CRM your agent plugs into. The community is 127+
              founders and agencies building these systems, with weekly live build calls. Your first
              30 days are included with the Sprint; after that it's ${SPRINT.renewalPrice}/month,
              cancel anytime in one click.
            </p>
          </details>
          <details>
            <summary>What if I can't make a session live?</summary>
            <p>
              Sessions run live and the momentum of building together is the magic - but life happens.
              You can add lifetime recordings at checkout for $17 and catch up the same evening.
            </p>
          </details>
          <details>
            <summary>What happens after the 30 days?</summary>
            <p>
              Your membership renews at ${SPRINT.renewalPrice}/month unless you cancel - one click,
              any time, even day 29. Most people stay, because by then the machine is booking calls
              and the weekly builds keep adding new agents to it. But that's your call to make, not
              ours to force.
            </p>
          </details>
        </div>

        {/* ============ FINAL CLOSE ============ */}
        <h2>Two ways your next 30 days can go</h2>
        <p>
          <b>Option one:</b> keep doing what you're doing. Wait for referrals. Maybe buy another tool.
          In 30 days your calendar looks exactly like it does today, and the only thing you've built
          is more frustration.
        </p>
        <p>
          <b>Option two:</b> spend ${SPRINT.price} and five days with us. Walk out with a working AI
          setter on your own account, the machine behind it, and your first warm replies in the inbox
          - protected by a guarantee that means you can't lose the ${SPRINT.price} unless you simply
          don't show up.
        </p>
        <p><b>One option costs you another month. The other costs less than lunch for two.</b></p>

        <Link className="sf__cta" to={orderHref}>YES! Save My Seat For ${SPRINT.price} →</Link>
        <p className="sf__cta-note">
          Live-By-Friday guarantee · {SPRINT.seatsLabel} max · Starts {SPRINT.startLabel}
        </p>
      </main>

      <div className="sf__sticky">
        <span>The 5-Day Build Sprint · starts {SPRINT.startLabel}</span>
        <Link to={orderHref}>Join for ${SPRINT.price} →</Link>
      </div>

      <footer className="sf__foot">
        <div className="sf__wrap">
          © {new Date().getFullYear()} Automated Client Acquisition ·{" "}
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
          <br />
          Results shown are from real members but are not typical or guaranteed - they depend on your
          offer, market, and effort.
        </div>
      </footer>
    </div>
  );
}
