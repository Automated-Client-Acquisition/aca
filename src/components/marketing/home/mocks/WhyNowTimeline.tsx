import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { TIMELINE } from "../data";
import { easeOut } from "../motion";

export function WhyNowTimeline() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });

  return (
    <motion.div
      ref={ref}
      className="timeline"
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={{ hidden: {}, visible: { transition: { delayChildren: 0.1, staggerChildren: 0.15 } } }}
      aria-label="Why ACA exists in 2026 timeline"
    >
      <div className="timeline__rail">
        <motion.span
          className="timeline__line"
          initial={{ scaleX: 0 }}
          animate={inView ? { scaleX: 1 } : { scaleX: 0 }}
          transition={{ duration: 0.6, ease: easeOut }}
        />
        {TIMELINE.map((node) => (
          <motion.div
            key={node.title}
            className={`timeline__node ${node.here ? "timeline__node--here" : ""}`}
            variants={{
              hidden: { opacity: 0, y: 12 },
              visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } },
            }}
          >
            <span className="timeline__dot" />
            <div className="timeline__card">
              <span className="timeline__date">{node.date}</span>
              <h4 className="timeline__title">
                {node.title}
                {node.emphasis && <em> {node.emphasis}</em>}
              </h4>
              <p className="timeline__body">{node.body}</p>
              {node.here && (
                <motion.span
                  className="aca-stamp timeline__stamp"
                  initial={{ rotate: 6, scale: 0.7, opacity: 0 }}
                  animate={inView ? { rotate: -3, scale: 1, opacity: 1 } : {}}
                  transition={{ delay: 0.9, duration: 0.42, ease: easeOut, type: "spring", stiffness: 240, damping: 16 }}
                >
                  WE ARE HERE
                </motion.span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
