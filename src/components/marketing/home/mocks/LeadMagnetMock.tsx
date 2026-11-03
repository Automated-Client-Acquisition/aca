import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate, useInView } from "framer-motion";
import { easeOut } from "../motion";

const CHAPTERS = [
  { n: "01", title: "The 2026 RevOps stack - what's actually working", words: 1247 },
  { n: "02", title: "The hidden cost of stale lead data at Series B+", words: 982 },
  { n: "03", title: "Why your SDR team's reply rate dropped 40% in 18 months", words: 1418 },
  { n: "04", title: "The cost-per-qualified-meeting math nobody runs", words: 1106 },
  { n: "05", title: "Sender pool architecture for sub-$100 CAC outbound", words: 1573 },
  { n: "06", title: "MCP-native GTM: the 12-month bet I'd make on $1M", words: 988 },
  { n: "07", title: "Three numbers Hartwood should hit by Q3 · benchmarks", words: 1212 },
  { n: "08", title: "What I'd cut, keep, or 10x · my honest read on your stack", words: 1721 },
];

export function LeadMagnetMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const wordCount = useMotionValue(0);
  const wordText = useTransform(wordCount, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    if (!inView) return;
    const ctrl = animate(wordCount, 10247, { duration: 1.6, ease: easeOut });
    return ctrl.stop;
  }, [inView, wordCount]);

  const [stat, setStat] = useState({ delivered: 412, booked: 71 });
  useEffect(() => {
    if (!inView) return;
    const i = setInterval(() => {
      setStat((s) => ({
        delivered: s.delivered + (Math.random() > 0.5 ? 1 : 0),
        booked: s.booked + (Math.random() > 0.85 ? 1 : 0),
      }));
    }, 2400);
    return () => clearInterval(i);
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      className="magnet"
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: easeOut }}
      aria-label="Personalized 10K-word lead magnet preview"
    >
      <div className="magnet__bar">
        <div className="magnet__bar-l">
          <span className="magnet__bar-icon">a.</span>
          <span className="magnet__bar-title">Lead magnet · generator <span>· running</span></span>
        </div>
        <span className="chip chip--live">live · 4m to compile</span>
      </div>

      <div className="magnet__doc">
        <div className="magnet__doc-cover">
          <div className="magnet__doc-cover-meta">
            <span>EXCLUSIVE · CUSTOM REPORT</span>
            <span>aca. · march 2026</span>
          </div>
          <h3 className="magnet__doc-title">
            The 2026 Outbound Playbook
            <em>· custom edition for Hartwood</em>
          </h3>
          <div className="magnet__doc-author">
            <div className="magnet__doc-author-av">LK</div>
            <div className="magnet__doc-author-body">
              <div className="magnet__doc-author-name">Authored for · Lena Kapoor</div>
              <div className="magnet__doc-author-role">VP RevOps · Hartwood · Series B SaaS · London</div>
            </div>
          </div>
          <div className="magnet__doc-stats">
            <div className="magnet__doc-stat">
              <motion.b>{wordText}</motion.b>
              <span>words</span>
            </div>
            <div className="magnet__doc-stat">
              <b>47</b>
              <span>pages</span>
            </div>
            <div className="magnet__doc-stat">
              <b>8</b>
              <span>chapters</span>
            </div>
            <div className="magnet__doc-stat magnet__doc-stat--accent">
              <b>4 min</b>
              <span>generated in</span>
            </div>
          </div>
        </div>

        <div className="magnet__doc-toc">
          <span className="magnet__doc-toc-cap">Contents · personalized to Hartwood's stack</span>
          {CHAPTERS.map((c) => (
            <div key={c.n} className="magnet__chapter">
              <span className="magnet__chapter-num">{c.n}</span>
              <span className="magnet__chapter-title">{c.title}</span>
              <span className="magnet__chapter-words">{c.words.toLocaleString()} w</span>
            </div>
          ))}
        </div>

        <div className="magnet__doc-foot">
          <div className="magnet__doc-foot-l">
            <span className="magnet__doc-foot-cap">Distribution</span>
            <div className="magnet__doc-foot-channels">
              <span className="magnet__channel magnet__channel--linkedin">in</span>
              <span className="magnet__channel magnet__channel--email">@</span>
              <span className="magnet__channel-text">DM · email · comment-to-get</span>
            </div>
          </div>
          <div className="magnet__doc-foot-r">
            <div className="magnet__doc-stat">
              <b>{stat.delivered}</b>
              <span>delivered</span>
            </div>
            <div className="magnet__doc-stat magnet__doc-stat--accent">
              <b>{stat.booked}</b>
              <span>meetings booked</span>
            </div>
            <div className="magnet__doc-stat magnet__doc-stat--accent">
              <b>17%</b>
              <span>book rate</span>
            </div>
          </div>
        </div>
      </div>

      <div className="magnet__lift">
        <div className="magnet__lift-side">
          <span className="magnet__lift-cap">Cold message · book rate</span>
          <span className="magnet__lift-num">2.4%</span>
        </div>
        <span className="magnet__lift-arrow">→</span>
        <div className="magnet__lift-side magnet__lift-side--accent">
          <span className="magnet__lift-cap">Personalized magnet · book rate</span>
          <span className="magnet__lift-num">17%</span>
        </div>
        <div className="magnet__lift-stamp">+70% lift</div>
      </div>
    </motion.div>
  );
}
