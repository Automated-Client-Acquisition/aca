import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

type CellState = "free" | "you" | "them" | "overlap" | "pinned";

type Cell = {
  state: CellState;
  label?: string;
  span?: number;
};

const DAYS = ["MON", "TUE", "WED", "THU", "FRI"];
const TIMES = ["09", "10", "11", "12", "13", "14", "15", "16", "17"];

// Each entry: day-time → Cell. Span > 1 means the cell continues for N slots.
const GRID: Record<string, Cell> = {
  "MON-09": { state: "you", label: "Pipeline review · Sam", span: 1 },
  "MON-13": { state: "you", label: "1:1 · Maya", span: 1 },
  "MON-15": { state: "them", span: 2 },
  "TUE-10": { state: "them", span: 1 },
  "TUE-11": { state: "you", label: "Investor update", span: 1 },
  "TUE-14": { state: "overlap", label: "Hartwood · qual call · 30m" },
  "TUE-16": { state: "you", label: "Board prep", span: 1 },
  "WED-09": { state: "them", span: 1 },
  "WED-11": { state: "overlap", label: "Hartwood · slot 2" },
  "WED-13": { state: "you", label: "Lunch · Will", span: 1 },
  "WED-16": { state: "them", span: 1 },
  "THU-09": { state: "you", label: "Marketing sync", span: 1 },
  "THU-10": { state: "you", label: "Demo · Catalyst", span: 1 },
  "THU-13": { state: "them", span: 1 },
  "THU-16": { state: "overlap", label: "Hartwood · slot 3" },
  "FRI-11": { state: "you", label: "Q3 forecast", span: 1 },
  "FRI-14": { state: "them", span: 1 },
  "FRI-15": { state: "you", label: "Town hall", span: 1 },
};

export function CalendarOverlapMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const [pinned, setPinned] = useState(false);
  const [countdown, setCountdown] = useState(23);

  useEffect(() => {
    if (!inView) return;
    const t1 = setTimeout(() => setPinned(true), 800);
    const t2 = setTimeout(() => setCountdown(22), 1600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      className="cal"
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.42, ease: easeOut }}
      aria-label="Booking module - proposed slots calendar"
    >
      <div className="cal__bar">
        <div className="cal__bar-l">
          <span className="cal__bar-icon">a.</span>
          <span className="cal__title">Booking module <span>· proposed slots</span></span>
        </div>
        <span className="chip chip--live">calendar in sync · 14m ago</span>
      </div>
      <div className="cal__grid">
        <div className="cal__col cal__col--head">
          <span className="cal__col-spacer" />
          {TIMES.map((t) => (
            <span key={t} className="cal__time">{t}</span>
          ))}
        </div>
        {DAYS.map((d) => (
          <div key={d} className="cal__col">
            <span className="cal__day">{d}</span>
            {TIMES.map((t) => {
              const key = `${d}-${t}`;
              const cell = GRID[key];
              const state: CellState = cell?.state || "free";
              const isPinned = pinned && key === "TUE-14";
              const cls = `cal__cell cal__cell--${isPinned ? "pinned" : state}`;
              return (
                <motion.span
                  key={t}
                  className={cls}
                  initial={state === "overlap" && !isPinned ? { boxShadow: "inset 0 0 0 1px rgba(212,54,26,0.2)" } : false}
                  animate={
                    state === "overlap" && !isPinned && inView
                      ? { boxShadow: ["inset 0 0 0 1px rgba(212,54,26,0.5)", "inset 0 0 0 1px rgba(212,54,26,0.5), 0 0 12px rgba(212,54,26,0.4)", "inset 0 0 0 1px rgba(212,54,26,0.5)"] }
                      : {}
                  }
                  transition={state === "overlap" ? { duration: 1.5, ease: easeOut } : undefined}
                >
                  {isPinned && (
                    <motion.div
                      className="cal__cell-pinned"
                      initial={{ scale: 0.9 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 320, damping: 18 }}
                    >
                      <span className="cal__cell-label">Hartwood · qual call</span>
                      <span className="cal__cell-meta">30 min · LK</span>
                    </motion.div>
                  )}
                  {!isPinned && cell?.label && (
                    <span className="cal__cell-label">{cell.label}</span>
                  )}
                </motion.span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="cal__legend">
        <span className="cal__legend-item"><i className="cal__swatch cal__swatch--you" /> your time</span>
        <span className="cal__legend-item"><i className="cal__swatch cal__swatch--them" /> their time</span>
        <span className="cal__legend-item"><i className="cal__swatch cal__swatch--overlap" /> proposed</span>
        <span className="cal__legend-item"><i className="cal__swatch cal__swatch--pinned" /> held</span>
        <span className="cal__hold">held · {countdown} min remaining</span>
      </div>
      <div className="cal__thread">
        <span className="cal__thread-av">LK</span>
        <div>
          <div className="cal__thread-name">Lena Kapoor <span className="cal__thread-co">· Hartwood</span></div>
          <div className="cal__thread-msg">"Tue 14:00 ET works - sending invite. Couple quick qs first?"</div>
        </div>
        <span className="cal__thread-time">just now</span>
      </div>
    </motion.div>
  );
}
