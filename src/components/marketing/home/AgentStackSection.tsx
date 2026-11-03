import { Cpu, ArrowDown, Plug, Send, CalendarCheck } from "lucide-react";

const agents = [
  { name: "Hermes", logo: "/logos/hermes.svg" },
  { name: "Claude", logo: "/logos/anthropic.svg" },
  { name: "GPT", logo: "/logos/openai.svg" },
  { name: "OpenClaw", logo: "/logos/openclaw.svg" },
  { name: "Codex", logo: "/logos/openai.svg" },
  { name: "Cursor", logo: "/logos/cursor.svg" },
];

const layers = [
  {
    tag: "Hermes · Claude · GPT",
    name: "The Brain - plans, reasons, decides",
    desc: "Your AI agent detects who's ready, knows what to say, and orchestrates the full GTM motion. Connect any MCP-native agent in one line.",
    accent: false,
  },
  {
    tag: "ACA · Signals + Intelligence",
    name: "🔔🧠 Detect who's ready. Know what to say.",
    desc: "Just-funded alerts. Hiring signals. Tech-stack changes. Content scraper tracks what's trending. Lead enrichment builds icebreakers. Your agent never guesses - it knows.",
    accent: true,
  },
  {
    tag: "ACA · Execution",
    name: "🚀 Reach them everywhere. Outbound + Inbound.",
    desc: "Multi-channel outbound across 6 channels. LinkedIn + email campaigns. Content autopilot publishing daily. Comment-to-DM lead magnets. Your agent runs outbound AND inbound - one platform, one rope.",
    accent: false,
  },
  {
    tag: "ACA · Infrastructure",
    name: "🏗 Land in their inbox. Every time.",
    desc: "Self-hosted email servers. IP warmup. DMARC + DNS. Email verification. $0.66/inbox. No shared infrastructure. No spam folders. Your agent's messages actually deliver.",
    accent: false,
  },
];

export function AgentStackSection() {
  return (
    <section id="agents" className="section section--stack">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">The 4-layer architecture</span>
          <h2 className="h-section">
            Your agent plans.<br />
            <em>ACA executes</em><span className="dot">.</span>
          </h2>
          <p className="lead">
            AI agents are brilliant at planning outreach. But a brain without a body just thinks. ACA gives your agent four layers of infrastructure - signals to detect, intelligence to target, execution to reach, and infrastructure to deliver. From idea to inbox.
          </p>
        </header>

        {/* Agent logos row */}
        <div className="stack__agents">
          <span className="stack__agents-label">Works with</span>
          <div className="stack__agents-row">
            {agents.map((a) => (
              <div key={a.name} className="stack__agent-chip" title={a.name}>
                <img src={a.logo} alt={`${a.name} logo`} className="stack__agent-icon" loading="lazy" />
                <span className="stack__agent-name">{a.name}</span>
              </div>
            ))}
          </div>
          <span className="stack__agents-note">MCP-native. One config. Any agent.</span>
        </div>

        {/* Vertical stack diagram */}
        <div className="stack__diagram">
          {layers.map((layer, i) => (
            <div key={layer.tag} className="stack__layer-wrap">
              <div className={`stack__layer ${layer.accent ? "stack__layer--core" : ""}`}>
                <div className="stack__layer-tag">{layer.tag}</div>
                <div className="stack__layer-name">{layer.name}</div>
                <div className="stack__layer-desc">{layer.desc}</div>
                {layer.accent && <div className="stack__layer-badge">MCP</div>}
              </div>
              {i < layers.length - 1 && (
                <div className="stack__arrow" aria-hidden="true">
                  <ArrowDown size={18} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
