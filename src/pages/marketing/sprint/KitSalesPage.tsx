import { Link } from "react-router-dom";
import { CountStat } from "@/components/marketing/CountStat";
import { KIT } from "./sprintConfig";
import "@/styles/aca-home.css";
import "@/styles/sprint-funnel.css";
import "@/styles/marketing-specialized.css";

// testimonial.to "Wall of Love" v2 embed, verbatim per their snippet - the v2
// widget scrolls its own content internally at the fixed height (no
// iframeResizer; that's a v1 mechanism and only produces console warnings here).
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

// The $27 front end (/kit) - Kern Educational Offer copy in the cinematic ACA
// design system: dark hero with a floating leads-batch mockup + proof chips,
// numbered section bands alternating bone/paper/dark, an animated stat band,
// a connected pipeline for the Sample Batch Method, component/bonus cards, a
// dark "engine" band holding the Hermes proof screenshots, and a red final
// CTA band. One agent, pre-picked (Local Leads) - zero choices before the
// order form. Continuity (30 days included, renews $67/mo) disclosed 2× here
// plus on the order form and welcome page.
export default function KitSalesPage() {
  const orderHref = "/kit/order";

  return (
    <div className="sf sf--has-sticky">
      <div className="sf__bar">
        Instant access · Your first agent <b>running today</b> · No code, no experience
      </div>

      {/* ================= HERO ================= */}
      <header className="sf__hero">
        <div className="sf__wrap--wide">
          <nav className="sf__nav">
            <span className="sf__brand">ACA<b>.</b></span>
            <span className="sf__navnote">Works for B2B &amp; B2C · no code</span>
          </nav>

          <div className="sf__hero-inner">
            <span className="sf__eyebrow"><i />For people ready to use and sell AI agents</span>
            <h1 className="sf__h1">
              How to launch an AI agent that makes you money<em> today.</em>
            </h1>
            <p className="sf__sub">
              Even if you can't code and nobody knows your name. The 2-minute demo below shows a
              real run: the agent pulls local businesses from Google Maps and finds the{" "}
              <b>owners' email addresses automatically</b>.
            </p>

            {/* Mini VSL: the real run, voiced + captioned */}
            <div className="sf__vsl">
              <div className="sf__panel-glow" aria-hidden="true" />
              <div className="sf__chip sf__chip--a" aria-hidden="true">
                <b>$30-150</b><span>what one lead sells for</span>
              </div>
              <div className="sf__chip sf__chip--b" aria-hidden="true">
                <b>210k ★</b><span>the runtime it runs on</span>
              </div>
              <video
                className="sf__vsl-video"
                src="/kit/kit-demo.mp4"
                poster="/kit/kit-demo-poster.jpg"
                controls
                playsInline
                preload="metadata"
              />
            </div>

            <Link className="sf__cta" to={orderHref}>YES! Give Me My Money Agent - ${KIT.price} →</Link>
            <p className="sf__cta-note">Instant access · 30-day keep-everything guarantee · Cancel anytime</p>
          </div>
        </div>
      </header>

      {/* ================= LETTER INTRO (open loops + empathy) ================= */}
      <main>
        <section className="sf__sec">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <p>
              <b>Somewhere in your town, right now, a roofer is paying $4,000 a month for ads. He'd
              gladly hand $100 to anyone who brought him one good customer instead.</b>
            </p>
            <p>Hold that thought, because it's about to pay for itself.</p>
            <p>
              If you want a real income stream from AI instead of another folder of saved tutorials…
              or maybe you want something running on the side that doesn't need an audience, a
              personal brand, or a single dancing TikTok… or perhaps you've watched people with half
              your work ethic post their "AI agency" wins and thought{" "}
              <i>how are THEY pulling this off?</i>…
            </p>
            <p>
              Maybe you're a freelancer who's tired of trading hours for money. Maybe you run a
              business and want a machine that feeds it customers. Maybe you've been circling the
              idea of <b>selling AI agents and their output to clients</b>: an actual AI agent
              business. But nobody would show you the first rung of the ladder. Or maybe you just want to
              sit down at your laptop tonight and have something you built <i>actually produce
              something valuable</i> for the first time.
            </p>
            <p>
              Then this is going to be the most important page you read this year, because you're
              about to discover the REAL way people make money with AI agents: <b>without learning
              to code, without buying a $997 course, and without an audience of any kind.</b>
            </p>
            <p>
              My name is Cedric, and I built what you're about to see because I got burned by the
              other way first.
            </p>
            <p>
              I know what it's like to watch the "AI money" wave from the outside: curious, a little
              skeptical, and quietly worried you're missing the one train you shouldn't miss. I know
              the feeling of buying the course you never finish, of following the YouTube build that
              breaks at step 3, of wondering if this whole thing only works for developers and people
              with 50,000 followers.
            </p>
            <p>
              And I know the worst feeling of all: being <i>smart enough</i> to do this, but stuck at
              the starting line because nobody would just hand you something that works.
            </p>
            <p>So that's exactly what I'm going to do. But first, let me save you three months.</p>
          </div>
        </section>

        {/* ================= 01 · THE ONE IDEA (paper) ================= */}
        <section className="sf__sec sf__sec--paper">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>01</b>The one idea that changes everything</div>
            <h2>Nobody buys AI. <em>They buy what it produces.</em></h2>
            <p>
              See, the most common thing that stops normal people from making money with AI is the
              belief that <b>you have to master the technology before you've earned the right to
              charge for it</b>. The code, the prompts, the "automations," all of it. And as you're
              about to see, that's just not true. In fact, it's backwards.
            </p>
            <p>
              Go back to that roofer. He doesn't know what an "agent" is. He doesn't care. But he
              knows exactly what a <b>customer</b> is worth: a single roof replacement is
              $8,000-15,000 of revenue. That's why local businesses happily pay $30-150 for one
              qualified lead, every day, all over the world. Plumbers, dentists, landscapers, gyms,
              med spas. It's already a multi-billion-dollar habit. You're not inventing a market.
              You're walking into one that's been paying for a hundred years.
            </p>
            <p>
              Now here's the unlock: <span className="sf__mark">a lead is just information: a
              business that needs customers, plus a real way to reach the owner.</span> And gathering
              information is the single thing AI agents are best at on planet Earth.
            </p>
            <p>
              So while everyone else is stuck in week 6 of an automations course, the people quietly
              making money skipped the whole debate. They run ONE agent that produces the oldest
              product in the world: customers. And they sell it to people who already budget for
              it.
            </p>
            <p>
              No audience needed, because you're not selling to consumers. You're selling to
              businesses who buy this every month. No tech skills needed, because the agent does the
              technical part. No credibility needed, because the product proves itself.
            </p>
          </div>
        </section>

        {/* ================= STAT BAND (dark, animated) ================= */}
        <section className="sf__sec sf__sec--dark">
          <div className="sf__wrap--wide">
            <div className="sf__statband-grid">
              <CountStat target={150} suffix="" label="Dollars businesses pay per qualified lead (top niches)" />
              <CountStat target={210} suffix="k" label="GitHub stars on the runtime your agent runs on" />
              <CountStat target={127} suffix="+" label="Founders & agencies running these agents inside" />
            </div>
          </div>
        </section>

        {/* ================= 02 · THE MONEY MOTION (bone) ================= */}
        <section className="sf__sec">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>02</b>The money motion: steal this even if you never buy</div>
            <h2>The <em>Sample Batch Method</em>, in three moves</h2>

            <div className="sf__pipe">
              <div className="sf__pipe-step">
                <span className="sf__pipe-node">1</span>
                <h3>Produce a small batch of real leads</h3>
                <p>
                  Pick one trade in one city: "roofers in Austin," "dentists in Lyon." Pull the
                  local businesses, find each owner's real email, verify it. This is the part my
                  agent does while you make coffee.
                </p>
              </div>
              <div className="sf__pipe-step">
                <span className="sf__pipe-node">2</span>
                <h3>Give the first ones away</h3>
                <p>
                  Offer 10 free leads to five businesses in that niche. Free samples close what
                  pitches can't: you're handing them their next customer and letting the product do
                  the talking. It only takes one who bites.
                </p>
              </div>
              <div className="sf__pipe-step">
                <span className="sf__pipe-node">3</span>
                <h3>Convert the bite into an order</h3>
                <p>
                  One appointment from your free batch, and the next conversation writes itself:
                  "Want 50 more every month?" You're not a stranger anymore. You're the person whose
                  leads made them money.
                </p>
              </div>
            </div>

            <p>
              Read those three steps again. Notice what's <i>missing</i>: no website, no ads, no
              followers, no cold-calling skills, no certification. The entire business is "produce a
              valuable thing, hand over a sample, take orders."
            </p>

            <h3>The receipts from the run you watched at the top</h3>
            <p>
              That video was a real run: the exact agent in your Kit, one command, 50 Texas roofers,
              <b> 25 sellable leads in 3 minutes 19 seconds</b>. Here's the raw output file:
            </p>
            <img
              className="sf__shot"
              src="/kit/proof-batch.png"
              alt="The raw output file of the real batch run: 28 Texas roofing businesses with owner emails found on their sites, junk rows dropped"
              decoding="async"
            />
            <p className="sf__shot-cap">the actual output file · emails masked · the misses are in there too. That's what real looks like.</p>

            <h3>The two details that separate the paid from the ignored</h3>
            <p>
              <b>Detail #1: verified beats big.</b> A list of 500 scraped "info@" addresses is
              worthless. Half bounce, and bouncing torches your ability to land in any inbox at all.
              A list of 30 leads with the <i>owner's</i> verified email is money. Whoever you sell to
              will judge you on the first batch, so quality is the whole game. (This is exactly why
              my agent verifies every address before it ever reaches your list.)
            </p>
            <p>
              <b>Detail #2: sell the gap, not the list.</b> Don't say "I have leads." Say something
              only the data could tell you: <i>"You're the best-rated roofer in town but you sit
              below three shops with worse reviews - want the customers they're catching?"</i> One
              specific, true sentence out-sells a hundred generic pitches. The data hands you that
              sentence.
            </p>
            <p>
              If the free content on this page is already more useful than the last course you paid
              for… you can imagine what the finished system is like. Which brings me to it.
            </p>
          </div>
        </section>

        {/* ================= 03 · WHAT'S INSIDE (paper) ================= */}
        <section className="sf__sec sf__sec--paper">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>03</b>What's inside</div>
            <h2>Introducing: <em>The Money Agent Kit</em></h2>
            <img
              className="sf__shot"
              src="/kit/kit-bundle.jpg"
              alt="The Money Agent Kit bundle: the agent, the First Dollar Playbook, the 30-Minute Launch Walkthrough, both bonuses, and 30 days of ACA Xtreme"
              decoding="async"
            />
            <p>
              <b>If you're serious about getting your first money-making agent running (like,
              tonight-serious), you're going to love this.</b> The Kit is everything above, finished
              and handed to you. Not instructions for building an agent. <b>The agent.</b> Not
              theory about the Sample Batch Method. The playbook with every script. Not "good luck
              with the tech." A copy-paste walkthrough that has it running in about 30 minutes.
            </p>
            <p>
              And understand what you're actually buying, because it isn't software: <b>it's the
              first rung of an AI agent business.</b> The agent is your inventory. Its output is your
              product. The playbook is your sales motion. People who get this run agents for
              themselves, sell the output to clients. And, once they're inside, add agent after
              agent until "I use AI" becomes "I sell AI." That's the opportunity, and it starts at
              rung one, tonight, for ${KIT.price}.
            </p>
            <p>
              Imagine sitting down after dinner tonight, pasting your way through the walkthrough,
              and watching an AI agent of your own pull its first batch of real local businesses
              with the owner's verified email attached to each one. Imagine opening the playbook to
              the exact message that offers your first free sample. Imagine the notification when the
              first business owner writes back. That's not a someday fantasy. That's a Tuesday with
              the right tools.
            </p>

            <div className="sf__comp">
              <div className="sf__comp-tag">Component #1 · value $297</div>
              <h3>The Local Leads Agent - finished and yours</h3>
              <p>
                The same agent running inside our community every day, delivered ready to install.
                Point it at any niche in any city, and it pulls the businesses, hunts down the
                owner's real email, and verifies every address before it touches your list.
              </p>
              <ul>
                <li>Why it reads the business's own website for the email instead of buying data. And why that one choice triples your reply rate.</li>
                <li>The built-in verification step that keeps your batches sellable. Skip it and Detail #1 eats you alive.</li>
                <li>How it grabs each business's rating and review count: the raw material for that magic "sell the gap" sentence.</li>
                <li>The niche-plus-city targeting trick that keeps every batch fresh instead of scraping what everyone else scrapes.</li>
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
                <li>The one setting that decides whether your first batch takes 10 minutes or all afternoon.</li>
                <li>How to run your first pull for a niche+city and read the results like a pro.</li>
                <li>What "good" looks like: the quality checklist your batch must pass before you ever offer it to anyone.</li>
              </ul>
            </div>

            <div className="sf__comp">
              <div className="sf__comp-tag">Component #3 · value $147</div>
              <h3>The First Dollar Playbook</h3>
              <p>
                The Sample Batch Method, weaponized. Everything between "my agent produced leads" and
                "a business just paid me": scripted, priced, and sequenced. You'll discover:
              </p>
              <ul>
                <li>The word-for-word first message to a business owner. It's 4 sentences, and it never mentions AI.</li>
                <li>Why offering 10 free leads out-converts every discount you could invent.</li>
                <li>The follow-up that revives owners who ignored the first message. Without a whiff of desperation.</li>
                <li>How to turn one happy sample into a recurring monthly order. This is where it becomes income, not a gig.</li>
                <li>The B2B pivot: how the exact same motion sells to agencies and consultants, not just local shops.</li>
                <li>What to say when they ask "where do these leads come from?" The honest answer that makes you MORE credible.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ================= 04 · THE ENGINE (dark, Hermes proof) ================= */}
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

        {/* ================= 05 · THE DEAL (bone) ================= */}
        <section className="sf__sec">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>05</b>The deal</div>
            <h2>Let's talk about what this <em>should</em> cost</h2>
            <p>
              A single "AI agency" course - the kind that teaches you to maybe build something like
              this yourself, eventually - runs $497 to $997. The data tools that sell leads-adjacent
              information charge $99 to $250 <i>a month</i>, forever. Hiring a developer to build you
              a custom scraping-and-verification agent? A couple thousand dollars, easily, and you'd
              still need someone to tell you how to sell the output.
            </p>

            <div className="sf__mathcard" aria-label="Cost comparison">
              <h3>The ways to get a lead machine</h3>
              <div className="mrow">
                <span className="n">An "AI agency" course<small>then you still build it all yourself</small></span>
                <span className="p">$497-997</span>
              </div>
              <div className="mrow">
                <span className="n">Lead-data tools<small>every month, forever</small></span>
                <span className="p">$99-250/mo</span>
              </div>
              <div className="mrow">
                <span className="n">A developer builds you one<small>and nobody teaches you to sell the output</small></span>
                <span className="p">$2,000+</span>
              </div>
              <div className="mrow win">
                <span className="n">The Money Agent Kit - finished agent + playbook<small>one-time · 30 days of ACA Xtreme included</small></span>
                <span className="p">${KIT.price}</span>
              </div>
            </div>
            <p>
              Or forget the alternatives and just look at the math of the thing itself: leads sell
              for $30-150 each. One modest batch sold to one local business can return this entire
              Kit many times over. That's the whole point of a front-end product like this - it's
              designed to be the easiest yes of your year.
            </p>

            <div className="sf__proof">
              And these aren't prototypes. This exact agent and its eight siblings run every day
              inside a community of <b>127+ founders and agencies</b>. One 3-person agency's setter
              booked <b>11 sales calls in its first two weeks</b>. The Local Leads Agent in your Kit
              comes from the same production library, not a tutorial.
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
                <h3>The Niche Heat List - <span className="v">$47 value, free today</span></h3>
                <p>
                  The 27 local niches where leads sell easiest right now - ranked by what they pay,
                  how starved they are, and how fast they say yes. Including the three niches
                  beginners should never start with (they burn everyone), and the unglamorous trade
                  that quietly out-pays roofing in most cities.
                </p>
              </div>
            </div>
            <div className="sf__bonus">
              <span className="sf__bonus-n">Bonus 2</span>
              <div>
                <h3>The Lead Pricing Cheat Sheet - <span className="v">$37 value, free today</span></h3>
                <p>
                  Exactly what to charge - per lead, per batch, per month - by niche and city size, so
                  you never freeze when a business owner asks "how much?" Plus the pricing mistake
                  that makes buyers instantly suspicious of your leads (it's not charging too much).
                </p>
              </div>
            </div>
            <div className="sf__bonus">
              <span className="sf__bonus-n">Bonus 3</span>
              <div>
                <h3>30 days inside ACA Xtreme - <span className="v">$67 value, included</span></h3>
                <p>
                  The platform your agent plugs into (deliverability, unified inbox, CRM) plus the
                  room where 127+ people are building AI agent businesses - founders, freelancers,
                  agencies - with weekly live build calls. The "never stuck at step 3 alone"
                  insurance. After your 30 days it's ${KIT.renewalPrice}/month, cancel anytime in
                  one click.
                </p>
              </div>
            </div>

            {/* ---- The stack ---- */}
            <div className="sf__stack">
              <h3>Everything you get today</h3>
              <div className="sf__stack-row"><span>✅ <b>The Local Leads Agent:</b> finished, installed in ~30 min, produces verified leads on demand</span><span className="v">$297</span></div>
              <div className="sf__stack-row"><span>✅ <b>The 30-Minute Launch Walkthrough:</b> copy-paste install, zero code</span><span className="v">$47</span></div>
              <div className="sf__stack-row"><span>✅ <b>The First Dollar Playbook:</b> the Sample Batch Method, scripted end to end</span><span className="v">$147</span></div>
              <div className="sf__stack-row"><span>✅ <b>Bonus: The Niche Heat List:</b> 27 niches ranked by how fast they pay</span><span className="v">$47</span></div>
              <div className="sf__stack-row"><span>✅ <b>Bonus: The Lead Pricing Cheat Sheet:</b> what to charge, by niche and batch</span><span className="v">$37</span></div>
              <div className="sf__stack-row"><span>✅ <b>Bonus: 30 days of ACA Xtreme:</b> platform + weekly live builds + the room</span><span className="v">$67</span></div>
              <div className="sf__stack-total">
                <span className="was">Total value: $642</span>
                <span className="now">Today: ${KIT.price}</span>
              </div>
            </div>

            {/* ---- Price reveal ---- */}
            <p>
              So here's the moment of truth. Everything above is honestly worth $642. And if all it
              did was land you ONE paying business, it would be worth ten times that.
            </p>
            <p>But you're not paying $642.</p>
            <p>
              You're not paying $297, which is what the agent alone is worth. You're not even paying
              $97, which is what I'll likely charge once the launch period ends.
            </p>
            <p>
              <b>Today, on this page, you get the entire Money Agent Kit for ${KIT.price}.</b> Less
              than dinner. Less than the course you didn't finish. Roughly the price of ONE lead -
              for the machine that makes them.
            </p>
            <p>
              Why so cheap? No mystery: some of you will love working with us, stay in the community,
              and grow from there. The ${KIT.price} just filters for people who'll actually show up.
              That's the whole "catch."
            </p>

            <Link className="sf__cta" to={orderHref}>YES! Give Me My Money Agent - ${KIT.price} →</Link>
            <p className="sf__cta-note">Instant access · running today</p>

            {/* ---- Guarantee ---- */}
            <div className="sf__guarantee">
              <h3>The 30-Day "Keep Everything" Guarantee</h3>
              <p>
                Install the agent. Run a batch. Open the playbook. If you don't think this was worth
                ten times the ${KIT.price}, email one word: "refund". Any time in 30 days, and
                every cent comes back. <b>Keep the agent. Keep the playbook. Keep both bonuses.</b>{" "}
                No forms, no phone call, no "let me offer you a discount instead."
              </p>
              <p>
                Worst case: you get a working AI agent and a lead-selling playbook for free. Best
                case: somewhere in your town, a business owner is about to start paying you monthly
                for something a machine produces while you sleep. <b>This decision is easy.</b>
              </p>
            </div>

            {/* ---- Scarcity ---- */}
            <div className="sf__urgency">
              <b>Fair warning about the price:</b> ${KIT.price} is the launch price, and it exists to
              build our first wave of case studies. When we have them, it goes up. And the bonuses
              come off the table first. There's no fake countdown clock on this page, but there's
              also no version of this that gets cheaper by waiting. Every week you wait is also a
              week the businesses in your town keep buying leads from someone else.
            </div>

            {/* ---- Recap ---- */}
            <h2>Let's put it all on one screen</h2>
            <p>
              For ${KIT.price} - one-time, today - you get the finished Local Leads Agent ($297),
              the 30-Minute Launch Walkthrough ($47), the First Dollar Playbook ($147), the Niche
              Heat List ($47), the Lead Pricing Cheat Sheet ($37), and 30 days inside ACA Xtreme
              ($67). That's $642 of tools and playbooks for the price of a pizza - protected by a
              30-day guarantee where you keep everything even if you refund.
            </p>
            <p>
              The alternatives are a $997 course that leaves you building alone, $99+/month data
              tools that don't teach you to sell, or another year of watching other people post
              their wins. You've seen the method. You know the market's real - it was paying for
              leads before you were born. The only variable left is whether <i>your</i> agent exists
              by tonight.
            </p>

            {/* ---- Renewal disclosure ---- */}
            <div className="sf__disclose">
              <b>The straight answer on billing:</b> ${KIT.price} once today. Your Kit includes 30
              days of ACA Xtreme. After 30 days it renews at <b>${KIT.renewalPrice}/month</b> unless
              you cancel: one click, anytime, even day 29. Cancel and you still keep the agent, the
              playbook, and the bonuses.
            </div>

            {/* ---- FAQ ---- */}
            <h2>Fair questions, straight answers</h2>
            <div className="sf__faq">
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
                  most-used open-source agent. That's a feature, not a footnote: your agent runs on
                  your own machine with your own keys. There's no per-seat software renting the agent
                  back to you, and nobody can cap it or shut it off. The walkthrough installs Hermes
                  for you (it's one command). Every agent in our library, including the two you
                  can add at checkout, installs into it the same way.
                </p>
              </details>
              <details>
                <summary>I have no audience, no business, no experience. Really?</summary>
                <p>
                  Really - that's why this specific agent is the one in the Kit. Local business
                  owners don't check your follower count. They check whether the leads are real. Your
                  sample batch is your entire résumé.
                </p>
              </details>
              <details>
                <summary>How fast can I realistically make money?</summary>
                <p>
                  Your agent can be running today and produce a sellable batch this week. How fast
                  that becomes revenue depends on you actually sending the playbook's messages. We
                  won't promise you an income - anyone who does is lying. We promise a working agent,
                  the exact playbook, and a room full of people who'll help.
                </p>
              </details>
              <details>
                <summary>What if I'd rather book sales calls or run content instead of selling leads?</summary>
                <p>
                  Those agents exist - the AI Setter (books calls from LinkedIn) and the Content
                  Factory (turns a link into posted carousels) - and you can add both to your order
                  at checkout for ${KIT.bumps.all3.price}. We start everyone on Local Leads because
                  it's the only path that needs zero audience to produce something sellable this
                  week.
                </p>
              </details>
              <details>
                <summary>What is ACA Xtreme, exactly?</summary>
                <p>
                  Our platform + community. The platform handles the plumbing an agent needs
                  (deliverability, unified inbox, CRM); the community is 127+ founders and agencies
                  with weekly live build calls. First 30 days are in your Kit; then $
                  {KIT.renewalPrice}/month, cancel anytime in one click.
                </p>
              </details>
              <details>
                <summary>What if it doesn't work for me?</summary>
                <p>30 days, full refund, keep everything. One email, zero questions.</p>
              </details>
            </div>
          </div>
        </section>

        {/* ================= FINAL CTA (red) ================= */}
        <section className="sf__final">
          <div className="sf__wrap">
            <h2>You're one agent away from <em>this being real.</em></h2>
            <p>
              Every AI agent business started exactly where you are: zero agents running, zero
              clients. The difference is one working agent and one offer made. The Kit hands you both
              for less than a pizza.
            </p>
            <p>
              <b>Tonight you can either watch another AI video or have an agent of your own out
              there producing something people pay for.</b>
            </p>
            <Link className="sf__cta" to={orderHref}>YES! Give Me My Money Agent - ${KIT.price} →</Link>
            <p className="sf__cta-note">Instant access · 30-day keep-everything guarantee</p>
          </div>
        </section>
      </main>

      <div className="sf__sticky">
        <span>The Money Agent Kit · running today</span>
        <Link to={orderHref}>Get it for ${KIT.price} →</Link>
      </div>

      <footer className="sf__foot">
        <div className="sf__wrap">
          © {new Date().getFullYear()} Automated Client Acquisition ·{" "}
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
          <br />
          Dollar figures describe what businesses commonly pay for leads and related services. Not a
          promise of what you'll earn. Results require real effort and vary.
        </div>
      </footer>
    </div>
  );
}
