import { useId, useRef, useState, type ElementType, type ReactNode } from "react";
import {
  Activity,
  Check,
  Clock3,
  GitBranch,
  Heart,
  Instagram,
  Layers,
  Linkedin,
  Mail,
  Magnet,
  Megaphone,
  MessageCircle,
  MessageSquare,
  PenLine,
  Play,
  Plus,
  Send,
  Server,
  Sparkles,
  Users,
} from "lucide-react";
import { BrandMark } from "@/components/marketing/home/IntegrationBrands";
import "@/styles/acquisition-proof-preview.css";

export type AcquisitionProofKind =
  | "email"
  | "linkedin"
  | "infrastructure"
  | "lead-magnet"
  | "content"
  | "signals"
  | "inbox";

const views = [
  { kind: "email", label: "Email sequences", icon: Mail },
  { kind: "linkedin", label: "LinkedIn campaigns", icon: Linkedin },
  { kind: "infrastructure", label: "Microsoft 365", icon: Server },
  { kind: "lead-magnet", label: "Lead magnets", icon: Magnet },
  { kind: "content", label: "Content farming", icon: PenLine },
] as const;

// The rail mirrors the app sidebar (AppSidebar.tsx) so each mockup reads as
// a real ACA screen. `screens` maps a mockup to its page header and the rail
// item it highlights.
const rail: { key: string; icon: ElementType }[] = [
  { key: "blueprints", icon: Layers },
  { key: "automations", icon: Megaphone },
  { key: "sequences", icon: GitBranch },
  { key: "lead-magnets", icon: Magnet },
  { key: "inbox", icon: MessageSquare },
  { key: "people", icon: Users },
  { key: "signals", icon: Activity },
];

const screens: Record<
  AcquisitionProofKind,
  { label: string; title: string; crumb: string; icon: ElementType; rail: string }
> = {
  email: {
    label: "Example email sequence in ACA",
    title: "Growth audit for hiring teams",
    crumb: "Sequences",
    icon: GitBranch,
    rail: "sequences",
  },
  linkedin: {
    label: "Example LinkedIn automation in ACA",
    title: "Agency founders, LinkedIn first",
    crumb: "Automations",
    icon: Megaphone,
    rail: "automations",
  },
  infrastructure: {
    label: "Example Microsoft 365 mailbox pool in ACA",
    title: "Mailboxes",
    crumb: "Settings · Sending",
    icon: Server,
    rail: "",
  },
  "lead-magnet": {
    label: "Example lead magnet in ACA",
    title: "Acquisition checklist",
    crumb: "Lead Magnets",
    icon: Magnet,
    rail: "lead-magnets",
  },
  content: {
    label: "Example content run in ACA",
    title: "One idea, three formats",
    crumb: "Content",
    icon: Layers,
    rail: "blueprints",
  },
  signals: {
    label: "Example buyer signals in ACA",
    title: "Hiring growth teams",
    crumb: "Signals",
    icon: Activity,
    rail: "signals",
  },
  inbox: {
    label: "Example inbox with an AI reply draft in ACA",
    title: "Inbox",
    crumb: "All channels",
    icon: MessageSquare,
    rail: "inbox",
  },
};

function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "gold" | "blue" | "violet" | "coral";
}) {
  return <span className={`ap-tag ap-tag--${tone}`}>{children}</span>;
}

function Avatar({
  initials,
  photo = false,
  tone = "sand",
}: {
  initials?: string;
  photo?: boolean;
  tone?: "sand" | "sage" | "sky" | "rose";
}) {
  if (photo) {
    return (
      <img
        className="ap-avatar"
        src="/media/acquisition-world/avatars/alex-v1.webp"
        width={32}
        height={32}
        alt=""
      />
    );
  }
  return (
    <span className={`ap-avatar ap-avatar--${tone}`} aria-hidden="true">
      {initials}
    </span>
  );
}

function Variable({ children }: { children: ReactNode }) {
  return <span className="ap-var">{children}</span>;
}

function FakeButton({
  children,
  primary = false,
}: {
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <span className={`ap-btn${primary ? " ap-btn--primary" : ""}`} aria-hidden="true">
      {children}
    </span>
  );
}

