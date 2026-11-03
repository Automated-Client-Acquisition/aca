import { Link } from "react-router-dom";
import { CountStat } from "@/components/marketing/CountStat";
import { STUDIO } from "./sprintConfig";
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

// The SECOND $27 front end (/studio) - a DIFFERENT avatar than /kit's local-lead
// agencies: faceless-YouTube / content creators. Same Kern Educational Offer
// copy in the cinematic ACA design system. One agent, pre-picked (the Faceless
// Channel Agent / YouTube Automation Agent) - zero choices before the order
// form. Continuity (30 days included, renews $67/mo) disclosed 3× (here + order
// form + welcome).
export default function StudioSalesPage() {
  const orderHref = "/studio/order";

  return (
    <div className="sf sf--has-sticky">
      <div className="sf__bar">
        Instant access · Your first month of videos <b>written today</b> · No camera, no face, no code
      </div>

      {/* ================= HERO ================= */}
      <header className="sf__hero">
        <div className="sf__wrap--wide">
          <nav className="sf__nav">
            <span className="sf__brand">ACA<b>.</b></span>
            <span className="sf__navnote">Faceless · no camera · no code</span>
          </nav>

          <div className="sf__hero-inner">
            <span className="sf__eyebrow"><i />For people ready to use and sell AI video agents</span>
            <h1 className="sf__h1">
              How to launch an AI agent that fills a faceless channel<em> for you.</em>
            </h1>
            <p className="sf__sub">
              Even if you've never made a video, never shown your face, and nobody knows your name.
              The 5-minute demo below shows a real run: point the agent at one niche and it{" "}
              <b>researches the topics, writes a whole month of scripts, and hands you a
              publish-ready content calendar automatically.</b>
            </p>

            {/* Mini VSL: the real run, voiced + captioned */}
            <div className="sf__vsl">
              <div className="sf__panel-glow" aria-hidden="true" />
              <div className="sf__chip sf__chip--a" aria-hidden="true">
                <b>$500-2k</b><span>a month a content client pays</span>
              </div>
              <div className="sf__chip sf__chip--b" aria-hidden="true">
                <b>210k ★</b><span>the runtime it runs on</span>
              </div>
              <video
                className="sf__vsl-video"
                src="/studio/studio-demo.mp4"
                poster="/studio/studio-demo-poster.jpg"
                controls
                playsInline
                preload="metadata"
              />
            </div>

            <Link className="sf__cta" to={orderHref}>YES! Give Me My Channel Agent - ${STUDIO.price} →</Link>
            <p className="sf__cta-note">Instant access · 30-day keep-everything guarantee · Cancel anytime</p>
          </div>
        </div>
      </header>

      {/* ================= LETTER INTRO (open loops + empathy) ================= */}
      <main>
        <section className="sf__sec">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <p>
              <b>Right now, somewhere online, a faceless channel with no host, no set, and no famous
              creator is quietly pulling in more views than most people you follow. Nobody knows who
              runs it. That's the point.</b>
            </p>
            <p>Hold that thought, because it's the whole opportunity on this page.</p>
            <p>
              If you want a real income stream from AI instead of another folder of saved tutorials…
              or maybe you want something that publishes for you without you ever turning on a camera,
              picking a personal brand, or dancing for the algorithm… or perhaps you've watched
              faceless channels rack up millions of views and thought{" "}
              <i>who is even making all these videos?</i>…
            </p>
            <p>
              Maybe you're a creator who's burned out on being on camera. Maybe you run a business and
              know you <i>should</i> be posting video but never have the time. Maybe you've been
              circling the idea of <b>running content channels for other people and getting paid for
              it</b>: an actual AI content business. But nobody would show you the first rung of the
              ladder. Or maybe you just want to sit down tonight and have something you built{" "}
              <i>actually produce a video</i> for the first time.
            </p>
            <p>
              Then this is going to be the most important page you read this year, because you're
              about to discover the REAL way people make money with AI video: <b>without showing your
              face, without editing skills, and without an audience of any kind.</b>
            </p>
            <p>
              My name is Cedric, and I built what you're about to see because I got burned by the
              other way first.
            </p>
            <p>
              I know what it's like to watch the "faceless YouTube" wave from the outside: curious, a
              little skeptical, and quietly worried you're missing the one train you shouldn't miss. I
              know the feeling of buying the course you never finish, of following the build that
              breaks at step 3, of wondering if this whole thing only works for editors and people
              with 50,000 subscribers.
            </p>
            <p>
              And I know the worst feeling of all: being <i>capable enough</i> to do this, but stuck at
              the starting line because nobody would just hand you something that works.
            </p>
            <p>So that's exactly what I'm going to do. But first, let me save you three months.</p>
          </div>
        </section>

        {/* ================= 01 · THE ONE IDEA (paper) ================= */}
        <section className="sf__sec sf__sec--paper">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>01</b>The one idea that changes everything</div>
            <h2>Nobody watches a "camera." <em>They watch what it says.</em></h2>
            <p>
              See, the most common thing that stops normal people from making money with video is the
              belief that <b>you have to be on camera, or be a great editor, before you've earned the
              right to publish</b>. The face, the personality, the fancy edits, all of it. And as
              you're about to see, that's just not true. In fact, it's backwards.
            </p>
            <p>
              Think about the faceless channels you've actually watched: stoic philosophy over slow
              cinematic shots, scary stories, space facts, sleep meditations. No host. No face. Just a
              voice and a script that holds you. Those channels are watched for one reason: <b>the
              writing</b>. The script is the product. Everything else is packaging.
            </p>
            <p>
              Now here's the unlock: <span className="sf__mark">a video is just information: a topic
              people want, plus a script that keeps them watching.</span> And writing a month of
              on-topic, research-backed scripts is the single thing AI agents are best at on planet
              Earth.
            </p>
            <p>
              So while everyone else is stuck buying a mic they'll never use and re-shooting the same
              intro forty times, the people quietly making money skipped the whole debate. They run
              ONE agent that produces the thing every channel and every business is starving for:
              a steady stream of good video. And they either grow their own channels with it, or sell
              it to businesses who already budget for content.
            </p>
            <p>
              No face needed, because faceless is the format. No editing skills needed, because the
              agent writes and assembles the pieces. No audience needed, because you can sell the
              output to a business before you ever hit 100 subscribers.
            </p>
          </div>
        </section>

        {/* ================= STAT BAND (dark, animated) ================= */}
        <section className="sf__sec sf__sec--dark">
          <div className="sf__wrap--wide">
            <div className="sf__statband-grid">
              <CountStat target={2000} suffix="" label="Dollars a business pays per month for done-for-you video content (top packages)" />
              <CountStat target={210} suffix="k" label="GitHub stars on the runtime your agent runs on" />
              <CountStat target={127} suffix="+" label="Founders & agencies running these agents inside" />
            </div>
          </div>
        </section>

        {/* ================= 02 · THE MONEY MOTION (bone) ================= */}
        <section className="sf__sec">
          <div className="sf__wrap sf__letter" style={{ padding: 0 }}>
            <div className="sf__sec-tag"><b>02</b>The money motion: steal this even if you never buy</div>
            <h2>The <em>Content Sample Method</em>, in three moves</h2>

            <div className="sf__pipe">
              <div className="sf__pipe-step">
                <span className="sf__pipe-node">1</span>
                <h3>Produce a real batch of videos</h3>
                <p>
                  Pick one niche: "stoicism for men," "real estate in Miami," "a dentist's patient
                  tips." Point the agent at it and it researches the topics, writes a month of scripts,
                  and breaks the first one into scene-by-scene shots. This is the part my agent does
                  while you make coffee.
                </p>
              </div>
              <div className="sf__pipe-step">
                <span className="sf__pipe-node">2</span>
                <h3>Give the first one away</h3>
                <p>
                  Hand one finished video to a business or creator in that niche, free. A sample video
                  closes what a pitch can't: you're handing them content they can post today and
                  letting the work do the talking. It only takes one who wants more.
                </p>
              </div>
              <div className="sf__pipe-step">
                <span className="sf__pipe-node">3</span>
                <h3>Convert the bite into a retainer</h3>
                <p>
                  One "can you do this every week?" and the next conversation writes itself: "Twelve of
                  these a month?" You're not a stranger anymore. You're the person who fills their
                  channel. That's a monthly content retainer - or your own channel, growing every day.
                </p>
              </div>
            </div>

            <p>
              Read those three steps again. Notice what's <i>missing</i>: no camera, no face, no
              editing bay, no on-screen talent, no viral luck required. The entire business is "produce
              valuable videos, hand over a sample, take orders."
            </p>

            <h3>The receipts from the run you watched at the top</h3>
            <p>
              That video was a real run: the exact agent in your Kit, one command, one niche ("AI
              automation for real estate agents") -
              <b> a 30-video content calendar plus the first video scripted scene by scene, in under 3
              minutes.</b> Here's the raw output file:
            </p>
            <img
              className="sf__shot"
              src="/studio/proof-calendar.png"
              alt="The raw output file of the real run: a 30-video content calendar for the real estate AI niche, each row with title, visual style and mood, and the first video broken into eight scripted scenes"
              decoding="async"
            />
            <p className="sf__shot-cap">the actual output file · a full month of videos, ready to produce · that's what real looks like.</p>

            <h3>The two details that separate the watched from the skipped</h3>
            <p>
              <b>Detail #1: the hook is the whole game.</b> A great topic with a weak first line is
              worthless - people leave in three seconds and the algorithm buries the rest. A plain
              topic with a hook that grabs is money. Whoever you post for will judge you on retention,
              so the opening line is everything. (This is exactly why my agent writes the hook first
              and builds the script to defend it.)
            </p>
            <p>
              <b>Detail #2: sell the calendar, not the clip.</b> Don't say "I made you a video." Say
              something only a system could promise: <i>"Here's a video today, and thirty more topics
              already mapped for the next month - want me to just run it?"</i> One filled calendar
              out-sells a hundred one-off clips. The agent hands you that calendar.
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
            <h2>Introducing: <em>The Faceless Channel Kit</em></h2>
            <img
              className="sf__shot"
              src="/studio/studio-bundle.jpg"
              alt="The Faceless Channel Kit bundle: the agent, the First 1,000 Subscribers Playbook, the 30-Minute Launch Walkthrough, both bonuses, and 30 days of ACA Xtreme"
              decoding="async"
            />
            <p>
              <b>If you're serious about getting a faceless channel producing (like, tonight-serious),
              you're going to love this.</b> The Kit is everything above, finished and handed to you.
              Not instructions for building an agent. <b>The agent.</b> Not theory about the Content
              Sample Method. The playbook with every script. Not "good luck with the tech." A
              copy-paste walkthrough that has it running in about 30 minutes.
            </p>
            <p>
              And understand what you're actually buying, because it isn't software: <b>it's the first
              rung of an AI content business.</b> The agent is your inventory. Its videos are your
              product. The playbook is your sales motion. People who get this run channels for
              themselves, sell the output to clients. And, once they're inside, add agent after agent
              until "I use AI" becomes "I sell AI." That's the opportunity, and it starts at rung one,
              tonight, for ${STUDIO.price}.
            </p>
            <p>
              Imagine sitting down after dinner tonight, pasting your way through the walkthrough, and
              watching an AI agent of your own research a niche and write out a full month of videos -
              titles, hooks, and the first one broken into shots - while you sit there. Imagine opening
              the playbook to the exact message that offers your first free sample video. Imagine the
              notification when the first business writes back. That's not a someday fantasy. That's a
              Tuesday with the right tools.
            </p>

            <div className="sf__comp">
              <div className="sf__comp-tag">Component #1 · value $297</div>
              <h3>The Faceless Channel Agent - finished and yours</h3>
              <p>
                The same YouTube automation agent running inside our community every day, delivered
                ready to install. Point it at any niche, and it researches the topics, writes a month
                of scripts, and breaks each video into scene-by-scene shots ready to produce.
              </p>
              <ul>
                <li>Why it writes the hook <i>before</i> the script instead of after. And why that one choice is the difference between 4-second bounces and full watch-throughs.</li>
                <li>The research step that keeps every video on-topic and search-friendly instead of generic AI mush.</li>
                <li>How it maps a whole month of titles at once, so you're never staring at a blank calendar wondering what to post.</li>
                <li>The scene breakdown that turns a script into a shot list - image prompts, motion, and timing - the raw material for a finished faceless video.</li>
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
                <li>The one setting that decides whether your first calendar takes 3 minutes or all afternoon.</li>
                <li>How to run your first niche and read the content calendar like a producer, not a beginner.</li>
                <li>What "good" looks like: the retention checklist a script must pass before you ever publish or send it.</li>
              </ul>
            </div>

            <div className="sf__comp">
              <div className="sf__comp-tag">Component #3 · value $147</div>
              <h3>The First 1,000 Subscribers Playbook</h3>
              <p>
                The Content Sample Method, weaponized. Everything between "my agent wrote a month of
                videos" and "a business just paid me" - or "my own channel is climbing": scripted,
                priced, and sequenced. You'll discover:
              </p>
              <ul>
                <li>The word-for-word first message that offers a business a free sample video. It's 4 sentences, and it never mentions AI.</li>
                <li>Why offering one finished video out-converts every "let's hop on a call" you could send.</li>
                <li>The upload rhythm that trains the algorithm fastest on a brand-new faceless channel.</li>
                <li>How to turn one happy sample into a recurring monthly content retainer. This is where it becomes income, not a gig.</li>
                <li>The two ways to run this: your own channels for ad and affiliate revenue, or done-for-you content for businesses who'll pay every month.</li>
                <li>What to say when they ask "who actually makes these?" The honest answer that makes you MORE credible.</li>
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
              A single "faceless YouTube" course - the kind that teaches you to maybe build something
              like this yourself, eventually - runs $497 to $997. The AI writing and video tools you'd
              stitch together charge $50 to $200 <i>a month</i>, forever. Hiring a scriptwriter and an
              editor to fill one channel? Easily a couple thousand a month, and you'd still be the one
              coming up with every topic.
            </p>

            <div className="sf__mathcard" aria-label="Cost comparison">
              <h3>The ways to get a channel producing</h3>
              <div className="mrow">
                <span className="n">A "faceless YouTube" course<small>then you still build it all yourself</small></span>
                <span className="p">$497-997</span>
              </div>
              <div className="mrow">
                <span className="n">AI writing + video tool stack<small>every month, forever</small></span>
                <span className="p">$50-200/mo</span>
              </div>
              <div className="mrow">
                <span className="n">Scriptwriter + editor<small>and the topics are still on you</small></span>
                <span className="p">~$2,000/mo</span>
              </div>
              <div className="mrow win">
                <span className="n">The Faceless Channel Kit - finished agent + playbook<small>one-time · 30 days of ACA Xtreme included</small></span>
                <span className="p">${STUDIO.price}</span>
              </div>
            </div>
            <p>
              Or forget the alternatives and just look at the math of the thing itself: businesses pay
              $500-2,000 a month for done-for-you video content. One retainer from one business can
              return this entire Kit many times over, every month. That's the whole point of a
              front-end product like this - it's designed to be the easiest yes of your year.
            </p>

            <div className="sf__proof">
              And these aren't prototypes. This exact agent and its eight siblings run every day inside
              a community of <b>127+ founders and agencies</b>. One 3-person agency's setter booked
              <b> 11 sales calls in its first two weeks</b>. The Faceless Channel Agent in your Kit
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
                <h3>The Niche Goldmine List - <span className="v">$47 value, free today</span></h3>
                <p>
                  The 27 faceless niches worth starting right now - ranked by how well they pay, how
                  hungry they are for content, and how fast a video can rank. Including the three
                  niches beginners should never touch (they're saturated graveyards), and the boring
                  category that quietly out-earns the flashy ones.
                </p>
              </div>
            </div>
            <div className="sf__bonus">
              <span className="sf__bonus-n">Bonus 2</span>
              <div>
                <h3>The Hook Vault - <span className="v">$37 value, free today</span></h3>
                <p>
                  50 proven opening lines that stop the scroll in the first three seconds - the exact
                  patterns the agent draws from - so every video you produce starts strong. Plus the
                  one hook mistake that quietly tanks retention on almost every beginner channel.
                </p>
              </div>
            </div>
            <div className="sf__bonus">
              <span className="sf__bonus-n">Bonus 3</span>
              <div>
                <h3>30 days inside ACA Xtreme - <span className="v">$67 value, included</span></h3>
                <p>
                  The platform your agent plugs into (publishing, unified inbox, CRM) plus the room
                  where 127+ people are building AI agent businesses - creators, freelancers, agencies
                  - with weekly live build calls. The "never stuck at step 3 alone" insurance. After
                  your 30 days it's ${STUDIO.renewalPrice}/month, cancel anytime in one click.
                </p>
              </div>
            </div>

            {/* ---- The stack ---- */}
            <div className="sf__stack">
              <h3>Everything you get today</h3>
              <div className="sf__stack-row"><span>✅ <b>The Faceless Channel Agent:</b> finished, installed in ~30 min, writes a month of videos on demand</span><span className="v">$297</span></div>
              <div className="sf__stack-row"><span>✅ <b>The 30-Minute Launch Walkthrough:</b> copy-paste install, zero code</span><span className="v">$47</span></div>
              <div className="sf__stack-row"><span>✅ <b>The First 1,000 Subscribers Playbook:</b> the Content Sample Method, scripted end to end</span><span className="v">$147</span></div>
              <div className="sf__stack-row"><span>✅ <b>Bonus: The Niche Goldmine List:</b> 27 faceless niches ranked by how well they pay</span><span className="v">$47</span></div>
              <div className="sf__stack-row"><span>✅ <b>Bonus: The Hook Vault:</b> 50 scroll-stopping opening lines</span><span className="v">$37</span></div>
              <div className="sf__stack-row"><span>✅ <b>Bonus: 30 days of ACA Xtreme:</b> platform + weekly live builds + the room</span><span className="v">$67</span></div>
              <div className="sf__stack-total">
                <span className="was">Total value: $642</span>
                <span className="now">Today: ${STUDIO.price}</span>
              </div>
            </div>

            {/* ---- Price reveal ---- */}
            <p>
              So here's the moment of truth. Everything above is honestly worth $642. And if all it did
              was land you ONE monthly content client, it would be worth ten times that.
            </p>
            <p>But you're not paying $642.</p>
            <p>
              You're not paying $297, which is what the agent alone is worth. You're not even paying
              $97, which is what I'll likely charge once the launch period ends.
            </p>
            <p>
              <b>Today, on this page, you get the entire Faceless Channel Kit for ${STUDIO.price}.</b>{" "}
              Less than dinner. Less than the course you didn't finish. Roughly the price of ONE month
              of a writing tool - for the machine that replaces it.
            </p>
            <p>
              Why so cheap? No mystery: some of you will love working with us, stay in the community,
              and grow from there. The ${STUDIO.price} just filters for people who'll actually show up.
              That's the whole "catch."
            </p>

            <Link className="sf__cta" to={orderHref}>YES! Give Me My Channel Agent - ${STUDIO.price} →</Link>
            <p className="sf__cta-note">Instant access · producing today</p>

            {/* ---- Guarantee ---- */}
            <div className="sf__guarantee">
              <h3>The 30-Day "Keep Everything" Guarantee</h3>
              <p>
                Install the agent. Run a niche. Open the playbook. If you don't think this was worth
                ten times the ${STUDIO.price}, email one word: "refund". Any time in 30 days, and every
                cent comes back. <b>Keep the agent. Keep the playbook. Keep both bonuses.</b> No forms,
                no phone call, no "let me offer you a discount instead."
              </p>
              <p>
                Worst case: you get a working AI agent and a content-selling playbook for free. Best
                case: somewhere out there, a business is about to start paying you monthly for videos a
                machine writes while you sleep. <b>This decision is easy.</b>
              </p>
            </div>

            {/* ---- Scarcity ---- */}
            <div className="sf__urgency">
              <b>Fair warning about the price:</b> ${STUDIO.price} is the launch price, and it exists
              to build our first wave of case studies. When we have them, it goes up. And the bonuses
              come off the table first. There's no fake countdown clock on this page, but there's also
              no version of this that gets cheaper by waiting. Every week you wait is also a week a
              business in your niche keeps paying someone else to make their videos.
            </div>

            {/* ---- Recap ---- */}
            <h2>Let's put it all on one screen</h2>
            <p>
              For ${STUDIO.price} - one-time, today - you get the finished Faceless Channel Agent
              ($297), the 30-Minute Launch Walkthrough ($47), the First 1,000 Subscribers Playbook
              ($147), the Niche Goldmine List ($47), the Hook Vault ($37), and 30 days inside ACA
              Xtreme ($67). That's $642 of tools and playbooks for the price of a pizza - protected by
              a 30-day guarantee where you keep everything even if you refund.
            </p>
            <p>
              The alternatives are a $997 course that leaves you building alone, $50+/month tools that
              don't teach you to sell, or another year of watching other people's faceless channels
              blow up. You've seen the method. You know the market's real - every business on earth
              needs video and hates making it. The only variable left is whether <i>your</i> agent
              exists by tonight.
            </p>

            {/* ---- Renewal disclosure ---- */}
            <div className="sf__disclose">
              <b>The straight answer on billing:</b> ${STUDIO.price} once today. Your Kit includes 30
              days of ACA Xtreme. After 30 days it renews at <b>${STUDIO.renewalPrice}/month</b> unless
              you cancel: one click, anytime, even day 29. Cancel and you still keep the agent, the
              playbook, and the bonuses.
            </div>

            {/* ---- FAQ ---- */}
            <h2>Fair questions, straight answers</h2>
            <div className="sf__faq">
              <details>
                <summary>Do I need to be on camera, or know how to edit?</summary>
                <p>
                  No. Faceless is the whole point - the agent writes the scripts and the shot list; the
                  visuals are stock footage, AI clips, or simple motion over a voiceover. No face, no
                  editing bay, no on-screen talent.
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
                  most-used open-source agent. That's a feature, not a footnote: your agent runs on your
                  own machine with your own keys. There's no per-seat software renting the agent back to
                  you, and nobody can cap it or shut it off. The walkthrough installs Hermes for you
                  (it's one command). Every agent in our library, including the two you can add at
                  checkout, installs into it the same way.
                </p>
              </details>
              <details>
                <summary>I have no audience, no channel, no experience. Really?</summary>
                <p>
                  Really - that's why this specific agent is the one in the Kit. A business owner who
                  needs content doesn't check your subscriber count. They check whether the video is
                  good. Your first sample video is your entire résumé.
                </p>
              </details>
              <details>
                <summary>How fast can I realistically make money?</summary>
                <p>
                  Your agent can be running today and write a full month of videos this week. How fast
                  that becomes revenue depends on you actually sending the playbook's messages (or
                  publishing consistently on your own channel). We won't promise you an income - anyone
                  who does is lying. We promise a working agent, the exact playbook, and a room full of
                  people who'll help.
                </p>
              </details>
              <details>
                <summary>What if I'd rather grow my own channel than sell content to businesses?</summary>
                <p>
                  Both work, and the playbook covers both. The exact same agent that fills a client's
                  channel fills yours - the only difference is whether the ad and affiliate revenue is
                  yours or the retainer is. Most people start with one paid client to fund the keys,
                  then build their own channels on the side.
                </p>
              </details>
              <details>
                <summary>What if I want more than one content channel going?</summary>
                <p>
                  The other two content agents - the Carousel Factory (turns a link into carousels
                  posted everywhere) and the SEO Growth Agent (turns your videos into ranking blog
                  posts) - let you repurpose every script across platforms. You can add both to your
                  order at checkout for ${STUDIO.bumps.content2.price}. We start everyone on the
                  Faceless Channel Agent because it's the one that produces something sellable this
                  week with zero audience.
                </p>
              </details>
              <details>
                <summary>What is ACA Xtreme, exactly?</summary>
                <p>
                  Our platform + community. The platform handles the plumbing an agent needs
                  (publishing, unified inbox, CRM); the community is 127+ founders and agencies with
                  weekly live build calls. First 30 days are in your Kit; then ${STUDIO.renewalPrice}
                  /month, cancel anytime in one click.
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
              Every AI content business started exactly where you are: zero videos made, zero clients.
              The difference is one working agent and one sample sent. The Kit hands you both for less
              than a pizza.
            </p>
            <p>
              <b>Tonight you can either watch another faceless-channel video or have an agent of your
              own out there writing them.</b>
            </p>
            <Link className="sf__cta" to={orderHref}>YES! Give Me My Channel Agent - ${STUDIO.price} →</Link>
            <p className="sf__cta-note">Instant access · 30-day keep-everything guarantee</p>
          </div>
        </section>
      </main>

      <div className="sf__sticky">
        <span>The Faceless Channel Kit · producing today</span>
        <Link to={orderHref}>Get it for ${STUDIO.price} →</Link>
      </div>

      <footer className="sf__foot">
        <div className="sf__wrap">
          © {new Date().getFullYear()} Automated Client Acquisition ·{" "}
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
          <br />
          Dollar figures describe what businesses commonly pay for content and related services. Not a
          promise of what you'll earn. Results require real effort and vary.
        </div>
      </footer>
    </div>
  );
}
