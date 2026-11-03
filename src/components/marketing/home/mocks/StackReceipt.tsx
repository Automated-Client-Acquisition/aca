import { useEffect, useState } from "react";
import { motion, useMotionValue, useTransform, animate, useInView } from "framer-motion";
import { useRef } from "react";
import { COMPARE_LINES, COMPARE_TOTAL, type CompareLine } from "../data";
import { easeOut } from "../motion";

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

function AnimatedNumber({ to, duration = 0.8, run, prefix = "$" }: { to: number; duration?: number; run: boolean; prefix?: string }) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => `${prefix}${fmt(v)}`);
  useEffect(() => {
    if (!run) return;
    const controls = animate(mv, to, { duration, ease: easeOut });
    return controls.stop;
  }, [run, to, duration, mv]);
  return <motion.span>{display}</motion.span>;
}

function ReceiptLine({ line, index, run }: { line: CompareLine; index: number; run: boolean }) {
  return (
    <motion.li
      className="receipt__line"
      initial={{ opacity: 0, y: 6 }}
      animate={run ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
      transition={{ duration: 0.32, ease: easeOut, delay: 0.1 + index * 0.07 }}
    >
      <span className="receipt__line-label">
        <em>{line.label}</em>
        <span className="receipt__line-sub">{line.replaces}</span>
      </span>
      <span className="receipt__line-leader" aria-hidden />
      <span className="receipt__line-amt">
        <AnimatedNumber to={line.cost} duration={0.55} run={run} />
      </span>
    </motion.li>
  );
}

export function StackReceipt({ teaser = false }: { teaser?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const timers = [
      setTimeout(() => setStage(1), 120),
      setTimeout(() => setStage(2), 1500),
      setTimeout(() => setStage(3), 2300),
      setTimeout(() => setStage(4), 2900),
    ];
    return () => timers.forEach(clearTimeout);
  }, [inView]);

  return (
    <div ref={ref} className={`receipt ${teaser ? "receipt--teaser" : ""}`} aria-label="Cost comparison: legacy outbound stack versus ACA">
      <motion.div
        className="receipt__top"
        animate={stage >= 3 ? { y: -10, rotate: 0.6 } : { y: 0, rotate: 0 }}
        transition={{ duration: 0.5, ease: easeOut }}
      >
        <motion.div
          className="receipt__head"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.32 }}
        >
          <span>AI AGENTIC SDR</span>
          <span>MARCH 2026</span>
        </motion.div>
        <div className="receipt__sub">
          <span>What "an AI SDR" actually runs on</span>
          <span className="receipt__sub-meta">7 line items · 1 motion</span>
        </div>
        <ul className="receipt__lines">
          {COMPARE_LINES.map((line, i) => (
            <ReceiptLine key={line.label} line={line} index={i} run={stage >= 1} />
          ))}
        </ul>
        <motion.div
          className="receipt__total"
          initial={{ opacity: 0 }}
          animate={stage >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.36, ease: easeOut }}
        >
          <span>TOTAL</span>
          <span className="receipt__total-amt">
            <AnimatedNumber to={COMPARE_TOTAL} duration={0.9} run={stage >= 2} />
          </span>
        </motion.div>
        <div className="receipt__tear" aria-hidden>
          <span className="receipt__tear-label">tear here</span>
          <span className="receipt__tear-icon">✂</span>
        </div>
      </motion.div>

      <motion.div
        className="receipt__bottom"
        initial={{ opacity: 0, y: 10 }}
        animate={stage >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ duration: 0.42, ease: easeOut }}
      >
        <div className="receipt__head receipt__head--aca">
          <span>aca<span className="dot">.</span> · same AI SDR motion</span>
          <span>MARCH 2026</span>
        </div>
        <div className="receipt__aca-line">
          <span className="receipt__line-label">
            <em>Full AI agentic SDR · in ACA</em>
            <span className="receipt__line-sub">research · messaging · inbound · replies · booking</span>
          </span>
          <span className="receipt__line-leader" aria-hidden />
          <span className="receipt__line-amt receipt__line-amt--big">
            <AnimatedNumber to={67} duration={0.5} run={stage >= 3} />
          </span>
        </div>
        <motion.div
          className="receipt__savings"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={stage >= 4 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.32, ease: easeOut }}
        >
          <span>
            <AnimatedNumber to={6994} duration={0.7} run={stage >= 4} prefix="−$" /> saved every month
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
