import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowDown,
  Check,
  Mail,
  Network,
  PenLine,
  Magnet,
  Server,
  UsersRound,
  CalendarDays,
  MoveUpRight,
  Menu,
  Minus,
  Plus,
  X,
  Volume2,
  VolumeX,
  Pause,
  Play,
  Globe,
} from "lucide-react";
import { ACA_GITHUB_URL } from "@/components/marketing/links";
import {
  GitHubStarBanner,
  GitHubStarsLink,
  NavDivider,
} from "@/components/marketing/GitHubStars";
import { Button } from "@/components/ui/button";
import {
  AcquisitionProof,
  AgentChatProof,
  AgentLogo,
  agentMarks,
} from "@/components/marketing/home/AcquisitionProofPreview";
import { IntegrationBrands } from "@/components/marketing/home/IntegrationBrands";
import { supabase } from "@/integrations/supabase/client";
import { normalizePreviewWebsite } from "@/lib/onboarding-preview";
import "@/styles/aca-home.css";
import "@/styles/acquisition-world.css";

const questions = [
  {
    question: "Can I see what ACA does before signing up?",
    answer:
      "Yes. Build a free preview using your website, or try a sample business. You can read, copy and download buyer ideas, an email draft and content ideas before creating an account. The preview does not send outreach or activate campaigns.",
  },
  {
    question: "Does unlimited mean unlimited sending or free AI usage?",
    answer:
      "Unlimited applies to platform seats, leads, campaigns and content. Sending accounts have daily limits and provider rules. Mailbox licences, domains, AI usage, enrichment and other provider costs are separate. You connect your own accounts and API keys.",
  },
  {
    question: "What does $67/month include?",
    answer:
      "The Operator platform subscription includes unlimited seats, leads, campaigns, and content, with all acquisition features. It does not include external provider usage: AI, enrichment, mailboxes, and other services can have their own charges and limits. See pricing for the full breakdown.",
  },
  {
    question: "Do I pay per seat or buy ACA credit packs?",
    answer:
      "No. Operator is a flat $67/month platform subscription. Add your team without a per-seat platform charge. Bring your own API keys and pay your providers for the usage you actually consume, with no ACA markup on AI tokens.",
  },
  {
    question: "What happens during the free trial?",
    answer:
      "You can try ACA for 3 days without a credit card. Set up your offer and ideal customer, explore the workspace, and connect the accounts and API providers you want to use. Provider charges may still apply when you use your own accounts. Continuing on Operator costs $67/month.",
  },
  {
    question: "What do I need to connect?",
    answer:
      "Start with the channel you want to use, such as an email or LinkedIn account. Connect your own OpenRouter key for AI, and add providers such as Replicate or ElevenLabs if your workflow needs images, video, or voice. You can add more channels and integrations as you go.",
  },
  {
    question: "Can I review messages before they go out?",
    answer:
      "AI can prepare replies for review, and autopilot settings let you define approval and escalation rules. Review your campaign, senders, audience, and automation settings before activating outreach. You choose how your workflow runs.",
  },
  {
    question: "Can I run this under my agency's brand?",
    answer:
      "Yes. The separate White-label plan is $297/month and adds client workspaces, your branding and domain, roles, and client billing. Unlimited Operator seats do not include white-label client workspaces.",
  },
];

function PreviewButton({
  children = "Build my free preview",
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Button variant="cta" size="lg" asChild className={`acq-cta ${className}`}>
      <Link to="/get-started">
        {children}
        <ArrowRight aria-hidden="true" size={17} />
      </Link>
    </Button>
  );
}

