import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

export function GuaranteeCertificate() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const [serial] = useState(() => `ACA-${String(Math.floor(Math.random() * 9000) + 1000)}-2026`);

  return (
    <motion.div
      ref={ref}
      className="cert"
      initial={{ opacity: 0, y: 20, rotate: -1 }}
      animate={inView ? { opacity: 1, y: 0, rotate: 0 } : {}}
      transition={{ duration: 0.6, ease: easeOut }}
      aria-label="11-day money-back guarantee certificate"
    >
      <div className="cert__corner cert__corner--tl" />
      <div className="cert__corner cert__corner--tr" />
      <div className="cert__corner cert__corner--bl" />
      <div className="cert__corner cert__corner--br" />

      <div className="cert__head">
        <span className="cert__head-cap">aca. · the guarantee</span>
        <span className="cert__serial">№ {serial}</span>
      </div>

      <div className="cert__title">
        <span>FIRST QUALIFIED MEETING ·</span>
        <span>OR EVERY DOLLAR BACK</span>
      </div>

      <motion.div
        className="cert__stamp"
        initial={{ scale: 0.6, rotate: 8, opacity: 0 }}
        animate={inView ? { scale: 1, rotate: -4, opacity: 1 } : {}}
        transition={{ duration: 0.5, delay: 0.4, type: "spring", stiffness: 220, damping: 16 }}
      >
        <div className="cert__stamp-ring">
          <div className="cert__stamp-inner">
            <span className="cert__stamp-num">11</span>
            <span className="cert__stamp-unit">DAYS</span>
          </div>
        </div>
      </motion.div>

      <div className="cert__bet">
        <div className="cert__bet-side">
          <span className="cert__bet-cap">If a meeting books</span>
          <span className="cert__bet-amt">$67</span>
          <span className="cert__bet-meta">monthly · no seat tax</span>
        </div>
        <span className="cert__bet-vs">vs</span>
        <div className="cert__bet-side cert__bet-side--free">
          <span className="cert__bet-cap">If it doesn't</span>
          <span className="cert__bet-amt">$0</span>
          <span className="cert__bet-meta">every dollar back</span>
        </div>
      </div>

      <div className="cert__terms">
        <span className="cert__terms-cap">The terms</span>
        <ul>
          <li>You email us within 11 days</li>
          <li>We refund every dollar paid</li>
          <li>No survey · no defense · no "let me show you the dashboard"</li>
        </ul>
      </div>

      <div className="cert__sig">
        <div className="cert__sig-line">
          <span className="cert__sig-name">Cedric Seguela</span>
          <span className="cert__sig-role">founder · aca.</span>
        </div>
        <div className="cert__sig-stamp">SIGNED · MARCH 2026</div>
      </div>
    </motion.div>
  );
}
