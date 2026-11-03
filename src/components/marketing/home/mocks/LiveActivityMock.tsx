import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

type Now = { id: string; label: string; meta: string };
type Done = { id: string; title: string; meta: string; tone: "booked" | "magnet" | "reply" | "publish"; ago: string };

const NOW: Now[] = [
  { id: "draft", label: "Drafting first-touch · Lena @ Hartwood", meta: "voice match 92% · 0.4s" },
  { id: "publish", label: "Publishing post · 4 LinkedIn accounts", meta: "topic: outbound math · scheduled" },
  { id: "watch", label: "Watching 3 active reply threads", meta: "LinkedIn · email · comments" },
];

const DONE: Done[] = [
  { id: "1", title: "Meeting booked · Lena Kapoor · Tue 14:00", meta: "Hartwood · qualifying brief attached", tone: "booked", ago: "2m" },
  { id: "2", title: "Magnet auto-DM'd to David @ Wendover", meta: "commented \"send\" on outbound-math post", tone: "magnet", ago: "8m" },
  { id: "3", title: "Replied to Mara @ Plenum", meta: "classified ambiguous · escalated to Slack", tone: "reply", ago: "14m" },
  { id: "4", title: "Post shipped to founder · team · ghostwriting accounts", meta: "almost hand-written · scheduled this morning", tone: "publish", ago: "1h" },
];

const TONE_LABEL: Record<Done["tone"], string> = {
  booked: "BOOKED",
  magnet: "MAGNET SENT",
  reply: "REPLIED",
  publish: "PUBLISHED",
};

export function LiveActivityMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const [stats, setStats] = useState({ sent: 47, replies: 12, booked: 3, warm: 8 });

  useEffect(() => {
    if (!inView) return;
    const interval = setInterval(() => {
      setStats((s) => ({
        sent: s.sent + Math.floor(Math.random() * 3) + 1,
        replies: s.replies + (Math.random() > 0.6 ? 1 : 0),
        booked: s.booked + (Math.random() > 0.92 ? 1 : 0),
        warm: s.warm + (Math.random() > 0.7 ? 1 : 0),
      }));
    }, 2400);
    return () => clearInterval(interval);
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      className="live"
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.42, ease: easeOut }}
      aria-label="ACA AI SDR · live activity"
    >
      <div className="live__bar">
        <div className="live__bar-l">
          <span className="live__bar-icon">a.</span>
          <span className="live__bar-title">AI SDR <span>· running</span></span>
        </div>
        <span className="live__bar-stat">
          <span className="live__bar-dot" /> live · synced 14m ago
        </span>
      </div>

      <div className="live__section">
        <div className="live__section-head">
          <span className="live__section-label">Now · doing</span>
          <span className="live__section-meta">{NOW.length} active</span>
        </div>
        <div className="live__rows">
          {NOW.map((n, i) => (
            <motion.div
              className="live__row live__row--now"
              key={n.id}
              initial={{ opacity: 0, x: -6 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.32, ease: easeOut, delay: 0.2 + i * 0.08 }}
            >
              <span className="live__row-icon live__row-icon--now">
                <span className="live__row-spin" />
              </span>
              <div className="live__row-body">
                <div className="live__row-label">{n.label}</div>
                <div className="live__row-meta">{n.meta}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="live__section">
        <div className="live__section-head">
          <span className="live__section-label">Just done</span>
          <span className="live__section-meta">last 60 min</span>
        </div>
        <div className="live__rows">
          {DONE.map((d, i) => (
            <motion.div
              className={`live__row live__row--done live__row--${d.tone}`}
              key={d.id}
              initial={{ opacity: 0, x: -6 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.32, ease: easeOut, delay: 0.5 + i * 0.08 }}
            >
              <span className="live__row-icon live__row-icon--done">✓</span>
              <div className="live__row-body">
                <div className="live__row-label">{d.title}</div>
                <div className="live__row-meta">{d.meta}</div>
              </div>
              <div className="live__row-side">
                <span className="live__row-tone">{TONE_LABEL[d.tone]}</span>
                <span className="live__row-time">{d.ago}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="live__foot">
        <div className="live__foot-stat">
          <motion.b key={stats.sent} initial={{ scale: 1.05 }} animate={{ scale: 1 }} transition={{ duration: 0.3 }}>{stats.sent}</motion.b>
          <span>sent</span>
        </div>
        <div className="live__foot-stat">
          <motion.b key={stats.replies} initial={{ scale: 1.05 }} animate={{ scale: 1 }} transition={{ duration: 0.3 }}>{stats.replies}</motion.b>
          <span>replies</span>
        </div>
        <div className="live__foot-stat live__foot-stat--accent">
          <motion.b key={stats.booked} initial={{ scale: 1.05 }} animate={{ scale: 1 }} transition={{ duration: 0.3 }}>{stats.booked}</motion.b>
          <span>booked</span>
        </div>
        <div className="live__foot-stat">
          <motion.b key={stats.warm} initial={{ scale: 1.05 }} animate={{ scale: 1 }} transition={{ duration: 0.3 }}>{stats.warm}</motion.b>
          <span>warm leads</span>
        </div>
      </div>
    </motion.div>
  );
}
