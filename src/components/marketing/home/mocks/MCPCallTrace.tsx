import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

const TOOL_CALL = `aca.research.search({
  icp: "series-a-saas-eu",
  signals: ["hiring:sdr", "intent:pricing"],
  limit: 10
})`;

const RESPONSE_ROWS = [
  { logo: "H", logoCls: "logo--a", co: "Hartwood", score: 92, signal: "pricing page · 2nd visit · 3d ago" },
  { logo: "P", logoCls: "logo--c", co: "Plenum", score: 84, signal: "hiring 2 SDRs · last 14d" },
  { logo: "G", logoCls: "logo--e", co: "Greypine", score: 76, signal: "swapped Salesloft → none" },
];

export function MCPCallTrace() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const [typed, setTyped] = useState(0);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!inView) return;
    let i = 0;
    const total = TOOL_CALL.length;
    const interval = setInterval(() => {
      i += 2;
      if (i >= total) {
        i = total;
        clearInterval(interval);
        setTimeout(() => setResolved(true), 400);
      }
      setTyped(i);
    }, 14);
    return () => clearInterval(interval);
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      className="mcp-trace"
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: easeOut }}
      aria-label="Claude calling ACA via MCP"
    >
      <div className="mcp-trace__chrome">
        <div className="mcp-trace__chrome-l">
          <span className="mcp-trace__dot mcp-trace__dot--r" />
          <span className="mcp-trace__dot mcp-trace__dot--y" />
          <span className="mcp-trace__dot mcp-trace__dot--g" />
        </div>
        <span className="mcp-trace__title">claude.ai · research Hartwood</span>
        <span className="mcp-trace__chrome-meta">via MCP</span>
      </div>

      <div className="mcp-trace__body">
        <div className="mcp-trace__stage">
          <div className="mcp-trace__stage-head">
            <span className="mcp-trace__stage-num">01</span>
            <span className="mcp-trace__stage-label">You ask Claude</span>
          </div>
          <div className="mcp-trace__msg mcp-trace__msg--user">
            "Find me 10 Series A SaaS in Western Europe hiring SDRs whose buyers visited our pricing page in the last 30 days."
          </div>
        </div>

        <div className="mcp-trace__connector">
          <span className="mcp-trace__connector-line" />
          <span className="mcp-trace__connector-arrow">↓</span>
        </div>

        <div className="mcp-trace__stage">
          <div className="mcp-trace__stage-head">
            <span className="mcp-trace__stage-num">02</span>
            <span className="mcp-trace__stage-label">Claude calls ACA over MCP</span>
            <span className="mcp-trace__latency">142ms</span>
          </div>
          <div className="mcp-trace__call-card">
            <div className="mcp-trace__call-bar">
              <span className="mcp-trace__call-bar-icon">⌘</span>
              <span>tool call · <code>aca.research.search</code></span>
              <span className="mcp-trace__call-bar-key">your Anthropic key</span>
            </div>
            <pre className="mcp-trace__code">
              <code>{typed >= TOOL_CALL.length ? TOOL_CALL : TOOL_CALL.slice(0, typed)}</code>
              {typed < TOOL_CALL.length && (
                <motion.span className="mcp-trace__caret" animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />
              )}
            </pre>
          </div>
        </div>

        <div className="mcp-trace__connector">
          <span className="mcp-trace__connector-line" />
          <span className="mcp-trace__connector-arrow">↓</span>
        </div>

        <div className="mcp-trace__stage">
          <div className="mcp-trace__stage-head">
            <span className="mcp-trace__stage-num">03</span>
            <span className="mcp-trace__stage-label">ACA returns 10 ranked accounts</span>
            {resolved && <span className="mcp-trace__stage-meta">3.1s · enriched + scored</span>}
          </div>
          <div className="mcp-trace__result">
            {!resolved ? (
              <>
                <div className="mcp-trace__result-row mcp-trace__result-row--loading"><span className="cell-shimmer" style={{ width: "100%", height: 14 }} /></div>
                <div className="mcp-trace__result-row mcp-trace__result-row--loading"><span className="cell-shimmer" style={{ width: "92%", height: 14 }} /></div>
                <div className="mcp-trace__result-row mcp-trace__result-row--loading"><span className="cell-shimmer" style={{ width: "88%", height: 14 }} /></div>
              </>
            ) : (
              <>
                {RESPONSE_ROWS.map((row, i) => (
                  <motion.div
                    key={row.co}
                    className="mcp-trace__result-row"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.32, ease: easeOut, delay: i * 0.08 }}
                  >
                    <span className={`logo ${row.logoCls}`}>{row.logo}</span>
                    <div className="mcp-trace__result-body">
                      <span className="mcp-trace__result-name">{row.co}</span>
                      <span className="mcp-trace__signal">
                        <span className="mcp-trace__signal-dot" /> {row.signal}
                      </span>
                    </div>
                    <div className="mcp-trace__result-score">
                      <span className="mcp-trace__score-num">{row.score}</span>
                      <span className="mcp-trace__score-label">match</span>
                    </div>
                  </motion.div>
                ))}
                <motion.div
                  className="mcp-trace__result-more"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.32, delay: 0.32 }}
                >
                  + 7 more accounts · scroll to see them, or pipe to messaging module →
                </motion.div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mcp-trace__foot">
        <div className="mcp-trace__foot-item">
          <span className="mcp-trace__foot-icon">$</span>
          <div>
            <div className="mcp-trace__foot-t">$0 markup on this call</div>
            <div className="mcp-trace__foot-s">ACA charges nothing for the inference</div>
          </div>
        </div>
        <div className="mcp-trace__foot-item">
          <span className="mcp-trace__foot-icon mcp-trace__foot-icon--key">🔑</span>
          <div>
            <div className="mcp-trace__foot-t">Billed to your Anthropic key</div>
            <div className="mcp-trace__foot-s">~$0.04 for this query · your model</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