function ChannelIcon({
  channel,
}: {
  channel: "linkedin" | "email" | "whatsapp" | "instagram";
}) {
  if (channel === "email") return <Mail size={13} aria-hidden="true" />;
  if (channel === "linkedin") return <Linkedin size={13} aria-hidden="true" />;
  if (channel === "instagram") return <Instagram size={13} aria-hidden="true" />;
  return <MessageCircle size={13} aria-hidden="true" />;
}

/* ---------- Screens ---------- */

function EmailScreen() {
  const steps = [
    { title: "Email 1", detail: "Day 1 · new thread", sent: "412 sent", active: true },
    { wait: "Wait 2 days" },
    { title: "Email 2", detail: "Day 3 · if no reply", sent: "287 sent" },
    { wait: "Wait 4 days" },
    { title: "Email 3", detail: "Day 7 · if no reply", sent: "Queued" },
  ];
  return (
    <div className="ap-seq">
      <div className="ap-steps">
        {steps.map((step, index) =>
          "wait" in step ? (
            <div className="ap-step-wait" key={index}>
              <Clock3 size={12} aria-hidden="true" /> {step.wait}
            </div>
          ) : (
            <div className={`ap-step${step.active ? " is-active" : ""}`} key={index}>
              <span className="ap-step-icon">
                <Mail size={14} aria-hidden="true" />
              </span>
              <span className="ap-step-text">
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </span>
              <span className="ap-step-stat">{step.sent}</span>
            </div>
          ),
        )}
      </div>
      <div className="ap-mail">
        <div className="ap-mail-row">
          <span>From</span>
          <strong>Alex Morgan</strong>
          <Tag>Rotating · 3 mailboxes</Tag>
        </div>
        <div className="ap-mail-row">
          <span>To</span>
          <strong>
            <Variable>first_name</Variable> at <Variable>company</Variable>
          </strong>
        </div>
        <div className="ap-mail-subject">
          A growth audit for <Variable>company</Variable>?
        </div>
        <div className="ap-mail-body">
          Hi <Variable>first_name</Variable>, saw <Variable>company</Variable>{" "}
          is hiring two growth marketers. Would a short audit of your funnel
          help the new team find its first wins?
        </div>
        <div className="ap-mail-foot">
          <Check size={13} aria-hidden="true" /> Stops for anyone who replies
        </div>
      </div>
    </div>
  );
}

