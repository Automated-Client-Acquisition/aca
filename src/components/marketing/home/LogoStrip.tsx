import { AGENTS, AgentLogo } from "./AgentLogos";

export function LogoStrip() {
  return (
    <section className="logo-strip" aria-label="Compatible AI agents">
      <div className="wrap logo-strip__inner">
        <div className="logo-strip__head">
          <span className="logo-strip__cap">Works natively with the AI agents you already use</span>
          <span className="logo-strip__protocol">
            <span className="logo-strip__protocol-dot" />
            via Model Context Protocol · no glue code
          </span>
        </div>
        <div className="logo-strip__grid">
          {AGENTS.map((a) => (
            <div key={a.key} className="logo-strip__cell">
              <AgentLogo agent={a} size={26} />
              <span className="logo-strip__cell-name">{a.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
