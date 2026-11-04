import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { type AgentKey } from "@/components/marketing/home/AgentLogos";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  KeyRound,
  Mail,
  MessageSquare,
  Network,
  Pause,
  Play,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import "@/styles/aca-home.css";
import "@/styles/mcp-editorial.css";

const MCP_SERVER_URL =
  (import.meta.env.VITE_MCP_SERVER_URL as string | undefined) ||
  "https://www.automatedclientacquisition.com/api/mcp";

// OAuth endpoint for clients that sign in (Claude, Cursor) - no API key needed.
const OAUTH_MCP_URL = "https://mcp.automatedclientacquisition.com/mcp";

type EntryKey = "mcp" | "cli" | "skill";

const ENTRY_TABS: { key: EntryKey; label: string; meta: string }[] = [
  { key: "mcp", label: "MCP", meta: "Remote connector" },
  { key: "cli", label: "CLI", meta: "Terminal + agents" },
  { key: "skill", label: "Skill", meta: "Prebuilt plays" },
];

const AGENT_TABS: { key: AgentKey; label: string }[] = [
  { key: "claude-desktop", label: "Claude" },
  { key: "codex", label: "Codex" },
  { key: "cursor", label: "Cursor" },
  { key: "openclaw", label: "OpenClaw" },
  { key: "hermes", label: "Hermes" },
];

type Step = {
  title: string;
  body: string;
  code?: string;
  cta?: { label: string; href: string; external?: boolean };
};

/* ── Copyable code / URL chip ─────────────────────────────────── */
function CopyBlock({ code, block }: { code: string; block?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy. Select the code and copy it manually.");
    }
  }
  return (
    <div className={`mcp-code${block ? " mcp-code--block" : ""}`}>
      <pre tabIndex={0}>{code}</pre>
      <button
        type="button"
        className="mcp-code__copy"
        onClick={copy}
        aria-label="Copy code or URL"
      >
        {copied ? (
          <>
            <Check size={14} /> Copied
          </>
        ) : (
          "Copy"
        )}
      </button>
    </div>
  );
}

/* ── Step content per entry type × agent ──────────────────────── */
const AGENT_NAME: Record<AgentKey, string> = {
  "claude-desktop": "Claude",
  "claude-code": "Claude Code",
  "claude-cowork": "Claude Cowork",
  cursor: "Cursor",
  windsurf: "Windsurf",
  chatgpt: "ChatGPT",
  codex: "Codex",
  openclaw: "OpenClaw",
  cline: "Cline",
  continue: "Continue",
  hermes: "Hermes",
  zed: "Zed",
  mcp: "your agent",
};

const jsonConfig = `{
  "mcpServers": {
    "aca": {
      "url": "${MCP_SERVER_URL}",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`;

const oauthJsonConfig = `{
  "mcpServers": {
    "aca": {
      "type": "http",
      "url": "${OAUTH_MCP_URL}"
    }
  }
}`;

const tomlConfig = `[mcp_servers.aca]
url = "${MCP_SERVER_URL}"
headers = { Authorization = "Bearer YOUR_API_KEY" }`;