function LinkedInScreen() {
  return (
    <div className="ap-canvas">
      <div className="ap-node ap-node--start">
        <Users size={14} aria-hidden="true" />
        <span>
          <strong>Lead list</strong>
          <span>Agency founders · 640</span>
        </span>
      </div>
      <span className="ap-edge" aria-hidden="true" />
      <div className="ap-node ap-node--linkedin">
        <span className="ap-node-chip">
          <Linkedin size={12} aria-hidden="true" /> LinkedIn
        </span>
        <strong>Connection request</strong>
        <span>With a short personal note</span>
      </div>
      <div className="ap-branch" aria-hidden="true">
        <span />
      </div>
      <div className="ap-branches">
        <div className="ap-branch-col">
          <span className="ap-branch-label ap-branch-label--yes">Accepted</span>
          <div className="ap-node ap-node--linkedin">
            <span className="ap-node-chip">
              <Linkedin size={12} aria-hidden="true" /> LinkedIn
            </span>
            <strong>Message</strong>
            <span className="ap-node-quote">
              Thanks for connecting, <Variable>first_name</Variable>…
            </span>
            <span className="ap-node-badge">
              <MessageSquare size={11} aria-hidden="true" /> 23 replies
            </span>
          </div>
        </div>
        <div className="ap-branch-col">
          <span className="ap-branch-label">Not accepted · 7 days</span>
          <div className="ap-node ap-node--email">
            <span className="ap-node-chip">
              <Mail size={12} aria-hidden="true" /> Email
            </span>
            <strong>Intro email</strong>
            <span>Same message, other channel</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfrastructureScreen() {
  const mailboxes = [
    { name: "alex", status: "Sending", tone: "green", sent: 18, cap: 25 },
    { name: "sam", status: "Sending", tone: "green", sent: 22, cap: 25 },
    { name: "jamie", status: "Sending", tone: "green", sent: 9, cap: 25 },
    { name: "lee", status: "Warming", tone: "gold", sent: 6, cap: 10 },
  ] as const;
  return (
    <div className="ap-infra">
      <div className="ap-tenant">
        <BrandMark name="Microsoft 365" surface="light" layout="symbol" showName={false} />
        <span className="ap-tenant-name">
          <strong>Growth Studio</strong>
          <span>Microsoft 365 tenant</span>
        </span>
        <span className="ap-dns">
          {["SPF", "DKIM", "DMARC"].map((record) => (
            <Tag tone="green" key={record}>
              <Check size={11} aria-hidden="true" /> {record}
            </Tag>
          ))}
        </span>
      </div>
      <div className="ap-table" role="table" aria-label="Example mailboxes">
        <div className="ap-tr ap-tr--head" role="row">
          <span role="columnheader">Mailbox</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Sent today</span>
        </div>
        {mailboxes.map((box) => (
          <div className="ap-tr" role="row" key={box.name}>
            <span role="cell" className="ap-mailbox-name">
              <Mail size={13} aria-hidden="true" />
              {box.name}@growthstudio.co
            </span>
            <span role="cell">
              <Tag tone={box.tone}>{box.status}</Tag>
            </span>
            <span role="cell" className="ap-meter">
              <span
                className={`ap-meter-bar${box.tone === "gold" ? " ap-meter-bar--gold" : ""}`}
                aria-hidden="true"
              >
                <span style={{ width: `${(box.sent / box.cap) * 100}%` }} />
              </span>
              {box.sent}/{box.cap}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadMagnetScreen() {
  return (
    <div className="ap-magnet">
      <div className="ap-post">
        <div className="ap-post-head">
          <Avatar photo />
          <span>
            <strong>Alex Morgan</strong>
            <span>Founder, Growth Studio · 2h</span>
          </span>
          <BrandMark name="LinkedIn" surface="light" layout="symbol" showName={false} />
        </div>
        <div className="ap-post-text">
          I turned our 23-point acquisition checklist into a PDF. Comment{" "}
          <strong>GUIDE</strong> and I’ll send it over.
        </div>
        <div className="ap-post-stats">
          <Heart size={12} aria-hidden="true" /> 142 · 87 comments
        </div>
        {[
          { initials: "JL", name: "Jordan Lee", tone: "sage" },
          { initials: "PN", name: "Priya Nair", tone: "sky" },
        ].map((comment) => (
          <div className="ap-comment" key={comment.name}>
            <Avatar initials={comment.initials} tone={comment.tone as "sage" | "sky"} />
            <span className="ap-comment-bubble">
              <strong>{comment.name}</strong>
              <span>GUIDE</span>
            </span>
            <Tag tone="green">
              <Send size={10} aria-hidden="true" /> DM sent
            </Tag>
          </div>
        ))}
      </div>
      <div className="ap-funnel">
        <div className="ap-funnel-head">
          <span>Keyword</span>
          <Tag tone="coral">GUIDE</Tag>
        </div>
        {[
          { label: "Comments", value: 87, width: 100 },
          { label: "DMs sent", value: 87, width: 100 },
          { label: "Emails captured", value: 52, width: 60 },
        ].map((row) => (
          <div className="ap-funnel-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <span className="ap-funnel-bar" aria-hidden="true">
              <span style={{ width: `${row.width}%` }} />
            </span>
          </div>
        ))}
        <div className="ap-funnel-next">
          <GitBranch size={13} aria-hidden="true" />
          <span>
            Then <strong>Welcome sequence</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

function ContentScreen() {
  return (
    <div className="ap-content">
      <div className="ap-content-source">
        <Sparkles size={14} aria-hidden="true" />
        <span>
          Idea: <strong>More leads won’t fix a weak offer</strong>
        </span>
        <Tag>Voice: practical</Tag>
      </div>
      <div className="ap-outputs">
        <div className="ap-out ap-out--post">
          <span className="ap-out-label">LinkedIn post</span>
          <div className="ap-out-card">
            <div className="ap-out-author">
              <Avatar photo />
              <strong>Alex Morgan</strong>
            </div>
            <span className="ap-out-text">
              More leads won’t fix a weak offer. Before you scale outreach,
              check three things: who it’s for, why now, and what changes after
              they buy.
            </span>
          </div>
        </div>
        <div className="ap-out ap-out--carousel">
          <span className="ap-out-label">Carousel</span>
          <div className="ap-slide">
            <span className="ap-slide-count">01 / 03</span>
            <strong>Make the offer specific.</strong>
            <span>Who is it for? What do they get?</span>
          </div>
        </div>
        <div className="ap-out ap-out--video">
          <span className="ap-out-label">Short video</span>
          <div className="ap-reel">
            <img src="/media/mascot/fox-wave-cut.png" alt="" width={84} height={126} loading="lazy" />
            <span className="ap-reel-caption">
              3 checks <em>before</em> you send
            </span>
            <span className="ap-reel-play" aria-hidden="true">
              <Play size={12} fill="currentColor" />
            </span>
          </div>
        </div>
      </div>
      <div className="ap-content-foot">
        <span>3 drafts ready for review</span>
        <FakeButton primary>Schedule</FakeButton>
      </div>
    </div>
  );
}

function SignalsScreen() {
  const rows = [
    {
      initials: "JL",
      tone: "sage",
      name: "Jordan Lee",
      role: "Head of Growth · Northstar",
      signal: "Hiring 2 growth marketers",
      kind: "Hiring",
      score: 92,
      added: true,
    },
    {
      initials: "MC",
      tone: "rose",
      name: "Maya Chen",
      role: "VP Marketing · Brightloop",
      signal: "Raised a Series A",
      kind: "Funding",
      score: 88,
    },
    {
      initials: "SO",
      tone: "sky",
      name: "Sam Ortiz",
      role: "Founder · Fieldwork",
      signal: "Commented on a competitor’s post",
      kind: "Engagement",
      score: 81,
    },
  ] as const;
  return (
    <div className="ap-signals">
      <div className="ap-filters" aria-label="Example filters">
        <Tag>Industry: SaaS</Tag>
        <Tag>Role: Head of Growth</Tag>
        <Tag>Signal: any</Tag>
      </div>
      <div className="ap-signal-list">
        {rows.map((row) => (
          <div className="ap-signal" key={row.name}>
            <Avatar initials={row.initials} tone={row.tone} />
            <span className="ap-signal-who">
              <strong>{row.name}</strong>
              <span>{row.role}</span>
            </span>
            <span className="ap-signal-what">
              <Tag tone={row.kind === "Hiring" ? "blue" : row.kind === "Funding" ? "green" : "violet"}>
                {row.kind}
              </Tag>
              <span>{row.signal}</span>
            </span>
            <span className="ap-signal-score">
              {row.score}
              <small>fit</small>
            </span>
            {"added" in row ? (
              <Tag tone="green">
                <Check size={11} aria-hidden="true" /> Added
              </Tag>
            ) : (
              <FakeButton>
                <Plus size={12} /> Add
              </FakeButton>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function InboxScreen() {
  const threads = [
    { initials: "JL", tone: "sage", name: "Jordan Lee", text: "Yes, what would you look at first?", channel: "email", active: true },
    { initials: "PN", tone: "sky", name: "Priya Nair", text: "Thanks for the guide! Quick question…", channel: "linkedin" },
    { initials: "MC", tone: "rose", name: "Maya Chen", text: "Can we talk Thursday?", channel: "whatsapp" },
    { initials: "TB", tone: "sand", name: "Tom Becker", text: "Sounds good, send the link", channel: "instagram" },
  ] as const;
  return (
    <div className="ap-inbox">
      <div className="ap-threads">
        {threads.map((thread) => (
          <div className={`ap-thread${"active" in thread ? " is-active" : ""}`} key={thread.name}>
            <Avatar initials={thread.initials} tone={thread.tone} />
            <span className="ap-thread-text">
              <strong>{thread.name}</strong>
              <span>{thread.text}</span>
            </span>
            <span className={`ap-thread-channel ap-thread-channel--${thread.channel}`}>
              <ChannelIcon channel={thread.channel} />
            </span>
          </div>
        ))}
      </div>
      <div className="ap-convo">
        <div className="ap-bubble">
          Yes, an acquisition audit would be useful. What would you look at
          first?
          <span>Jordan Lee · 9:42</span>
        </div>
        <div className="ap-draft">
          <span className="ap-draft-label">
            <Sparkles size={12} aria-hidden="true" /> Draft from your offer and this thread
          </span>
          <span className="ap-draft-text">
            I’d start with your offer, who it’s for and your first-touch
            messages. I can record a short walkthrough with changes. Would
            Thursday work?
          </span>
          <span className="ap-draft-actions">
            <FakeButton>Edit</FakeButton>
            <FakeButton primary>
              <Send size={12} /> Send
            </FakeButton>
          </span>
        </div>
      </div>
    </div>
  );
}

function ProofBody({ kind }: { kind: AcquisitionProofKind }) {
  switch (kind) {
    case "email":
      return <EmailScreen />;
    case "linkedin":
      return <LinkedInScreen />;
    case "infrastructure":
      return <InfrastructureScreen />;
    case "lead-magnet":
      return <LeadMagnetScreen />;
    case "content":
      return <ContentScreen />;
    case "signals":
      return <SignalsScreen />;
    case "inbox":
      return <InboxScreen />;
  }
}

// ACA is headless: every screen is also a set of MCP / CLI / API tools, so
// each mockup credits the agent that did the work.
export const agentMarks = {
  claude: { name: "Claude", logo: "/logos/anthropic.svg" },
  codex: { name: "Codex", logo: "/logos/openai.svg" },
  grok: { name: "Grok", logo: "/logos/xai.svg" },
  hermes: { name: "Hermes", logo: "/logos/hermes.svg" },
  openclaw: { name: "OpenClaw", logo: "/logos/openclaw.svg" },
} as const;
type AgentKey = keyof typeof agentMarks;

const agentCredits: Record<AcquisitionProofKind, { agent: AgentKey; text: string; via: string }> = {
  email: { agent: "claude", text: "wrote this sequence from your offer", via: "MCP" },
  linkedin: { agent: "codex", text: "built this automation", via: "CLI" },
  infrastructure: { agent: "hermes", text: "checks mailbox health every hour", via: "MCP" },
  "lead-magnet": { agent: "claude", text: "set up the keyword and the DM", via: "MCP" },
  content: { agent: "grok", text: "drafted all three from one idea", via: "API" },
  signals: { agent: "openclaw", text: "adds new matches every morning", via: "CLI" },
  inbox: { agent: "claude", text: "drafted this reply for you to approve", via: "MCP" },
};

export function AgentLogo({ agent, size = 14 }: { agent: AgentKey; size?: number }) {
  return (
    <img
      className="ap-agent-logo"
      src={agentMarks[agent].logo}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}

function AgentCredit({ kind }: { kind: AcquisitionProofKind }) {
  const credit = agentCredits[kind];
  return (
    <div className="ap-credit">
      <AgentLogo agent={credit.agent} />
      <span>
        <strong>{agentMarks[credit.agent].name}</strong> {credit.text}
      </span>
      <span className="ap-credit-via">via {credit.via}</span>
    </div>
  );
}

function HeaderStatus({ kind }: { kind: AcquisitionProofKind }) {
  if (kind === "infrastructure") return <FakeButton>Add mailboxes</FakeButton>;
  if (kind === "inbox") return <Tag tone="coral">3 unread</Tag>;
  if (kind === "content") return <Tag tone="gold">Review</Tag>;
  if (kind === "signals") return <Tag>214 matches</Tag>;
  return <Tag tone="green">Active</Tag>;
}

function AppWindow({ kind }: { kind: AcquisitionProofKind }) {
  const screen = screens[kind];
  const Icon = screen.icon;
  return (
    <div className="ap-app">
      <div className="ap-rail" aria-hidden="true">
        <span className="ap-rail-logo">a.</span>
        {rail.map((item) => (
          <span
            key={item.key}
            className={`ap-rail-item${item.key === screen.rail ? " is-active" : ""}`}
          >
            <item.icon size={15} />
          </span>
        ))}
      </div>
      <div className="ap-main">
        <div className="ap-head">
          <span className="ap-head-icon" aria-hidden="true">
            <Icon size={15} />
          </span>
          <span className="ap-head-text">
            <span>{screen.crumb}</span>
            <strong>{screen.title}</strong>
          </span>
          <HeaderStatus kind={kind} />
        </div>
        <div className="ap-screen">
          <ProofBody kind={kind} />
        </div>
        <AgentCredit kind={kind} />
      </div>
    </div>
  );
}

export function AcquisitionProof({ kind }: { kind: AcquisitionProofKind }) {
  return (
    <figure className={`ap-shot ap-shot--${kind}`}>
      <div className="ap-proof" role="group" aria-label={screens[kind].label}>
        <AppWindow kind={kind} />
      </div>
      <figcaption className="ap-caption">Example workspace with sample data</figcaption>
    </figure>
  );
}

export function AcquisitionHeroProof() {
  const [active, setActive] = useState(0);
  const id = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = views[active];
  function navigate(key: string) {
    let next = active;
    if (key === "ArrowRight") next = (active + 1) % views.length;
    else if (key === "ArrowLeft")
      next = (active - 1 + views.length) % views.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = views.length - 1;
    else return false;
    setActive(next);
    tabRefs.current[next]?.focus();
    return true;
  }
  return (
    <figure className="ap-shot ap-shot--hero">
      <div
        className="ap-tabs"
        role="tablist"
        aria-label="Acquisition workflow previews"
      >
        {views.map((view, index) => (
          <button
            key={view.kind}
            type="button"
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            role="tab"
            aria-selected={index === active}
            tabIndex={index === active ? 0 : -1}
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              if (navigate(event.key)) event.preventDefault();
            }}
          >
            <view.icon size={15} aria-hidden="true" />
            <span>{view.label}</span>
          </button>
        ))}
      </div>
      <div
        className="ap-proof"
        role="tabpanel"
        id={`${id}-panel-${active}`}
        aria-labelledby={`${id}-tab-${active}`}
        tabIndex={0}
      >
        <AppWindow kind={current.kind} />
      </div>
      <figcaption className="ap-caption">Example workspace with sample data</figcaption>
    </figure>
  );
}

const agentRun = [
  { tool: "search_lead_pool", result: "50 heads of growth, SaaS, hiring" },
  { tool: "build_lead_pool_list", result: "List “SaaS hiring · Nov”" },
  { tool: "create_email_sequence", result: "3 emails, stops on reply" },
  { tool: "enroll_leads", result: "50 enrolled · starts Mon 9:00" },
];

export function AgentChatProof() {
  return (
    <figure className="ap-shot ap-shot--agent">
      <div className="ap-proof" role="group" aria-label="Example of Claude running ACA through MCP">
        <div className="ap-chat">
          <div className="ap-chat-bar" aria-hidden="true">
            {(["claude", "codex", "grok"] as const).map((agent, index) => (
              <span className={`ap-chat-client${index === 0 ? " is-active" : ""}`} key={agent}>
                <AgentLogo agent={agent} size={13} />
                {agentMarks[agent].name}
              </span>
            ))}
            <span className="ap-chat-conn">
              <span className="ap-chat-dot" /> ACA connected
            </span>
          </div>
          <div className="ap-chat-body">
            <div className="ap-chat-user">
              Find 50 heads of growth at SaaS companies that are hiring, write a
              3-email sequence about our funnel audit and start it Monday.
            </div>
            <div className="ap-chat-agent">
              <span className="ap-chat-who">
                <AgentLogo agent="claude" size={16} /> Claude
              </span>
              <div className="ap-tools">
                {agentRun.map((call) => (
                  <div className="ap-tool" key={call.tool}>
                    <Check size={12} aria-hidden="true" />
                    <code>aca · {call.tool}</code>
                    <span>{call.result}</span>
                  </div>
                ))}
              </div>
              <span className="ap-chat-reply">
                Done. 50 heads of growth are enrolled and the first emails go
                out Monday at 9:00 from your three mailboxes. Replies land in
                your ACA inbox. Want a LinkedIn follow-up for anyone who doesn’t
                reply?
              </span>
            </div>
          </div>
          <div className="ap-chat-composer" aria-hidden="true">
            <span>Reply to Claude…</span>
            <Send size={14} />
          </div>
        </div>
      </div>
      <figcaption className="ap-caption">Example conversation using ACA’s MCP tools</figcaption>
    </figure>
  );
}