// The hero's action in its working form: the visitor types their website here and
// lands in /get-started with the preview already building (Sandbox reads it from
// router state, so the address never sits in the URL).
function HeroPreviewForm() {
  const navigate = useNavigate();
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePreviewWebsite(website);
    if (!normalized) {
      setError("Enter your business website, like yourcompany.com.");
      return;
    }
    navigate("/get-started", { state: { website: normalized } });
  }
  return (
    <form className="world-hero__form" onSubmit={submit} noValidate>
      <label htmlFor="hero-website">Your business website</label>
      <div className="world-hero__field">
        <div className="world-hero__input">
          <Globe size={18} aria-hidden="true" />
          <input
            id="hero-website"
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="yourcompany.com"
            value={website}
            onChange={(event) => {
              setWebsite(event.target.value);
              if (error) setError("");
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "hero-website-error" : "hero-website-note"}
          />
        </div>
        <Button variant="cta" size="lg" type="submit" className="acq-cta">
          Build my free preview
          <ArrowRight aria-hidden="true" size={17} />
        </Button>
      </div>
      {error ? (
        <p id="hero-website-error" className="world-hero__form-error" role="alert">
          {error}
        </p>
      ) : (
        <p id="hero-website-note" className="acq-fineprint">
          Buyer ideas, a first email and content drafts from your site. No
          account or card needed.
        </p>
      )}
    </form>
  );
}

const stackTools = [
  {
    id: "sequencer",
    icon: Mail,
    label: "Cold email sequencer",
    detail: "Sequences & follow-ups",
    example: "49",
  },
  {
    id: "linkedin",
    icon: Network,
    label: "LinkedIn automation",
    detail: "Connections & messaging",
    example: "79",
  },
  {
    id: "content",
    icon: PenLine,
    label: "Content & publishing",
    detail: "Creation, repurposing & scheduling",
    example: "39",
  },
  {
    id: "magnets",
    icon: Magnet,
    label: "Lead magnets & landing pages",
    detail: "Capture forms & lead magnet delivery",
    example: "29",
  },
  {
    id: "infra",
    icon: Server,
    label: "Email infrastructure tools",
    detail: "Mailbox management & warmup tools",
    example: "29",
  },
  {
    id: "leads",
    icon: UsersRound,
    label: "Lead sourcing & CRM",
    detail: "Prospecting & pipeline software",
    example: "49",
  },
  {
    id: "booking",
    icon: CalendarDays,
    label: "Scheduling",
    detail: "Booking & calendar software",
    example: "19",
  },
];

