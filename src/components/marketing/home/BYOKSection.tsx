import { AgentConnectorMock } from "./mocks";

const REASONS = [
  {
    n: "01",
    t: "Cost",
    body: "You pay model providers directly at their list price. No 40% middle-layer tax. On a serious outbound motion, that's $1,500 to $3,000 a month back in your pocket.",
  },
  {
    n: "02",
    t: "Security",
    body: "Your security team approves the integration in days, not months, because no prospect data ever touches a vendor model. The conversation happens between your AI and your data. We're a tool, not a processor.",
  },
  {
    n: "03",
    t: "Leverage",
    body: "When the next better model ships - and one ships every six weeks now - you switch instantly. You're not waiting for a vendor's \"we now support Claude 5\" announcement. You change a key. Or switch to a different agent entirely - Claude Code, Cowork, Cursor, Cline, OpenClaw, Hermes - the orchestration layer doesn't care.",
  },
];

export function BYOKSection() {
  return (
    <section id="byok" className="section">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">The moat</span>
          <h2 className="h-section">
            Your AI. <em>Your keys. Your bill<span className="dot">.</span></em>
          </h2>
          <p className="lead">
            Every "AI SDR" platform marks up a vendor model 30 to 50%, runs your outbound through a model you didn't choose, and locks you in. ACA can't do that - we never had a model in the first place. Plug in Claude Desktop, Claude Code, Cowork, Cursor, Cline, OpenClaw, Hermes, or any other MCP-native agent. We connect to it. We never replace it.
          </p>
        </header>

        <div className="byok-hero">
          <AgentConnectorMock />
        </div>

        <p className="byok-cost__note byok-cost__note--standalone">
          <em>We never proxy a token.</em> Your conversation goes from your agent to your AI provider, directly. ACA only sees the tool call.
        </p>

        <div className="byok-reasons">
          {REASONS.map((r) => (
            <div key={r.n} className="byok-reason">
              <span className="byok-reason__n">{r.n}</span>
              <h3 className="byok-reason__t">{r.t}</h3>
              <p>{r.body}</p>
            </div>
          ))}
        </div>

        <p className="byok-close">
          <em>This is the part nobody else can copy without burning their own margin.</em> It's the reason ACA still works in 2027 when every "AI SDR" startup has either pivoted or quietly shut down.
        </p>
      </div>
    </section>
  );
}
