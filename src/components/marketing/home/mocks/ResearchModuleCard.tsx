import { useRef } from "react";
import { motion, useMotionValue, useTransform, animate, useInView } from "framer-motion";
import { useEffect } from "react";
import { easeOut } from "../motion";

export function ResearchModuleCard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const score = useMotionValue(0);
  const scoreText = useTransform(score, (v) => Math.round(v));
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = useTransform(score, (v) => circumference * (1 - v / 100));

  useEffect(() => {
    if (!inView) return;
    const ctrl = animate(score, 92, { duration: 1.2, ease: easeOut });
    return ctrl.stop;
  }, [inView, score]);

  return (
    <motion.div
      ref={ref}
      className="dossier"
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.45, ease: easeOut }}
      aria-label="Research module output for Hartwood"
    >
      <div className="dossier__bar">
        <span className="dossier__id">Research module · output</span>
        <span className="chip chip--live">refreshed 14m ago</span>
      </div>
      <div className="dossier__hero">
        <div className="dossier__logo">H</div>
        <div>
          <div className="dossier__co">Hartwood</div>
          <div className="dossier__meta">RevOps SaaS · Series B · 240 employees · London</div>
        </div>
        <div className="dossier__match">
          <svg width="56" height="56" viewBox="0 0 56 56" className="match-ring">
            <circle cx="28" cy="28" r={radius} fill="none" stroke="var(--rule)" strokeWidth="3" />
            <motion.circle
              cx="28"
              cy="28"
              r={radius}
              fill="none"
              stroke="var(--mark)"
              strokeWidth="3"
              strokeDasharray={circumference}
              style={{ strokeDashoffset: offset }}
              strokeLinecap="round"
              transform="rotate(-90 28 28)"
            />
            <text x="28" y="33" textAnchor="middle" className="match-ring__num">
              <motion.tspan>{scoreText}</motion.tspan>
            </text>
          </svg>
          <div className="dossier__match__l">match · 100</div>
        </div>
      </div>
      <motion.div
        className="dossier__body"
        initial="hidden"
        animate={inView ? "visible" : "hidden"}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06, delayChildren: 0.3 } } }}
      >
        {[
          { lab: "Buyer", val: <>Lena Kapoor · VP Ops</> },
          { lab: "Stack", val: <>HubSpot · <em>Salesloft</em> · Gong</> },
          { lab: "Hiring", val: <>3 SDRs in last 30 days</> },
          { lab: "Last raise", val: <>$48M · Series B · Mar '26</> },
        ].map((f) => (
          <motion.div
            key={f.lab}
            className="dossier__field"
            variants={{ hidden: { opacity: 0, y: 4 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}
          >
            <span className="lab">{f.lab}</span>
            <span className="val">{f.val}</span>
          </motion.div>
        ))}
      </motion.div>
      <motion.div
        className="dossier__signal"
        initial={{ opacity: 0, x: -6 }}
        animate={inView ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.45, ease: easeOut, delay: 0.7 }}
      >
        <div className="dossier__signal__icon">!</div>
        <div className="dossier__signal__body">
          <b>Trigger · LinkedIn post · 14m</b>
          <q>Our outbound is dead. Spending $7K/mo on tools and getting 4 meetings a quarter. Looking for a better way.</q>
        </div>
      </motion.div>
    </motion.div>
  );
}
