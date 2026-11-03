import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

export function BYOKFlowDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <motion.div
      ref={ref}
      className="byok-flow"
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.15, delayChildren: 0.1 } },
      }}
      aria-label="BYOK data flow: your AI provider → ACA → your bill"
    >
      <motion.div
        className="byok-flow__lane"
        variants={{
          hidden: { opacity: 0, y: 12 },
          visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: easeOut } },
        }}
      >
        <div className="byok-flow__card">
          <span className="byok-flow__cap">Your AI provider</span>
          <div className="byok-flow__chips">
            <span className="byok-flow__provider byok-flow__provider--anthropic">Anthropic</span>
            <span className="byok-flow__provider">OpenAI</span>
            <span className="byok-flow__provider">Google</span>
          </div>
          <div className="byok-flow__key">
            <span className="byok-flow__key-label">API key</span>
            <code>sk-ant-•••••••</code>
          </div>
          <div className="byok-flow__bill">
            <div className="byok-flow__bill-row">
              <span>List price · per 1M tokens</span>
              <span className="byok-flow__bill-amt">$15</span>
            </div>
            <div className="byok-flow__bill-row">
              <span>Direct billing</span>
              <span className="byok-flow__bill-amt">your card</span>
            </div>
            <div className="byok-flow__bill-row byok-flow__bill-row--note">
              <em>You set the model. You see the bill.</em>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        className="byok-flow__connector byok-flow__connector--left"
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { duration: 0.4 } },
        }}
      >
        <span className="byok-flow__line" />
        <span className="byok-flow__arrow">→</span>
        <span className="byok-flow__connector-label">tool call · MCP</span>
      </motion.div>

      <motion.div
        className="byok-flow__lane byok-flow__lane--center"
        variants={{
          hidden: { opacity: 0, y: 16, scale: 0.96 },
          visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: easeOut } },
        }}
      >
        <div className="byok-flow__card byok-flow__card--featured">
          <motion.span
            className="aca-stamp byok-flow__stamp"
            animate={{ rotate: [-4, -2, -4] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            0% MARKUP
          </motion.span>
          <span className="byok-flow__cap byok-flow__cap--inv">ACA orchestration</span>
          <div className="byok-flow__brand">aca<span className="dot">.</span></div>
          <div className="byok-flow__price">$67<small>/mo flat</small></div>
          <ul className="byok-flow__feat">
            <li>Preloaded research index</li>
            <li>14 live signal types</li>
            <li>Unlimited senders + mailboxes</li>
            <li>Unified inbox + booking</li>
          </ul>
          <div className="byok-flow__note byok-flow__note--inv">
            <span className="live-dot" /> running · five modules
          </div>
        </div>
      </motion.div>

      <motion.div
        className="byok-flow__connector byok-flow__connector--right"
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { duration: 0.4 } },
        }}
      >
        <span className="byok-flow__line" />
        <span className="byok-flow__arrow">→</span>
        <span className="byok-flow__connector-label">billed by provider</span>
      </motion.div>

      <motion.div
        className="byok-flow__lane"
        variants={{
          hidden: { opacity: 0, y: 12 },
          visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: easeOut } },
        }}
      >
        <div className="byok-flow__card">
          <span className="byok-flow__cap">Your bill · monthly</span>
          <div className="byok-flow__bill">
            <div className="byok-flow__bill-row">
              <span>Anthropic · model usage</span>
              <span className="byok-flow__bill-amt">$87</span>
            </div>
            <div className="byok-flow__bill-row">
              <span>aca. · orchestration</span>
              <span className="byok-flow__bill-amt">$67</span>
            </div>
            <div className="byok-flow__bill-row byok-flow__bill-row--total">
              <span>Total</span>
              <span className="byok-flow__bill-amt">$154</span>
            </div>
            <div className="byok-flow__bill-row byok-flow__bill-row--note">
              <em>vs $7,061 stack · -97.8%</em>
            </div>
          </div>
          <div className="byok-flow__shield">
            <span className="byok-flow__shield-icon">⛨</span>
            <div>
              <div className="byok-flow__shield-t">Zero proxy</div>
              <div className="byok-flow__shield-s">Your data never touches our model</div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
