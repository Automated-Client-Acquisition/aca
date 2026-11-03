import { LiveActivityMock } from "./mocks";

export function ProblemSection() {
  return (
    <section id="problem" className="section section--problem">
      <div className="wrap problem__wrap">
        <div className="problem__copy">
          <span className="kicker">The trap</span>
          <h2 className="h-section">
            You don't have an AI problem.
            <br />
            <em>You have an infrastructure problem<span className="dot">.</span></em>
          </h2>
          <div className="body-prose">
            <p>
              Most B2B founders running outbound right now are caught in the same trap.
            </p>
            <p>
              They've spent six months learning to use Claude or ChatGPT properly. They can prompt it to write a better cold email than any SDR they've ever hired. They can get it to research a prospect, draft a sequence, draft replies, even draft objection handling - in seconds.
            </p>
            <p>
              And then they hit the wall.
            </p>
            <p>
              Because writing a good message is maybe 10% of outbound. The other 90% is infrastructure: deliverable mailboxes, LinkedIn senders that don't get banned, an enriched lead source that isn't six months stale, signal detection that catches buying intent the day it happens, calendar logic that books a meeting without sending a Calendly link, and a unified inbox that catches every reply before it goes cold.
            </p>
            <p>
              None of that is an AI problem. All of it is an infrastructure problem. And it's the reason your AI-drafted outbound sequence is sitting in a Google Doc instead of booking meetings.
            </p>
            <p>
              So you do what every founder does. You start buying tools.
            </p>
            <p className="body-prose__emph">
              You buy Smartlead for the inboxes. HeyReach for LinkedIn. Apollo for the data. Clay for the enrichment. Chili Piper for the booking. You wire them together with Make. And then you realize none of these tools talk to your AI - they each have their own mid-tier model proxying calls you're paying a 40% markup on, generating mediocre copy you have to rewrite anyway.
            </p>
            <p>
              You're now paying $7,000 a month to run worse outbound than you'd run yourself if you just had the infrastructure.
            </p>
            <p>
              <em>That's the problem. It's not that AI can't do outbound. It's that nobody's built the infrastructure for the AI to actually run on.</em>
            </p>
            <p className="body-prose__close">Until now.</p>
          </div>
        </div>
        <aside className="problem__aside" aria-hidden>
          <div className="problem__teaser-wrap">
            <LiveActivityMock />
          </div>
        </aside>
      </div>
    </section>
  );
}