function mcpSteps(agent: AgentKey): Step[] {
  const name = AGENT_NAME[agent];
  const step1: Step = {
    title: "Copy the ACA connector URL",
    body: `You'll paste this into ${name} in the next step. Generate an API key first - it authenticates the connection.`,
    code: MCP_SERVER_URL,
    cta: { label: "Generate an API key", href: "/settings?tab=mcp-keys" },
  };
  const oauthStep1: Step = {
    title: "Copy the ACA connector URL",
    body: `You'll paste this into ${name} in the next step. No API key needed - you sign in to ACA with OAuth.`,
    code: OAUTH_MCP_URL,
  };
  const run: Step = {
    title: "Connect and start",
    body: `Ask ${name}: "Find my interested contacts and help me prepare the next outreach step." Available tools depend on your connection and permissions. Review campaign drafts in ACA before activation.`,
  };

  switch (agent) {
    case "claude-desktop":
      return [
        oauthStep1,
        {
          title: "Add the connector and sign in",
          body: "In Claude Desktop or on claude.ai, open Settings → Connectors → Add custom connector. Name it ACA, paste the URL, then click Connect and sign in to ACA to approve access.",
          cta: {
            label: "Open Claude Connectors",
            href: "https://claude.ai/settings/connectors",
            external: true,
          },
        },
        {
          ...run,
          cta: {
            label: "Start in Claude",
            href: "https://claude.ai/new",
            external: true,
          },
        },
      ];
    case "codex":
      return [
        step1,
        {
          title: "Register the MCP server",
          body: "Add ACA to ~/.codex/config.toml, then restart Codex so it picks up the server.",
          code: tomlConfig,
        },
        run,
      ];
    case "cursor":
      return [
        oauthStep1,
        {
          title: "Add the server in Cursor",
          body: "Cursor → Settings → MCP → Add new MCP server. Paste this JSON, then click Connect and sign in to ACA.",
          code: oauthJsonConfig,
        },
        run,
      ];
    case "openclaw":
      return [
        step1,
        {
          title: "Add ACA to OpenClaw",
          body: "Add the server to your OpenClaw MCP config (mcp.json). Any MCP-native client uses the same block.",
          code: jsonConfig,
        },
        run,
      ];
    case "hermes":
    default:
      return [
        step1,
        {
          title: "Add the MCP server in Hermes",
          body: "In Hermes settings, add a remote MCP server, paste the URL, and set the Authorization header to your bearer key.",
          code: jsonConfig,
        },
        run,
      ];
  }
}

function cliSteps(agent: AgentKey): Step[] {
  const name = AGENT_NAME[agent];
  return [
    {
      title: "Install the ACA CLI",
      body: "One global install. Works on macOS, Linux, and WSL.",
      code: "npm install -g @seguelac/aca-cli",
    },
    {
      title: "Authenticate",
      body: "Generate a CLI token in ACA, then log in. The token is bound to your account and current organization.",
      code: "aca login --token aca_your_token_here",
      cta: { label: "Generate a CLI token", href: "/settings?tab=cli-tokens" },
    },
    {
      title: `Run it - or let ${name} run it`,
      body: `Every command supports --json. ${name} can call the CLI directly from the terminal to search leads, enroll campaigns, and reply in the inbox.`,
      code: "aca leads search --tag warm --has-email --limit 50",
    },
  ];
}

function skillSteps(agent: AgentKey): Step[] {
  const name = AGENT_NAME[agent];
  if (agent === "claude-desktop") {
    return [
      {
        title: "Add the ACA plugin",
        body: "The ACA plugin bundles the ACA connector with 30 prebuilt plays - ICP, lead lists, campaigns, deliverability, replies, and content. In Claude Code, add the marketplace:",
        code: "/plugin marketplace add seguelaCedric/aca-native-mcp-skills",
      },
      {
        title: "Install and sign in",
        body: "Install the plugin, then sign in to ACA when Claude asks. OAuth only - no API key to copy.",
        code: "/plugin install aca-native-mcp-skills@aca-native-mcp-skills",
      },
      {
        title: "Run a play",
        body: "Start with the kickoff. It checks your workspace and recommends the next play.",
        code: "/aca-kickoff",
        cta: { label: "See every command", href: "/mcp/commands" },
      },
    ];
  }
  return [
    {
      title: "Browse the ACA skill library",
      body: "ACA ships a growing library of prebuilt skills - SDR research, cold-email and LinkedIn writers, SEO blogs, lead scoring, and lead-list building.",
      cta: { label: "Browse the playbooks", href: "/playbooks" },
    },
    {
      title: "Point it at your workspace",
      body: `Connect ${name} over MCP or the CLI so each skill can read your leads, ICP, senders, and campaigns.`,
    },
    {
      title: "Invoke a skill",
      body: "Type a slash command and ACA runs the whole play - research, scoring, and drafting - then hands it back for approval.",
      code: "/sdr-research  Acme Corp - Series B fintech",
    },
  ];
}

