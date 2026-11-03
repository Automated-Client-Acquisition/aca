import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HERO_ROWS, HERO_LATE_ROW, type HeroRow } from "../data";
import { easeOut } from "../motion";

function StageLabel({ stage }: { stage: HeroRow["stage"] }) {
  const labels = { booked: "Booked", replied: "Replied", sent: "Sent", enriching: "Enriching" };
  return <span className={`cell-stage stage--${stage}`}>{labels[stage]}</span>;
}

export function HeroTable() {
  const [showLate, setShowLate] = useState(false);
  const [lateResolved, setLateResolved] = useState(false);
  const [signalCount, setSignalCount] = useState(312);

  useEffect(() => {
    const t1 = setTimeout(() => setShowLate(true), 2400);
    const t2 = setTimeout(() => setLateResolved(true), 3300);
    const interval = setInterval(() => setSignalCount((c) => c + Math.floor(Math.random() * 3) + 1), 2400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(interval);
    };
  }, []);

  return (
    <motion.div
      className="table-wrap"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: easeOut, delay: 0.15 }}
      aria-label="ACA workspace preview · live prospect table"
    >
      <div className="table-bar">
        <div className="table-bar__left">
          <span className="table-bar__icon">a.</span>
          <span className="table-bar__name">
            ICP · Series A SaaS<span> · Western Europe · 1,284 accounts</span>
          </span>
        </div>
        <div className="table-bar__right">
          <span className="chip chip--ai">5 modules running</span>
          <motion.span
            key={signalCount}
            className="chip chip--live"
            initial={{ scale: 1.05 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.3, ease: easeOut }}
          >
            <span className="live-dot" /> {signalCount} signals today
          </motion.span>
        </div>
      </div>
      <table className="grid-table">
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th><span className="col-icon">A</span>Company</th>
            <th><span className="col-icon">B</span>Buyer</th>
            <th className="col-ai"><span className="col-icon">✦</span>Trigger signal</th>
            <th className="col-ai"><span className="col-icon">✦</span>Match</th>
            <th><span className="col-icon">D</span>Stage</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence>
            {showLate && (
              <motion.tr
                key="late"
                initial={{ opacity: 0, height: 0, backgroundColor: "rgba(212,54,26,0.10)" }}
                animate={{ opacity: 1, height: "auto", backgroundColor: "rgba(212,54,26,0)" }}
                transition={{ duration: 0.5, ease: easeOut }}
              >
                <td className="cell-rownum">00</td>
                <td>
                  <div className="cell-co">
                    <div className={"logo " + HERO_LATE_ROW.logoCls}>{HERO_LATE_ROW.logo}</div>
                    <div>
                      <div className="cell-name">{HERO_LATE_ROW.co}</div>
                      <div className="cell-sub">{HERO_LATE_ROW.domain}</div>
                    </div>
                  </div>
                </td>
                <td>{lateResolved ? HERO_LATE_ROW.role : <span className="cell-shimmer" style={{ width: 140 }} />}</td>
                <td className="cell-trigger">
                  {lateResolved ? (
                    <span className="cell-trigger-live">
                      <i className="live-dot" /> {HERO_LATE_ROW.trigger}
                    </span>
                  ) : (
                    <span className="cell-shimmer" style={{ width: 130 }} />
                  )}
                </td>
                <td>
                  {lateResolved && HERO_LATE_ROW.score ? (
                    <div className="cell-score">
                      <span className="cell-score__num">{HERO_LATE_ROW.score}</span>
                      <span className="cell-score__bar">
                        <i style={{ width: HERO_LATE_ROW.score + "%" }} />
                      </span>
                    </div>
                  ) : (
                    <span className="cell-shimmer" style={{ width: 56 }} />
                  )}
                </td>
                <td><StageLabel stage={HERO_LATE_ROW.stage} /></td>
              </motion.tr>
            )}
          </AnimatePresence>
          {HERO_ROWS.map((r, i) => (
            <motion.tr
              key={r.co}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: easeOut, delay: 0.4 + i * 0.07 }}
            >
              <td className="cell-rownum">{String(i + 1).padStart(2, "0")}</td>
              <td>
                <div className="cell-co">
                  <div className={"logo " + r.logoCls}>{r.logo}</div>
                  <div>
                    <div className="cell-name">{r.co}</div>
                    <div className="cell-sub">{r.domain}</div>
                  </div>
                </div>
              </td>
              <td>{r.role ? r.role : <span className="cell-shimmer" style={{ width: 140 }} />}</td>
              <td className="cell-trigger">
                {r.trigger ? r.trigger : <span className="cell-shimmer" style={{ width: 110 }} />}
              </td>
              <td>
                {r.score ? (
                  <div className="cell-score">
                    <span className="cell-score__num">{r.score}</span>
                    <span className="cell-score__bar">
                      <i style={{ width: r.score + "%" }} />
                    </span>
                  </div>
                ) : (
                  <span className="cell-shimmer" style={{ width: 56 }} />
                )}
              </td>
              <td><StageLabel stage={r.stage} /></td>
            </motion.tr>
          ))}
        </tbody>
      </table>
      <div className="table-foot">
        <span className="table-foot__count">
          <b>1,284</b> rows · 312 enriched today · 27 booked this week
        </span>
        <span className="chip chip--ai">claude-opus-4-7 · BYO key</span>
      </div>
    </motion.div>
  );
}