function SavingsCalculator() {
  const [tools, setTools] = useState(() =>
    stackTools.map((tool) => ({ ...tool, selected: true, cost: tool.example })),
  );
  const selected = tools.filter((tool) => tool.selected);
  const totalCents = selected.reduce((total, tool) => {
    const amount = Number(tool.cost);
    return (
      total +
      Math.round(
        (Number.isFinite(amount) ? Math.max(0, Math.min(100000, amount)) : 0) *
          100,
      )
    );
  }, 0);
  const differenceCents = totalCents - 6700;
  const dollars = (cents: number) =>
    (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

  return (
    <div className="acq-savings">
      <h3>What are your acquisition tools costing you?</h3>
      <p>
        Check the subscriptions you could consolidate. Enter your own monthly
        bills and compare them with ACA’s $67 platform price.
      </p>
      <p id="acq-budget-note" className="acq-savings-hint">
        Example monthly budgets shown below. Edit them to match your bills.
      </p>
      <div className="world-calculator__body">
        <fieldset className="acq-tool-list" aria-describedby="acq-budget-note">
          <legend className="sr-only">
            Tools to include in your comparison
          </legend>
          <div className="acq-tool-list__head" aria-hidden="true">
            <span>Your tools</span>
            <span>Monthly cost</span>
          </div>
          {tools.map((tool) => (
            <div
              className={`acq-tool-row${tool.selected ? " acq-tool-row--selected" : ""}`}
              key={tool.id}
            >
              <label
                className="acq-tool-choice"
                htmlFor={`acq-tool-${tool.id}`}
              >
                <input
                  id={`acq-tool-${tool.id}`}
                  type="checkbox"
                  checked={tool.selected}
                  onChange={(event) =>
                    setTools((current) =>
                      current.map((item) =>
                        item.id === tool.id
                          ? { ...item, selected: event.target.checked }
                          : item,
                      ),
                    )
                  }
                />
                <tool.icon
                  className="acq-tool-icon"
                  size={18}
                  aria-hidden="true"
                />
                <span>
                  <strong>{tool.label}</strong>
                  <small>{tool.detail}</small>
                </span>
              </label>
              <div className="acq-tool-cost">
                <span aria-hidden="true">$</span>
                <input
                  aria-label={`${tool.label} monthly cost`}
                  type="number"
                  min="0"
                  max="100000"
                  step="0.01"
                  inputMode="decimal"
                  value={tool.cost}
                  onBlur={() =>
                    setTools((current) =>
                      current.map((item) =>
                        item.id === tool.id
                          ? {
                              ...item,
                              cost: String(
                                Math.max(
                                  0,
                                  Math.min(100000, Number(item.cost) || 0),
                                ),
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                  disabled={!tool.selected}
                  onChange={(event) =>
                    setTools((current) =>
                      current.map((item) =>
                        item.id === tool.id
                          ? { ...item, cost: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </div>
            </div>
          ))}
        </fieldset>
        <div className="world-calculator__summary">
          <div className="acq-stack-total">
            <span>Your selected subscriptions</span>
            <strong>
              ${dollars(totalCents)}
              <small>/mo</small>
            </strong>
          </div>
          <div className="acq-stack-total acq-stack-total--aca">
            <span>ACA Operator platform</span>
            <strong>
              $67<small>/mo</small>
            </strong>
          </div>
          <div
            className="acq-savings-result"
            aria-live="polite"
            aria-atomic="true"
          >
            <span>
              {selected.length === 0
                ? "Select tools to compare your stack"
                : differenceCents > 0
                  ? "Potential subscription savings"
                  : differenceCents === 0
                    ? "Same monthly subscription cost"
                    : "ACA costs more for this selection"}
            </span>
            <strong>
              {selected.length === 0
                ? "$0"
                : `$${dollars(Math.abs(differenceCents))}`}
              {selected.length > 0 && (
                <small>
                  {differenceCents > 0
                    ? "/month saved"
                    : differenceCents === 0
                      ? " difference"
                      : "/month more"}
                </small>
              )}
            </strong>
          </div>
          <p className="acq-fineprint">
            Estimate assumes you replace the selected subscriptions. AI, data,
            mailbox, domain, and other provider costs remain separate. Example
            budgets are not competitor prices.
          </p>
        </div>
      </div>
    </div>
  );
}

function WalkthroughRequest() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || status === "sending") return;
    setStatus("sending");
    try {
      const { data, error } = await supabase.functions.invoke(
        "submit-playbook-lead",
        { body: { email: email.trim(), source: "autopilot-world" } },
      );
      if (error || data?.error) throw error || new Error(data.error);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }
  return (
    <div className="acq-walkthrough" id="walkthrough">
      <h3>Prefer a personal walkthrough?</h3>
      <p>Leave your work email. We'll contact you to arrange a time.</p>
      {status === "done" ? (
        <p role="status" className="acq-request-success">
          <Check aria-hidden="true" size={18} /> Request received. We'll reach
          out to arrange your walkthrough.
        </p>
      ) : (
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor="acq-work-email">
            Work email address
          </label>
          <input
            id="acq-work-email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            disabled={status === "sending"}
          />
          <Button
            variant="cta"
            type="submit"
            disabled={!valid || status === "sending"}
          >
            {status === "sending" ? "Sending…" : "Request a walkthrough"}
          </Button>
        </form>
      )}
      {status === "error" && (
        <p role="alert">We couldn't send your request. Please try again.</p>
      )}
    </div>
  );
}

const workflowFeatures = [
  {
    id: "email-sequences",
    kind: "email" as const,
    label: "Cold email sequences",
    title: "Follow up until they reply.",
    description:
      "Write personalized emails, set the delays and let the sequence handle your follow-ups. Configure it to stop when someone replies, then pick up the conversation in your inbox.",
    points: [
      "AI-assisted messages based on your offer and buyer",
      "Timed follow-ups and stop-on-reply rules",
      "Sending limits and rotation across healthy mailboxes",
    ],
    color: "coral",
    icon: Mail,
  },
  {
    id: "linkedin-campaigns",
    kind: "linkedin" as const,
    label: "LinkedIn campaigns",
    title: "Turn connections into conversations.",
    description:
      "Reach buyers on LinkedIn with a sequence of connection requests, messages and follow-ups. Use acceptance and reply conditions to decide the next step, and manage responses across your connected accounts.",
    points: [
      "Connection requests, messages and InMail",
      "Branches for accepted connections and received replies",
      "Multiple connected senders and one inbox",
    ],
    color: "blue",
    icon: Network,
  },
  {
    id: "email-infrastructure",
    kind: "infrastructure" as const,
    label: "Microsoft 365 email infrastructure",
    title: "Run the mailboxes behind your cold email.",
    description:
      "Provision Microsoft 365 mailboxes, manage domains and DNS, and monitor warmup and sending health. Bring your own tenant or connect ZapMail, then use your ready mailboxes in a campaign.",
    points: [
      "Microsoft 365 tenants, domains and mailbox provisioning",
      "SPF, DKIM and DMARC readiness",
      "Warmup, daily caps and healthy-sender rotation",
    ],
    note: "Mailbox licences, domains and provider services are billed separately.",
    color: "teal",
    icon: Server,
  },
  {
    id: "lead-magnets",
    kind: "lead-magnet" as const,
    label: "Lead magnets & email capture",
    title: "Turn “send me the guide” into a lead.",
    description:
      "Offer a useful resource. When someone requests it with your keyword, ACA sends the link by DM. Capture their email before they access the guide, save the contact and start the follow-up you configured.",
    points: [
      "Keyword comments trigger your delivery message",
      "Email-gated resources and contact capture",
      "Connect captured leads to an active email sequence",
    ],
    color: "amber",
    icon: Magnet,
  },
  {
    id: "content-farming",
    kind: "content" as const,
    label: "Content farming & publishing",
    title: "One source idea, three formats.",
    description:
      "Monitor topics and creators, then turn source ideas into drafts in your brand voice. Build reusable content blueprints, review the output and schedule approved content to your connected channels.",
    points: [
      "Research creators, keywords and source content",
      "AI text, images, voice and video with your own keys",
      "Draft review, scheduling and publishing",
    ],
    color: "lilac",
    icon: PenLine,
  },
];

function FoxMascot({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="182 279 721 947"
      role="img"
      aria-label="ACA fox mascot"
      focusable="false"
    >
      <image href="/media/mascot/fox-wave-cut.png" width="1024" height="1536" />
    </svg>
  );
}

// Hero VSL: autoplays muted on a loop (captions are burned in); "Watch with sound"
// restarts it from the top with audio, and it falls back to the muted loop at the end.
// Autoplay starts from an effect rather than the autoPlay attribute so visitors who
// ask for reduced motion get the poster (and skip the 10 MB download) instead.
// Pause is always offered: WCAG 2.2.2 requires it for motion that runs over 5 s.
function HeroVsl() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    video.play().catch(() => {});
  }, []);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  async function watchWithSound() {
    const video = videoRef.current;
    if (!video) return;
    if (soundOn) {
      video.muted = true;
      video.loop = true;
      setSoundOn(false);
      return;
    }
    video.muted = false;
    video.loop = false;
    video.currentTime = 0;
    setSoundOn(true);
    try {
      await video.play();
    } catch {
      video.muted = true;
      video.loop = true;
      setSoundOn(false);
    }
  }

  function backToLoop() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.loop = true;
    setSoundOn(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    video.play().catch(() => {});
  }

  return (
    <div className="world-hero__vsl">
      <video
        ref={videoRef}
        src="/media/aca-vsl-hero.mp4"
        poster="/media/aca-vsl-hero-poster.jpg"
        muted
        loop
        playsInline
        preload="none"
        onEnded={backToLoop}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        aria-label="ACA in 74 seconds: cold email, LinkedIn, lead magnets, content and one inbox for $67 a month"
      />
      <div className="world-hero__vsl-controls">
        <button
          type="button"
          className="world-hero__vsl-sound"
          aria-label={soundOn ? "Mute" : "Watch with sound"}
          aria-pressed={soundOn}
          onClick={watchWithSound}
        >
          {soundOn ? <VolumeX size={14} /> : <Volume2 size={14} />}
          <span>{soundOn ? "Mute" : "Sound on"}</span>
        </button>
        <button
          type="button"
          className="world-hero__vsl-toggle"
          aria-label={playing ? "Pause video" : "Play video"}
          onClick={togglePlay}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </div>
    </div>
  );
}

export default function AutopilotWorld() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="aca-marketing acq-home acq-world acq-clarity" id="top">
      <a className="acq-skip" href="#main">
        Skip to content
      </a>
      <GitHubStarBanner />
      <header className="acq-header">
        <div className="acq-wrap acq-header__inner">
          <Link to="/" className="acq-logo" aria-label="ACA home">
            <img src="/logo.svg" alt="ACA" width="112" height="42" />
          </Link>
          <nav className="acq-desktop-nav" aria-label="Main navigation">
            <a href="#how-it-works">The platform</a>
            <a href="#integrations">Integrations</a>
            <a href="#offer">Pricing</a>
            <Link to="/mcp">For AI agents</Link>
          </nav>
          <div className="acq-header__actions">
            <GitHubStarsLink className="acq-github" />
            <NavDivider className="acq-gh-divider" />
            <Link to="/auth?mode=login" className="acq-signin">
              Sign in
            </Link>
            <PreviewButton className="acq-nav-cta">Start free</PreviewButton>
            <Button
              variant="outline"
              size="icon"
              className="acq-menu-toggle"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="acq-mobile-nav"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="acq-mobile-nav"
            className="acq-mobile-nav"
            aria-label="Mobile navigation"
            onClick={() => setMenuOpen(false)}
          >
            <a href="#how-it-works">The platform</a>
            <a href="#integrations">Integrations</a>
            <a href="#offer">Pricing</a>
            <Link to="/mcp">For AI agents</Link>
            <a href={ACA_GITHUB_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <Link to="/auth?mode=login">Sign in</Link>
          </nav>
        )}
      </header>
      <main id="main">
        <section className="world-hero acq-wrap" aria-labelledby="hero-title">
          <div className="world-hero__copy">
            <h1 id="hero-title">
              Outbound and inbound on every channel,
              <br />
              <em>run from one place.</em>
            </h1>
            <p>
              Stop paying the seat and AI credit tax. Self-host it free, or let
              us run it for {"$67 a month"}. Your own keys, unlimited
              leads, seats and inboxes.
            </p>
            <div className="world-hero__product">
              <HeroVsl />
              <FoxMascot className="world-hero__fox" />
            </div>
            <HeroPreviewForm />
            <p className="world-hero__provider-note">
              <Check size={16} aria-hidden="true" /> AI, data, mailbox licences
              and domains are paid to your own providers, at their prices.
            </p>
            <a className="world-hero__agents" href="#agents">
              <span>Or skip the app. Let your AI agent run it:</span>
              <span className="world-hero__agent-logos">
                {(Object.keys(agentMarks) as (keyof typeof agentMarks)[]).map(
                  (agent) => (
                    <span key={agent} title={agentMarks[agent].name}>
                      <AgentLogo agent={agent} size={16} />
                      {agentMarks[agent].name}
                    </span>
                  ),
                )}
              </span>
            </a>
          </div>
        </section>
        <section
          className="world-headless acq-wrap"
          id="agents"
          aria-labelledby="headless-title"
        >
          <div className="world-headless__copy">
            <h2 id="headless-title">
              Headless by design.
              <br />
              <em>You don’t have to use our app.</em>
            </h2>
            <p>
              Headless means ACA works without anyone clicking through its
              screens. You tell Claude, Codex, Grok, Hermes or OpenClaw what you
              want in plain English. Your agent builds the list, writes the
              sequence, launches it and drafts the replies in ACA for you. The
              app is still there whenever you want to check the work.
            </p>
            <div className="world-headless__compare" aria-label="Two ways to run ACA">
              <div>
                <span>In the app</span>
                <strong>You click through the screens</strong>
              </div>
              <div>
                <span>Headless</span>
                <strong>You ask your agent, it does the clicking</strong>
              </div>
            </div>
            <div className="world-headless__ways" aria-label="How agents connect">
              <div>
                <strong>MCP</strong>
                <span>Remote connector for Claude, Grok and any MCP client</span>
              </div>
              <div>
                <strong>CLI</strong>
                <span>
                  <code>aca</code> for Codex, Claude Code and your scripts
                </span>
              </div>
              <div>
                <strong>API + webhooks</strong>
                <span>For your own agents, n8n and internal tools</span>
              </div>
            </div>
            <Link to="/mcp" className="world-text-link">
              Connect your agent <ArrowRight size={16} />
            </Link>
          </div>
          <AgentChatProof />
        </section>
        <section
          className="world-proof-platform acq-wrap"
          id="how-it-works"
          aria-labelledby="workflow-title"
        >
          <div className="world-centered-heading">
            <h2 id="workflow-title">
              The tools to find buyers,
              <br />
              reach out and follow up.
            </h2>
            <p>
              See what each part does. Every workflow below is included in
              Operator.
            </p>
          </div>
          <nav
            className="world-feature-jumps"
            aria-label="Explore ACA capabilities"
          >
            {workflowFeatures.map((item) => (
              <a key={item.id} href={`#${item.id}`}>
                <item.icon size={16} />
                {item.label}
                <ArrowRight size={14} />
              </a>
            ))}
          </nav>
          {workflowFeatures.map((item, index) => (
            <section
              key={item.id}
              id={item.id}
              className={`world-feature world-feature--${item.color}${index % 2 ? " world-feature--reverse" : ""}`}
              aria-labelledby={`${item.id}-title`}
            >
              <div className="world-feature__copy">
                <h3 id={`${item.id}-title`}>
                  <item.icon aria-hidden="true" size={22} />
                  {item.label}.
                  <br />
                  <em>{item.title}</em>
                </h3>
                <p>{item.description}</p>
                <ul>
                  {item.points.map((point) => (
                    <li key={point}>
                      <Check size={16} />
                      {point}
                    </li>
                  ))}
                </ul>
                {item.note && (
                  <p className="world-feature__note">{item.note}</p>
                )}
              </div>
              <div className="world-feature__proof">
                <AcquisitionProof kind={item.kind} />
              </div>
            </section>
          ))}
          <div className="world-support-proofs">
            <section aria-labelledby="signals-title">
              <div>
                <h3 id="signals-title">
                  Buyer signals and lead sourcing.
                  <br />
                  <em>Reach the right buyer with a reason.</em>
                </h3>
                <p>
                  Filter prospects around your ideal customer. Use company
                  events and engagement signals to give your outreach context.
                </p>
              </div>
              <AcquisitionProof kind="signals" />
            </section>
            <section aria-labelledby="inbox-title">
              <div>
                <h3 id="inbox-title">
                  Unified inbox and AI replies.
                  <br />
                  <em>The reply is in. Your draft is ready.</em>
                </h3>
                <p>
                  Keep email and social conversations together. Let AI prepare a
                  response using the context, then review it before sending.
                </p>
              </div>
              <AcquisitionProof kind="inbox" />
            </section>
          </div>
          <div className="world-proof-cta">
            <p>See these drafts written for your own business.</p>
            <PreviewButton>Build my free preview</PreviewButton>
          </div>
        </section>
        <section
          className="world-stack-switch"
          aria-labelledby="stack-switch-title"
        >
          <div className="acq-wrap world-stack-switch__layout">
            <div>
              <h2 id="stack-switch-title">
                Run the workflow.
                <br />
                <em>Keep one platform bill.</em>
              </h2>
              <p>
                Your sequencer, LinkedIn campaigns, email setup, content and
                lead capture work together. Keep the buyer's context from first
                touch to reply.
              </p>
            </div>
            <div className="world-stack-switch__compare">
              <div>
                <span>A separate tool for each job</span>
                <p>
                  Email sequencer · LinkedIn automation · Content software ·
                  Lead magnet tools · Mailbox management
                </p>
              </div>
              <ArrowDown size={21} />
              <div>
                <span>All included in ACA Operator</span>
                <strong>
                  $67 <small>/month</small>
                </strong>
                <p>Unlimited platform seats, leads, campaigns and content.</p>
              </div>
            </div>
          </div>
        </section>
        <section
          className="world-pricing"
          id="offer"
          aria-labelledby="offer-title"
        >
          <div className="acq-wrap">
            <div className="world-section-heading">
              <div>
                <h2 id="offer-title">
                  Add your team.
                  <br />
                  <em>Keep the platform price at{"\u00a0"}$67.</em>
                </h2>
              </div>
              <p>
                No per-seat platform fees. No ACA credit packs.
                <br />
                Bring your API keys. Provider subscriptions and usage are
                separate.
              </p>
            </div>
            <div className="world-pricing__layout">
              <div className="world-plan">
                <span className="world-plan__tag">
                  OPERATOR · ALL ACQUISITION FEATURES
                </span>
                <div className="world-plan__price">
                  $67<small>/month</small>
                </div>
                <p>
                  One platform subscription.
                  <br />
                  Your whole team included.
                </p>
                <ul>
                  {[
                    "Unlimited seats & leads",
                    "Unlimited campaigns & content",
                    "Cold email & LinkedIn campaign tools",
                    "Microsoft 365 infrastructure & warmup",
                    "Content farming & lead magnet capture",
                    "Buyer signals, CRM & unified inbox",
                    "Your API keys. No AI token markup.",
                  ].map((item) => (
                    <li key={item}>
                      <Check size={17} />
                      {item}
                    </li>
                  ))}
                </ul>
                <PreviewButton>Build my free preview</PreviewButton>
                <p className="acq-fineprint">Free preview before signup.</p>
                <Link className="world-text-link" to="/pricing">
                  Full pricing details <ArrowRight size={16} />
                </Link>
              </div>
              <SavingsCalculator />
            </div>
            <div className="acq-agency">
              <span>
                Running this for clients?{" "}
                <strong>White-label is $297/month</strong> with client
                workspaces, your branding and client billing.
              </span>
              <Link to="/pricing">
                Explore white-label <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>
        <section
          className="acq-integrations acq-wrap"
          id="integrations"
          aria-labelledby="integrations-title"
        >
          <div className="world-section-heading">
            <div>
              <h2 id="integrations-title">
                Use your own accounts.
                <br />
                Choose your own providers.
              </h2>
            </div>
            <p>
              Connect LinkedIn and your email accounts for outreach, Microsoft
              365 or ZapMail for infrastructure, and Apify for research. Use
              your own AI keys for personalization and content. Explore all 40
              connections.
            </p>
          </div>
          <IntegrationBrands expanded />
        </section>
        <section className="world-faq acq-wrap" aria-labelledby="faq-title">
          <div>
            <h2 id="faq-title">
              What’s included?
              <br />
              What costs extra?
            </h2>
            <p>
              Know the platform price, the provider costs and how to try ACA
              before creating an account.
            </p>
          </div>
          <div className="acq-faq__list">
            {questions.map((item) => (
              <details key={item.question}>
                <summary>
                  {item.question}
                  <Plus size={18} />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="world-final" aria-labelledby="final-title">
          <div className="acq-wrap">
            <FoxMascot className="world-final__fox" />
            <h2 id="final-title">
              See what ACA creates
              <br />
              <em>for your business.</em>
            </h2>
            <p>
              Enter your website and get buyer ideas, an email draft and content
              ideas for free. Create an account when you’re ready to use the
              platform. Operator is $67/month for your whole team.
            </p>
            <div className="acq-actions">
              <PreviewButton>Build my free preview</PreviewButton>
              <Button
                variant="outline"
                asChild
                size="lg"
                className="acq-secondary"
              >
                <Link to="/pricing">
                  See pricing <ArrowRight size={16} />
                </Link>
              </Button>
            </div>
            <p className="acq-fineprint">
              No account or card needed for the preview.
            </p>
            <WalkthroughRequest />
          </div>
        </section>
      </main>
      <footer className="acq-footer">
        <div className="acq-wrap acq-footer__inner">
          <Link to="/" aria-label="ACA home">
            <img src="/logo.svg" alt="ACA" width="100" height="38" />
          </Link>
          <span>© {new Date().getFullYear()} Automated Client Acquisition</span>
          <nav aria-label="Footer">
            <Link to="/pricing">Pricing</Link>
            <Link to="/playbooks">Playbooks</Link>
            <Link to="/community">Community</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