function stepsFor(entry: EntryKey, agent: AgentKey): Step[] {
  if (entry === "cli") return cliSteps(agent);
  if (entry === "skill") return skillSteps(agent);
  return mcpSteps(agent);
}

/* ── "How does MCP work?" use cases ───────────────────────────── */
type UseCase = {
  key: string;
  tab: string;
  img: string;
  video?: string;
  alt: string;
};

const USE_CASES: UseCase[] = [
  {
    key: "leads",
    tab: "Finding leads",
    img: "/media/mcp/usecase-leads-v2.jpg",
    video: "/media/mcp/usecase-leads-v2.mp4",
    alt: "Claude conversation asking ACA to find 200 SaaS founders matching an ICP, with tool calls and a ranked list of top matches",
  },
  {
    key: "linkedin",
    tab: "LinkedIn campaigns",
    img: "/media/mcp/usecase-linkedin-v2.jpg",
    video: "/media/mcp/usecase-linkedin-v2.mp4",
    alt: "Claude conversation launching a 4-step LinkedIn campaign via ACA, with the sequence steps checked off",
  },
  {
    key: "email",
    tab: "Email sequences",
    img: "/media/mcp/usecase-email-v2.jpg",
    video: "/media/mcp/usecase-email-v2.mp4",
    alt: "Illustrative agent conversation preparing a three-email sequence",
  },
  {
    key: "signals",
    tab: "Buying signals",
    img: "/media/mcp/usecase-signals-v2.jpg",
    video: "/media/mcp/usecase-signals-v2.mp4",
    alt: "Claude conversation setting up a buying-signal watch, with today's signals: a pricing visit, SDR hiring, and a funding round",
  },
  {
    key: "content",
    tab: "Content production",
    img: "/media/mcp/usecase-content-v2.jpg",
    video: "/media/mcp/usecase-content-v2.mp4",
    alt: "Claude conversation drafting a week of LinkedIn posts and queueing them Monday to Friday",
  },
  {
    key: "magnets",
    tab: "Lead magnets",
    img: "/media/mcp/usecase-magnets-v2.jpg",
    video: "/media/mcp/usecase-magnets-v2.mp4",
    alt: "Illustrative agent conversation preparing a lead magnet and follow-up workflow",
  },
];

