import { useEffect, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

const REACTORS = [
  { initials: "LK", avCls: "inbox__av--a", name: "Lena Kapoor", role: "VP RevOps · Hartwood", chip: "liked", match: 92, delay: 0 },
  { initials: "DW", avCls: "inbox__av--b", name: "David Wu", role: "Founder · Wendover", chip: "commented", match: 88, delay: 0.08 },
  { initials: "MS", avCls: "inbox__av--c", name: "Mara Singh", role: "Head of GTM · Plenum", chip: "saved · 2× profile views", match: 84, delay: 0.16 },
  { initials: "HM", avCls: "inbox__av--a", name: "Hugo Marin", role: "CEO · Ardent Labs", chip: "reposted", match: 81, delay: 0.24 },
];

export function EngagementCaptureMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const [stage, setStage] = useState(0);
  const [auto, setAuto] = useState(4);

  useEffect(() => {
    if (!inView) return;
    const t1 = setTimeout(() => setStage(1), 600);
    const t2 = setTimeout(() => setStage(2), 1500);
    const t3 = setTimeout(() => setStage(3), 2300);
    const c = setInterval(() => setAuto((a) => Math.max(1, a - 1)), 60000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearInterval(c);
    };
  }, [inView]);

  return (
    <div ref={ref} className="engage" aria-label="Engagement capture flow: post → reactors → DM">
      <motion.div
        className="engage__panel engage__panel--post"
        initial={{ opacity: 0, y: 12 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.42, ease: easeOut }}
      >
        <div className="engage__post-head">
          <span className="engage__post-avatar">cs</span>
          <div>
            <div className="engage__post-author">Cedric Seguela <span>· founder @ aca.</span></div>
            <div className="engage__post-time">2h · LinkedIn · 47k followers</div>
          </div>
        </div>
        <div className="engage__post-body">
          <em>The math behind a $7K/mo outbound stack that actually books meetings.</em>
        </div>
        <ul className="engage__post-bullets">
          <li>1. Cost per qualified meeting, not per send</li>
          <li>2. Reply rate × close rate, not opens</li>
          <li>3. Why the SDR + tools model is broken in 2026</li>
        </ul>
        <div className="engage__post-stats">
          <div className="engage__post-stat"><b>2.4k</b> impressions</div>
          <div className="engage__post-stat"><b>47</b> reactions</div>
          <div className="engage__post-stat"><b>12</b> comments</div>
        </div>
        <div className="engage__post-react">
          <div className="engage__react-stack">
            <i className="r-1" />
            <i className="r-2" />
            <i className="r-3" />
          </div>
          <span>Lena, David, Mara + 44 founders</span>
        </div>
      </motion.div>

      <div className="engage__arrow">engagement →</div>

      <motion.div
        className="engage__panel engage__panel--reactors"
        initial={{ opacity: 0, y: 12 }}
        animate={stage >= 1 ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.42, ease: easeOut }}
      >
        <div className="engage__panel-head">
          <h4>Engagement captured</h4>
          <span className="chip chip--live">5 ICP-match</span>
        </div>
        <div className="engage__reactor-list">
          {REACTORS.map((r, i) => (
            <motion.div
              className="engage__reactor"
              key={r.initials}
              initial={{ opacity: 0, x: -8 }}
              animate={stage >= 1 ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.32, ease: easeOut, delay: 0.2 + r.delay }}
            >
              <div className={`inbox__av ${r.avCls}`}>{r.initials}</div>
              <div className="engage__reactor-body">
                <div className="engage__reactor-name">{r.name}</div>
                <div className="engage__reactor-role">{r.role}</div>
              </div>
              <span className="engage__reactor-chip">{r.chip}</span>
              <div className="engage__reactor-match">
                <span className="cell-score__num">{r.match}</span>
                <span className="cell-score__bar"><i style={{ width: r.match + "%" }} /></span>
              </div>
              <div className="engage__reactor-status">
                {i === 3 && stage < 2 ? (
                  <>
                    <span className="cell-shimmer" style={{ width: 90 }} /> drafting…
                  </>
                ) : (
                  <span className="engage__reactor-done">drafted ✓ · in queue</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
        <div className="engage__panel-foot">
          <span>4 of 47 reactors matched ICP</span>
          <span>· auto-DM enabled</span>
        </div>
      </motion.div>

      <div className="engage__arrow">→ DM</div>

      <motion.div
        className="engage__panel engage__panel--dm"
        initial={{ opacity: 0, y: 12 }}
        animate={stage >= 2 ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.42, ease: easeOut }}
      >
        <div className="engage__panel-head">
          <h4>Warm DM · drafted</h4>
          <span className="chip chip--ai">auto-send · {auto}m</span>
        </div>
        <div className="engage__dm-bar">
          <span className="badge badge--li">in</span>
          <span>Lena Kapoor · VP RevOps, Hartwood</span>
        </div>
        <div className="engage__dm-body">
          Lena - your reaction to my <mark>outbound-math post</mark> stuck with me. The number I cut from the post was cost-per-qualified-meeting at scale, which is the one you'd want for Hartwood.
          <br /><br />
          Worth 15 min next week to walk through it?
        </div>
        <div className="engage__dm-foot">
          <span className="engage__dm-meta">refs: <em>liked post · 2h ago · @fairmont enriched</em></span>
          <span className="engage__dm-action">Send →</span>
        </div>
        <div className="engage__dm-meta-row">
          <span className="engage__dm-meta-item"><b>92%</b> voice match</span>
          <span className="engage__dm-meta-item"><b>0.8s</b> draft latency</span>
          <span className="engage__dm-meta-item"><b>$0.003</b> via your key</span>
        </div>
      </motion.div>
    </div>
  );
}
