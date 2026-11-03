import { SIGNALS_SKOOL_URL } from "@/lib/signals";

// Section B: reframes the public feed as the "firehose" and teaches that you
// can define your own trigger in plain English, which the Hermes agent turns
// into a live, daily-refreshing signal. CTA routes to the Skool community.
export function SignalsCustomBuild() {
  return (
    <section className="section--tight signals-custom">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">Go beyond the public feed</span>
          <h2 className="h-section">
            The feed is the firehose. Build the <em>exact</em> signal your offer needs.
          </h2>
          <p className="lead">
            Describe your trigger in plain English. The Hermes agent wires it into a live, daily-refreshing
            signal scoped to your ICP - no scrapers, no spreadsheets, no maintenance.
          </p>
        </header>

        <div className="signals-custom__flow">
          <div className="signals-custom__step">
            <span className="signals-custom__num">1</span>
            <div className="signals-custom__body">
              <h3>You say it plainly</h3>
              <p className="signals-custom__quote">
                "Fintechs in the UK that hired a VP of Sales <em>and</em> raised a Series B in the last 30 days."
              </p>
            </div>
          </div>

          <span className="signals-custom__arrow" aria-hidden="true">↓</span>

          <div className="signals-custom__step signals-custom__step--accent">
            <span className="signals-custom__num signals-custom__num--hermes">H</span>
            <div className="signals-custom__body">
              <h3>Hermes wires the signal</h3>
              <p>
                Picks the sources, sets the filters, dedupes the noise, and schedules a daily run -
                built for you, watching from now on.
              </p>
            </div>
          </div>

          <span className="signals-custom__arrow" aria-hidden="true">↓</span>

          <div className="signals-custom__step">
            <span className="signals-custom__num">2</span>
            <div className="signals-custom__body">
              <h3>It runs daily, into your campaigns</h3>
              <p>
                Matching companies and their decision-makers flow straight into outreach - written around
                the trigger, sent from warmed inboxes, every morning.
              </p>
            </div>
          </div>
        </div>

        <div className="signals-custom__offer">
          <span className="kicker">Inside ACA Xtreme</span>
          <h3 className="signals-custom__offer-title">
            You don't have to build it <em>alone</em>.
          </h3>
          <p className="signals-custom__offer-sub">
            ACA Xtreme is where operators build and run custom signals with Hermes - the prompts, the
            templates, and the room that helps you ship yours.
          </p>
          <ul className="signals-custom__gets">
            <li>
              <span className="signals-custom__check" aria-hidden="true">✓</span>
              <span><strong>The Hermes prompt library</strong> - copy-paste prompts for funding, hiring, exec-change, and tech-stack triggers.</span>
            </li>
            <li>
              <span className="signals-custom__check" aria-hidden="true">✓</span>
              <span><strong>Plug-and-play signal templates</strong> you can wire up and ship the same day.</span>
            </li>
            <li>
              <span className="signals-custom__check" aria-hidden="true">✓</span>
              <span><strong>Build workshops &amp; recordings</strong> - watch a signal go from one sentence to a daily run.</span>
            </li>
            <li>
              <span className="signals-custom__check" aria-hidden="true">✓</span>
              <span><strong>Operator feedback</strong> - post your trigger, get it wired with people who've done it.</span>
            </li>
          </ul>
          <a href={SIGNALS_SKOOL_URL} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--lg">
            See what's inside ACA Xtreme →
          </a>
          <p className="signals-custom__microcopy">Live workshops, templates, and the full Hermes playbook.</p>
        </div>
      </div>
    </section>
  );
}