const localAgentMarks: Partial<Record<AgentKey, string>> = {
  "claude-desktop": "/logos/anthropic.svg",
  codex: "/logos/openai.svg",
  cursor: "/logos/cursor.svg",
  openclaw: "/logos/openclaw.svg",
  hermes: "/logos/hermes.svg",
};
function AgentMark({ agent }: { agent: AgentKey }) {
  return (
    <img
      src={localAgentMarks[agent]}
      alt=""
      aria-hidden="true"
      width="22"
      height="22"
      className="mcpe-agent-mark"
    />
  );
}
function Fox() {
  return (
    <svg
      viewBox="182 279 721 947"
      role="img"
      aria-label="ACA fox mascot"
      className="mcpe-fox"
    >
      <image href="/media/mascot/fox-wave-cut.png" width="1024" height="1536" />
    </svg>
  );
}
function ChoiceTabs({
  id,
  label,
  options,
  selected,
  onChange,
  className,
}: {
  id: string;
  label: string;
  options: Array<{
    key: string;
    label: string;
    meta?: string;
    icon?: ReactNode;
  }>;
  selected: string;
  onChange: (key: string) => void;
  className: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className={className} role="tablist" aria-label={label}>
      {options.map((item, index) => (
        <button
          key={item.key}
          id={`${id}-${item.key}`}
          role="tab"
          aria-selected={selected === item.key}
          aria-controls={`${id}-panel`}
          tabIndex={selected === item.key ? 0 : -1}
          type="button"
          ref={(el) => {
            refs.current[index] = el;
          }}
          onClick={() => onChange(item.key)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % options.length;
            else if (event.key === "ArrowLeft")
              next = (index + options.length - 1) % options.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = options.length - 1;
            else return;
            event.preventDefault();
            onChange(options[next].key);
            refs.current[next]?.focus();
          }}
        >
          {item.icon}
          <span>
            <strong>{item.label}</strong>
            {item.meta && <small>{item.meta}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}
const workflowCapabilities = [
  {
    icon: UsersRound,
    title: "Find the right contact",
    body: "Search workspace contacts, read their context and organize a relevant lead list.",
  },
  {
    icon: Network,
    title: "Prepare the next campaign",
    body: "Create LinkedIn campaign drafts and inspect existing campaigns before taking the next step.",
  },
  {
    icon: Mail,
    title: "See your email sequences",
    body: "Read sequence summaries so your agent understands the outreach already in place.",
  },
  {
    icon: MessageSquare,
    title: "Understand the conversation",
    body: "Find prospect conversations and read a reply before deciding how to follow up.",
  },
  {
    icon: Sparkles,
    title: "Put ideas into production",
    body: "Create ideas and blueprints, draft posts into the best free slots on your calendar and see how published posts performed.",
  },
  {
    icon: FileText,
    title: "Package your expertise",
    body: "Create inactive lead-magnet drafts and inspect existing campaign status.",
  },
];
const caseDescriptions: Record<string, { title: string; body: string }> = {
  leads: {
    title: "Give your agent the context to find the opportunity.",
    body: "Use a focused prompt to explain who you want to reach and what matters to your business.",
  },
  linkedin: {
    title: "Turn your outreach plan into a campaign draft.",
    body: "Coordinate the audience, message and follow-up. Review the campaign in ACA before activating it.",
  },
  email: {
    title: "Write a first message worth opening.",
    body: "Give your agent the offer and buyer context, then review the sequence and sending setup in ACA.",
  },
  signals: {
    title: "Reach out with a reason, not a generic opener.",
    body: "Use buyer context and the signal workflows available in your ACA workspace to guide personalization.",
  },
  content: {
    title: "Keep your expertise in front of the right people.",
    body: "Connect your ideas, voice and content blueprints. Prepare useful content with your own AI providers.",
  },
  magnets: {
    title: "Make useful content the start of a conversation.",
    body: "Prepare a resource and lead-magnet draft. Review the capture and follow-up setup before activation.",
  },
};
const connectionFaqs = [
  {
    q: "Which agent should I use?",
    a: "Use the AI workspace you already know. This page includes setup examples for Claude, Codex, Cursor, OpenClaw and Hermes. Remote MCP support and configuration vary by client.",
  },
  {
    q: "Do I need an API key?",
    a: "The Claude and Cursor setup examples use the OAuth connector: sign in to ACA and approve access. The other MCP examples use an API key from ACA Settings. The CLI uses its own CLI token. You can revoke connections and keys from your account.",
  },
  {
    q: "How are MCP, CLI and skills different?",
    a: "MCP gives a compatible agent tools for your ACA workspace. The CLI exposes commands for terminals and scripts. Skills provide instructions for a particular workflow and use a connected MCP or CLI underneath.",
  },
  {
    q: "Can a prompt launch every ACA workflow?",
    a: "Available tools differ by connector and permissions. The OAuth connector supports contacts, lists, conversation reads, email sequence summaries, campaign drafts, content generation and lead-magnet drafts. Outreach activation and email-sequence editing require the relevant ACA app workflow. An API-key connection and CLI can expose different operations.",
  },
  {
    q: "What does this cost?",
    a: "ACA Operator is $67/month with unlimited platform seats, leads, campaigns and content. Your AI client subscription, API usage and other provider costs or limits apply separately. Bring your own keys; ACA does not add a markup to AI tokens. Agency white-label is a separate plan.",
  },
  {
    q: "Is there a Claude plugin?",
    a: "Yes. The ACA plugin bundles the OAuth connector and prebuilt workflow skills. Choose Skills and Claude above for the marketplace and installation commands. See every command at /mcp/commands.",
  },
];
export default function AcaMcp() {
  const [entry, setEntry] = useState<EntryKey>("mcp");
  const [agent, setAgent] = useState<AgentKey>("claude-desktop");
  const [useCase, setUseCase] = useState("leads");
  const [soundOn, setSoundOn] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !soundOn;
  }, [soundOn, useCase]);
  const steps = useMemo(() => stepsFor(entry, agent), [entry, agent]);
  const activeCase = USE_CASES.find((item) => item.key === useCase)!;
  const caseCopy = caseDescriptions[useCase];
  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      await video.play();
    } catch {
      toast.error("This walkthrough could not play. Please try again.");
    }
  }
  return (
    <>
      <MarketingNav />
      <main className="aca-marketing mkt-page mcpe-page" id="mcp-main">
        <section className="mcpe-hero">
          <div className="mcpe-wrap mcpe-hero__layout">
            <div className="mcpe-hero__copy">
              <span className="mcpe-eyebrow">
                <i /> MCP · CLI · SKILLS
              </span>
              <h1>
                Find leads.
                <br />
                Draft outreach.
                <br />
                <em>From your AI chat.</em>
              </h1>
              <p className="lead">
                Find the right contacts. Prepare your outreach. Keep
                conversations moving, from the AI workspace you already use.
              </p>
              <div className="mcpe-actions">
                <Button variant="cta" size="lg" asChild>
                  <a href="#connect">
                    Connect my agent <ArrowRight size={17} />
                  </a>
                </Button>
                <a className="mcpe-text-link" href="#how-it-works">
                  See the workflows <ChevronDown size={16} />
                </a>
              </div>
              <p className="mcpe-fine">
                Included with ACA Operator · $67/month
                <br />
                Your AI client and provider usage apply separately.
              </p>
              <div className="mcpe-supported">
                <span>WORK WITH YOUR FAVOURITE AI</span>
                <div>
                  {AGENT_TABS.map((item) => (
                    <a
                      key={item.key}
                      href="#connect"
                      onClick={() => setAgent(item.key)}
                    >
                      <AgentMark agent={item.key} />
                      {item.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
            <div className="mcpe-hero__visual">
              <div className="mcpe-console">
                <div className="mcpe-console__bar">
                  <span>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>Your AI + ACA</span>
                  <span className="mcpe-example-label">
                    Illustrative workflow
                  </span>
                </div>
                <div className="mcpe-console__body">
                  <div className="mcpe-prompt">
                    <span className="mcpe-avatar">You</span>
                    <p>
                      Find my interested contacts and help me prepare the next
                      outreach step.
                    </p>
                  </div>
                  <div className="mcpe-response">
                    <div className="mcpe-response__title">
                      <span className="mcpe-ai-symbol">
                        <Sparkles size={20} />
                      </span>
                      <strong>Your AI, connected to ACA</strong>
                    </div>
                    <p>
                      I’ll look at the contacts and their context, then prepare
                      a draft for you to review.
                    </p>
                    <div className="mcpe-tool-call">
                      <Search size={16} />
                      <span>
                        <strong>Find relevant contacts</strong>
                        <small>Search your ACA workspace</small>
                      </span>
                      <Check size={16} />
                    </div>
                    <div className="mcpe-tool-call">
                      <UsersRound size={16} />
                      <span>
                        <strong>Read the context</strong>
                        <small>Offer, contact and conversation</small>
                      </span>
                      <Check size={16} />
                    </div>
                    <div className="mcpe-tool-call">
                      <Network size={16} />
                      <span>
                        <strong>Prepare a campaign draft</strong>
                        <small>Review and activate in ACA</small>
                      </span>
                      <Check size={16} />
                    </div>
                    <div className="mcpe-draft-ready">
                      <span>
                        <FileText size={17} /> Your next step is ready to
                        review.
                      </span>
                      <ArrowRight size={17} />
                    </div>
                  </div>
                  <p className="mcpe-console__note">
                    Sample data · capabilities depend on your connection
                  </p>
                </div>
              </div>
              <div className="mcpe-connection-path">
                <span>
                  <Sparkles size={16} /> Your agent
                </span>
                <i />
                <span className="mcpe-connection-path__aca">aca.</span>
                <i />
                <span>
                  <Plug size={16} /> Your workspace
                </span>
              </div>
              <Fox />
            </div>
          </div>
        </section>
        <section className="mcpe-setup" id="connect">
          <div className="mcpe-wrap">
            <div className="mcpe-section-heading">
              <div>
                <span className="mcpe-eyebrow">
                  A FAMILIAR WORKSPACE. A NEW CONNECTION.
                </span>
                <h2>Your agent. Your way in.</h2>
              </div>
              <p>
                Pick the agent you use, then choose MCP, the CLI or a prebuilt
                skill. Follow the setup that fits your workflow.
              </p>
            </div>
            <div className="mcpe-setup-card">
              <ChoiceTabs
                id="mcpe-agent"
                label="Choose your agent"
                className="mcpe-agent-tabs"
                selected={agent}
                onChange={(value) => setAgent(value as AgentKey)}
                options={AGENT_TABS.map((item) => ({
                  ...item,
                  icon: <AgentMark agent={item.key} />,
                }))}
              />
              <div
                id="mcpe-agent-panel"
                role="tabpanel"
                aria-labelledby={`mcpe-agent-${agent}`}
              >
                <ChoiceTabs
                  id="mcpe-entry"
                  label="Connection type"
                  className="mcpe-entry-tabs"
                  selected={entry}
                  onChange={(value) => setEntry(value as EntryKey)}
                  options={ENTRY_TABS.map((item) => ({
                    ...item,
                    icon:
                      item.key === "mcp" ? (
                        <Plug size={20} />
                      ) : item.key === "cli" ? (
                        <Terminal size={20} />
                      ) : (
                        <FileText size={20} />
                      ),
                  }))}
                />
                <div
                  className="mcpe-steps"
                  id="mcpe-entry-panel"
                  role="tabpanel"
                  aria-labelledby={`mcpe-entry-${entry}`}
                  key={`${entry}-${agent}`}
                >
                  {steps.map((step, index) => (
                    <article className="mcpe-step" key={index}>
                      <span className="mcpe-step__number">0{index + 1}</span>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                      {step.code && (
                        <CopyBlock
                          code={step.code}
                          block={step.code.includes("\n")}
                        />
                      )}{" "}
                      {step.cta && (
                        <a
                          className="mcpe-text-link"
                          href={step.cta.href}
                          target={step.cta.external ? "_blank" : undefined}
                          rel={
                            step.cta.external
                              ? "noopener noreferrer"
                              : undefined
                          }
                        >
                          {step.cta.label}
                          <ArrowRight size={15} />
                        </a>
                      )}
                    </article>
                  ))}
                </div>
              </div>
              <div className="mcpe-setup-foot">
                <span>
                  <ShieldCheck size={17} /> Your account. Your organization.
                  Your permissions.
                </span>
                <a href="/settings?tab=mcp-keys">
                  Manage API keys <ArrowRight size={15} />
                </a>
              </div>
            </div>
            <div className="mcpe-connection-note">
              <KeyRound size={19} />
              <p>
                <strong>Choose the connection for the work you need.</strong>{" "}
                OAuth, API-key MCP and CLI expose different operations. Check
                the workflow before giving your agent a task.
              </p>
              <Link to="/developers">
                API reference <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </section>
        <section className="mcpe-workflows" id="how-it-works">
          <div className="mcpe-wrap">
            <div className="mcpe-section-heading">
              <div>
                <span className="mcpe-eyebrow">
                  FROM PROMPT TO USEFUL NEXT STEP
                </span>
                <h2>
                  See how your agent
                  <br />
                  prepares the next campaign.
                </h2>
              </div>
              <p>
                Explore the acquisition workflows. These walkthroughs illustrate
                the journey; available actions depend on the connector and your
                setup.
              </p>
            </div>
            <ChoiceTabs
              id="mcpe-usecase"
              label="MCP use cases"
              className="mcpe-usecase-tabs"
              selected={useCase}
              onChange={(value) => {
                setUseCase(value);
                setIsPlaying(false);
                setSoundOn(false);
              }}
              options={USE_CASES.map((item) => ({
                key: item.key,
                label: item.tab,
              }))}
            />
            <div
              className="mcpe-demo"
              id="mcpe-usecase-panel"
              role="tabpanel"
              aria-labelledby={`mcpe-usecase-${useCase}`}
            >
              <div className="mcpe-demo__intro">
                <span className="mcpe-eyebrow">{activeCase.tab}</span>
                <h3>{caseCopy.title}</h3>
                <p>{caseCopy.body}</p>
                <span className="mcpe-demo__label">
                  Illustrative walkthrough · sample data
                </span>
              </div>
              <div className="mcpe-demo__media">
                {activeCase.video ? (
                  <>
                    <video
                      key={activeCase.key}
                      ref={videoRef}
                      src={activeCase.video}
                      poster={activeCase.img}
                      preload="none"
                      muted={!soundOn}
                      playsInline
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => setIsPlaying(false)}
                      aria-label={activeCase.alt}
                    />
                    <div className="mcpe-player-controls">
                      <button
                        type="button"
                        onClick={togglePlayback}
                        aria-label={
                          isPlaying ? "Pause walkthrough" : "Play walkthrough"
                        }
                      >
                        {isPlaying ? <Pause size={16} /> : <Play size={16} />}{" "}
                        {isPlaying ? "Pause" : "Play walkthrough"}
                      </button>
                      <button
                        type="button"
                        aria-pressed={soundOn}
                        onClick={() => setSoundOn((value) => !value)}
                      >
                        {soundOn ? "Sound on" : "Sound off"}
                      </button>
                    </div>
                  </>
                ) : (
                  <img src={activeCase.img} alt={activeCase.alt} />
                )}
              </div>
            </div>
          </div>
        </section>
        <section className="mcpe-capabilities">
          <div className="mcpe-wrap">
            <div className="mcpe-section-heading">
              <div>
                <span className="mcpe-eyebrow">CONTEXT YOUR AI CAN ACT ON</span>
                <h2>
                  Contacts, campaigns and content.
                  <br />
                  Tools your AI can use.
                </h2>
              </div>
              <p>
                Your prompts become more useful when your agent can work with
                the contacts, conversations and content in your ACA workspace.
              </p>
            </div>
            <div className="mcpe-capability-grid">
              {workflowCapabilities.map((item) => (
                <article key={item.title}>
                  <span>
                    <item.icon size={22} aria-hidden="true" />
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
            <p className="mcpe-fine">
              The capabilities above describe the OAuth connector. API-key MCP
              and CLI operations can differ. Sending, activation and provider
              access follow the relevant workflow and account permissions.
            </p>
          </div>
        </section>
        <section className="mcpe-faq">
          <div className="mcpe-wrap mcpe-faq__layout">
            <div>
              <span className="mcpe-eyebrow">BEFORE YOU CONNECT</span>
              <h2>
                Clear answers.
                <br />A better start.
              </h2>
            </div>
            <div>
              {connectionFaqs.map((item) => (
                <details key={item.q}>
                  <summary>
                    {item.q}
                    <span aria-hidden="true">+</span>
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <section className="mcpe-final">
          <div className="mcpe-wrap">
            <span className="mcpe-eyebrow">YOUR NEXT WORKFLOW STARTS HERE</span>
            <h2>
              Connect your agent.
              <br />
              <em>Start preparing your next campaign.</em>
            </h2>
            <p>
              One $67/month platform. Your whole team included.
              <br />
              Bring your own keys. Provider usage and limits apply separately.
            </p>
            <div className="mcpe-actions">
              <Button variant="cta" size="lg" asChild>
                <Link to="/get-started">
                  Start for free <ArrowRight size={17} />
                </Link>
              </Button>
              <a href="#connect" className="mcpe-text-link">
                Already use ACA? Connect your agent <ArrowRight size={16} />
              </a>
            </div>
            <Link to="/pricing" className="mcpe-pricing-link">
              See plans and billing details
            </Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
