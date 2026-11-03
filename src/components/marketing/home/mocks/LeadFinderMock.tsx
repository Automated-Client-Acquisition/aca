import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

type Source = { id: string; label: string; meta: string; on: boolean };

const SOURCES: Source[] = [
  { id: "index", label: "Preloaded index", meta: "starting point", on: true },
  { id: "crm", label: "Your CRM", meta: "HubSpot · 8.2K", on: true },
  { id: "custom", label: "Custom · podcast guests", meta: "we built for you", on: true },
  { id: "signals", label: "Live signals", meta: "14 types · open web", on: true },
];

type Result = {
  logo: string;
  logoCls: string;
  co: string;
  meta: string;
  signal: string;
  source: "index" | "crm" | "custom" | "signals";
  score: number;
};

const RESULTS: Result[] = [
  { logo: "H", logoCls: "logo--a", co: "Hartwood", meta: "RevOps SaaS · Series B", signal: "pricing page · 2nd visit · 3d", source: "signals", score: 92 },
  { logo: "N", logoCls: "logo--b", co: "Northbound", meta: "B2B agency · 50-200", signal: "podcast guest · last 5d", source: "custom", score: 88 },
  { logo: "P", logoCls: "logo--c", co: "Plenum", meta: "GTM SaaS · Series B", signal: "hiring 2 SDRs · 14d", source: "index", score: 84 },
  { logo: "G", logoCls: "logo--e", co: "Greypine", meta: "Fintech · Series A", signal: "swapped Salesloft → none", source: "signals", score: 76 },
  { logo: "A", logoCls: "logo--d", co: "Ardent Labs", meta: "AI infra · Series A", signal: "in your CRM · last touch 47d", source: "crm", score: 71 },
];

const SOURCE_LABEL: Record<Result["source"], string> = {
  index: "preloaded",
  crm: "your CRM",
  custom: "custom",
  signals: "signals",
};

export function LeadFinderMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const [count, setCount] = useState(1284);

  useEffect(() => {
    if (!inView) return;
    const i = setInterval(() => setCount((c) => c + Math.floor(Math.random() * 3) + 1), 2400);
    return () => clearInterval(i);
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      className="finder"
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.42, ease: easeOut }}
      aria-label="Lead finder - multi-source list builder"
    >
      <div className="finder__bar">
        <div className="finder__bar-l">
          <span className="finder__bar-icon">a.</span>
          <span className="finder__bar-title">List builder <span>· 4 sources combined</span></span>
        </div>
        <span className="chip chip--live">live · re-ranked every 4m</span>
      </div>

      <div className="finder__section">
        <span className="finder__section-label">Sources active</span>
        <div className="finder__chips">
          {SOURCES.map((s) => (
            <span key={s.id} className={`finder__source finder__source--${s.id}`}>
              <span className="finder__source-dot" />
              <span className="finder__source-name">{s.label}</span>
              <span className="finder__source-meta">{s.meta}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="finder__section">
        <span className="finder__section-label">ICP filter</span>
        <div className="finder__chips">
          <span className="finder__filter">Industry · <b>B2B SaaS</b></span>
          <span className="finder__filter">Size · <b>50-500</b></span>
          <span className="finder__filter">Role · <b>VP RevOps / GTM</b></span>
          <span className="finder__filter finder__filter--accent">Signal · <b>pricing visit · 30d</b></span>
        </div>
      </div>

      <div className="finder__section finder__section--results">
        <div className="finder__results-head">
          <span className="finder__section-label">Results</span>
          <motion.span
            key={count}
            className="finder__count"
            initial={{ scale: 1.04 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.3, ease: easeOut }}
          >
            <b>{count.toLocaleString()}</b> matches
          </motion.span>
        </div>
        <motion.div
          className="finder__list"
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } } }}
        >
          {RESULTS.map((r) => (
            <motion.div
              className="finder__row"
              key={r.co}
              variants={{
                hidden: { opacity: 0, x: -6 },
                visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: easeOut } },
              }}
            >
              <span className={`logo ${r.logoCls}`}>{r.logo}</span>
              <div className="finder__row-body">
                <div className="finder__row-name">{r.co} <span>· {r.meta}</span></div>
                <div className="finder__row-signal">
                  <span className="finder__signal-dot" />
                  {r.signal}
                </div>
              </div>
              <span className={`finder__source-tag finder__source-tag--${r.source}`}>{SOURCE_LABEL[r.source]}</span>
              <div className="finder__row-score">
                <span className="finder__row-score-num">{r.score}</span>
                <span className="finder__row-score-label">match</span>
              </div>
            </motion.div>
          ))}
          <div className="finder__row finder__row--more">
            <span className="finder__row-more-txt">+ {(count - RESULTS.length).toLocaleString()} more · scroll or pipe to messaging module →</span>
          </div>
        </motion.div>
      </div>

      <div className="finder__foot">
        <span>Scored across 4 sources · re-ranked every 4 min</span>
        <span className="finder__foot-cta">Pipe → messaging</span>
      </div>
    </motion.div>
  );
}
