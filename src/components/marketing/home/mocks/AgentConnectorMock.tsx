import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";
import { AGENTS, AgentLogo } from "../AgentLogos";

export function AgentConnectorMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [inView]);

  const connected = AGENTS[0]; // Claude Desktop

  return (
    <motion.div
      ref={ref}
      className="agent-conn"
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.42, ease: easeOut }}
      aria-label="Agent connector - works with any MCP client"
    >
      <div className="agent-conn__bar">
        <span className="agent-conn__bar-icon">a.</span>
        <span className="agent-conn__bar-title">Agent · settings</span>
        <span className="chip chip--live">connected</span>
      </div>

      <div className="agent-conn__field">
        <label>Connected agent</label>
        <button
          className={`agent-conn__select ${open ? "agent-conn__select--open" : ""}`}
          onClick={() => setOpen((o) => !o)}
        >
          <AgentLogo agent={connected} size={16} />
          <span className="agent-conn__select-name">{connected.name}</span>
          <span className="agent-conn__select-meta">{connected.meta} · MCP</span>
          <span className="agent-conn__select-status" />
          <span className="agent-conn__select-caret">▾</span>
        </button>
      </div>

      {open && (
        <motion.div
          className="agent-conn__dropdown"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: easeOut }}
        >
          <div className="agent-conn__dropdown-head">Switch agent · all MCP-native</div>
          {AGENTS.map((a) => (
            <div key={a.key} className={`agent-conn__option ${a.key === connected.key ? "agent-conn__option--active" : ""}`}>
              <AgentLogo agent={a} size={14} />
              <span className="agent-conn__option-name">{a.name}</span>
              <span className="agent-conn__option-meta">{a.meta}</span>
              {a.key === connected.key && <span className="agent-conn__option-badge">active</span>}
            </div>
          ))}
          <div className="agent-conn__dropdown-foot">
            + bring any MCP-native client. We never ask which one.
          </div>
        </motion.div>
      )}

      <div className="agent-conn__field">
        <label>MCP server URL</label>
        <code className="agent-conn__code">https://api.aca.so/mcp/v1</code>
      </div>

      <div className="agent-conn__field">
        <label>Your API key</label>
        <code className="agent-conn__code agent-conn__code--key">sk-ant-•••••••••••</code>
        <span className="agent-conn__field-meta">billed direct to your Anthropic account</span>
      </div>
    </motion.div>
  );
}
