import {
  LeadFinderMock,
  CampaignFlowMock,
  InboxMock,
  CalendarOverlapMock,
  EngagementCaptureMock,
  NotionPlanMock,
  CommentToGetMock,
} from "./mocks";

type Stage = {
  step: string;
  tag: string;
  title: string;
  emphasis: string;
  body: string[];
  bullets: string[];
  mock: JSX.Element;
  wide?: boolean;
};

const STAGES: Stage[] = [
  {
    step: "01",
    tag: "ICP + research",
    title: "Define your ICP.",
    emphasis: "Find the right accounts.",
    body: [
      "Your AI talks to you (or reads your call transcripts) and locks an ICP definition plus a positioning angle. Both modules - outbound and inbound - read from the same definition.",
      "Then it pulls every account that matches: preloaded index, 14 live signal types - hires, funding, pricing-page visits, podcast mentions, GitHub stars, tech-stack changes. One-page brief per account, scored by intent.",
    ],
    bullets: [
      "ICP + offer locked from your transcripts",
      "Preloaded index, 14 signal types",
      "One brief per account, scored by intent",
    ],
    mock: <LeadFinderMock />,
    wide: true,
  },
  {
    step: "02",
    tag: "LinkedIn + email campaign",
    title: "Run a personalized",
    emphasis: "campaign in your voice.",
    body: [
      "Your AI drafts every message in your voice - trained on your last 50 sends. Pushes each prospect into a sequence: connection note, message 1, message 2, email follow-up - all referencing real signals from the brief. Not \"saw your post.\"",
      "The orchestration layer handles the rest: SPF, DKIM, DMARC, warmup, throttling, sender rotation across unlimited LinkedIn profiles and mailboxes.",
    ],
    bullets: [
      "Voice-trained sequences, no templates",
      "Connection note → DM → email follow-up",
      "Unlimited senders + mailboxes, throttled",
    ],
    mock: <CampaignFlowMock />,
    wide: true,
  },
  {
    step: "03",
    tag: "Daily posts + engagement capture",
    title: "Almost hand-written posts shipped daily.",
    emphasis: "Every account you run.",
    body: [
      "The orchestration layer publishes social media posts tuned to your exact ICP - LinkedIn, lead magnets, long-form, comment threads - drafted in your voice from your last 50 sends. They read like you wrote them, not a vendor template. Shipped on a schedule your AI controls, across every account on your team. No per-seat tax.",
      "Then it watches who engages. Who liked, who commented, who saved, who viewed your profile after reading. Every signal captured as a warm lead with full context. The first DM references the actual post they engaged with - not a generic opener.",
      "For most B2B founders, this quietly outperforms the cold motion within 90 days.",
    ],
    bullets: [
      "Almost hand-written posts daily to every account you run",
      "Captures liked / commented / saved / profile views",
      "Warm DM references the actual post they engaged with",
    ],
    mock: <EngagementCaptureMock />,
    wide: true,
  },
  {
    step: "04",
    tag: "Comment-to-get magnet capture",
    title: "Comments come in.",
    emphasis: "Magnets go out. Same minute.",
    body: [
      "Someone comments \"send\" or \"interested\" on a post. The AI agent reads the comment, sends the magnet via DM in seconds, qualifies them in-thread, and books the meeting. Same day. Same AI. No Zapier, no manual sorting, no comment goes cold.",
      "A typical viral B2B post gets 100+ comments. The comment-to-get system delivers a magnet to every relevant one, captures the warm leads, and feeds them straight into the booking module - while you're asleep.",
    ],
    bullets: [
      'Auto-DMs the magnet on "send" / "interested" comments',
      "Qualifies in-thread, no Calendly link",
      "Books the meeting, same day",
    ],
    mock: <CommentToGetMock />,
    wide: true,
  },
  {
    step: "05",
    tag: "Reply handling",
    title: "AI agent handles",
    emphasis: "every reply.",
    body: [
      "Replies across LinkedIn DMs, email, and comment threads land in one unified inbox your AI watches.",
      "It reads the thread, picks a response strategy, drafts the reply in your voice, or escalates to you in 12 minutes if anything's ambiguous. No reply sits cold for two days.",
    ],
    bullets: [
      "Cross-channel threading: LinkedIn / email / comments",
      "Auto-reply or 12-min escalation SLA",
      "Full thread context attached on escalation",
    ],
    mock: <InboxMock />,
  },
  {
    step: "06",
    tag: "Booking",
    title: "Books the meeting",
    emphasis: "in-thread.",
    body: [
      "On a positive reply, the layer finds calendar overlap, proposes three slots, asks two qualifying questions in-thread, and holds the slot.",
      "The prospect books without ever leaving the conversation. No Calendly link. No discovery form. No friction.",
    ],
    bullets: [
      "Real calendar overlap logic",
      "Two qualifying questions in-thread",
      "Slot held while they decide",
    ],
    mock: <CalendarOverlapMock />,
  },
];

export function ProofSection() {
  return (
    <section id="proof" className="section section--proof">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">What this looks like in practice</span>
          <h2 className="h-section">
            ICP defined to meeting booked.<br />
            <em>One orchestration. Six stages<span className="dot">.</span></em>
          </h2>
          <p className="lead">
            Outbound campaigns. Daily posts on every account. Comment-to-get DMs. Replies. Booking. The whole loop runs in under five hours of real time, with maybe ten minutes of human oversight.
          </p>
        </header>

        <div className="proof__stages">
          {STAGES.map((s, i) => {
            const flip = i % 2 === 1;
            return (
              <div
                key={s.step}
                className={`proof__stage ${s.wide ? "proof__stage--wide" : ""} ${flip && !s.wide ? "proof__stage--flip" : ""}`}
              >
                <div className="proof__stage-copy">
                  <div className="proof__stage-head">
                    <span className="proof__stage-num">{s.step}</span>
                    <span className="proof__stage-tag">{s.tag}</span>
                  </div>
                  <h3 className="proof__stage-title">
                    {s.title} <em>{s.emphasis}</em>
                  </h3>
                  {s.body.map((p, pi) => (
                    <p key={pi} className="proof__stage-p">{p}</p>
                  ))}
                  <ul className="proof__stage-bullets">
                    {s.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
                <div className="proof__stage-mock">{s.mock}</div>
              </div>
            );
          })}
        </div>

        <div className="proof__plan-wrap">
          <div className="proof__plan-head">
            <span className="kicker">The orchestration, surfaced</span>
            <h3 className="proof__plan-title">
              Every prospect has a plan.<br />
              <em>Your AI writes it. The orchestration runs it<span className="dot">.</span></em>
            </h3>
            <p className="lead">
              You wake up to a meeting on your calendar with a qualifying brief attached. The whole loop - ICP defined to meeting booked - runs in under five hours with maybe ten minutes of human oversight.
            </p>
          </div>
          <NotionPlanMock />
        </div>

        <div className="pull-quote">
          <em>One layer. Six stages. One AI directing all of it.</em>
          <p className="pull-quote__sub">
            No copy-paste between tools. No separate "content manager." No decision about whether this lead "came from inbound or outbound." It came from the same system, with the same context, working both sides of the funnel. That's not "AI-assisted outbound." That's a full GTM motion run by your AI, on infrastructure that lets it actually work.
          </p>
        </div>
      </div>
    </section>
  );
}
