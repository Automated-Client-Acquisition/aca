import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

const PLAN = [
  {
    h: "Now · research module",
    items: [
      { done: true, text: "Pulled enrichment from open web", meta: "3.1s" },
      { done: true, text: "Detected trigger: pricing-page · 2nd visit", meta: "92 score" },
      { done: true, text: "Synthesized buyer brief · 1 page", meta: "claude-opus-4-7" },
    ],
  },
  {
    h: "Now · messaging module",
    items: [
      { done: true, text: "Drafted first-touch in your voice", meta: "92% match" },
      { done: true, text: "Routed via warmed mailbox · founder@your-out01.com", meta: "rep score 98" },
      { done: false, text: "Awaiting positive reply", meta: "live · 14m" },
    ],
  },
  {
    h: "Next · booking module",
    items: [
      { done: false, text: "Find calendar overlap · 3 slots" },
      { done: false, text: "Ask 2 qualifying questions in-thread" },
      { done: false, text: "Hold slot · attach brief to invite" },
    ],
  },
];

export function NotionPlanMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <motion.div
      ref={ref}
      className="pbm-notion plan-notion"
      initial={{ opacity: 0, y: 14 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: easeOut }}
      aria-label="ACA's plan for one prospect, surfaced as a doc"
    >
      <div className="pbm-notion__bar">
        <div className="pbm-notion__icon">N</div>
        <span className="pbm-notion__name">Plan · Hartwood · live</span>
        <span className="chip chip--live plan-notion__live">running</span>
      </div>
      <div className="pbm-notion__body">
        <div className="pbm-notion__title plan-notion__title">Book Lena Kapoor at Hartwood <em>by Thursday<span className="dot">.</span></em></div>
        <div className="pbm-notion__meta">For: ACA orchestration · directed by your AI · 11-day window</div>
        {PLAN.map((section, sIdx) => (
          <motion.div
            key={section.h}
            initial="hidden"
            animate={inView ? "visible" : "hidden"}
            variants={{ hidden: {}, visible: { transition: { delayChildren: 0.3 + sIdx * 0.2, staggerChildren: 0.06 } } }}
          >
            <div className="pbm-notion__h">{section.h}</div>
            {section.items.map((item) => (
              <motion.div
                key={item.text}
                className="pbm-notion__line"
                variants={{
                  hidden: { opacity: 0, x: -6 },
                  visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: easeOut } },
                }}
              >
                <span className={`pbm-notion__check ${item.done ? "pbm-notion__check--done" : ""}`} />
                <span className="plan-notion__text">{item.text}</span>
                {item.meta && <span className="plan-notion__meta">{item.meta}</span>}
              </motion.div>
            ))}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
