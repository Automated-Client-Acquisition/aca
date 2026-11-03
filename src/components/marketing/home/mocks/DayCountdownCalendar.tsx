import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { ELEVEN_DAYS } from "../data";
import { easeOut } from "../motion";

const ICONS: Record<string, string> = {
  kickoff: "▶",
  config: "⚙",
  running: "✦",
  warm: "↗",
  booked: "✓",
};

export function DayCountdownCalendar() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <div ref={ref} className="countdown" aria-label="11-day path to first qualified meeting">
      <div className="countdown__head">
        <span>Median time to first qualified meeting · across active Pro customers</span>
      </div>
      <motion.div
        className="countdown__grid"
        initial="hidden"
        animate={inView ? "visible" : "hidden"}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } }}
      >
        {ELEVEN_DAYS.map((d, i) => {
          const fillPct = Math.min(100, (i / 10) * 100);
          const icon = ICONS[d.status] || "·";
          return (
            <motion.div
              key={d.day}
              className={`countdown__day countdown__day--${d.status} ${d.pinned ? "countdown__day--pinned" : ""}`}
              variants={{
                hidden: { opacity: 0, y: 8, scale: 0.96 },
                visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.36, ease: easeOut } },
              }}
            >
              <div className="countdown__day-head">
                <span className="countdown__num">DAY {String(d.day).padStart(2, "0")}</span>
                <span className="countdown__icon">{icon}</span>
              </div>
              {!d.pinned && (
                <>
                  <motion.span
                    className="countdown__bar"
                    initial={{ width: 0 }}
                    animate={inView ? { width: `${fillPct}%` } : { width: 0 }}
                    transition={{ duration: 0.42, ease: easeOut, delay: 0.4 + i * 0.05 }}
                  />
                  <span className="countdown__label">{d.label}</span>
                </>
              )}
              {d.pinned && (
                <motion.div
                  className="countdown__pin-wrap"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.42, ease: easeOut, delay: 1.0, type: "spring", stiffness: 240, damping: 18 }}
                >
                  <span className="aca-stamp countdown__stamp">BOOKED</span>
                  <div className="countdown__pin-content">
                    <span className="countdown__pin-icon">📌</span>
                    <span className="countdown__pin-label">{d.label}</span>
                  </div>
                  <div className="countdown__pin-meta">
                    <span className="channel-dot channel-dot--linkedin" />
                    LinkedIn · qualified · 30 min
                  </div>
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </motion.div>
      <p className="countdown__sub">
        <em>If we don't, you don't pay.</em> No survey. Email us, we refund.
      </p>
    </div>
  );
}
