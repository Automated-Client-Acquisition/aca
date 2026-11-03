import { WhyNowTimeline, MCPCallTrace } from "./mocks";

export function WhyNowSection() {
  return (
    <section id="why-now" className="section">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">Why now</span>
          <h2 className="h-section">
            This is what <em>AI-native outbound</em><br />was supposed to be<span className="dot">.</span>
          </h2>
          <p className="lead">
            Two years ago, "let your AI run outbound" was a pitch deck fantasy. The models weren't capable enough. There was no protocol for tools to talk to agents reliably. Every "AI SDR" startup was secretly just a templated email sender with GPT-3.5 stitched on top.
          </p>
          <p className="lead">
            Three things changed.
          </p>
        </header>

        <WhyNowTimeline />

        <div className="why-now__split">
          <div className="why-now__copy body-prose">
            <p>
              Frontier models got good enough to actually reason about a sales conversation, not just generate text. MCP arrived as a standard protocol so any AI client can call any tool without bespoke integration. And the cost of running real inference dropped to the point where you can afford to have your AI think hard about every single prospect.
            </p>
            <p>
              What's missing - what's been missing - is the infrastructure layer underneath. The boring, expensive part: deliverability, lead data, LinkedIn sender pools, calendar logic, reply detection, signal monitoring. The plumbing.
            </p>
            <p className="body-prose__emph">
              <em>Without it, your AI can write outbound. With it, your AI can run outbound.</em>
            </p>
            <p className="body-prose__close">
              That's what ACA is. The plumbing.
            </p>
          </div>
          <div className="why-now__mock">
            <MCPCallTrace />
          </div>
        </div>
      </div>
    </section>
  );
}
