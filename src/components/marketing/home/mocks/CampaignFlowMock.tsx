import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

type Channel = "linkedin" | "email";
type Step = {
  n: number;
  day: string;
  channel: Channel;
  title: string;
  preview: string;
  status: "done" | "running" | "queued";
  metrics: { value: number | string; label: string }[];
};

const STEPS: Step[] = [
  {
    n: 1,
    day: "Day 0",
    channel: "linkedin",
    title: "Connection note",
    preview: '"Lena - saw your post on outbound math. Replaced our SDR with one orchestration layer last year. Worth comparing notes?"',
    status: "done",
    metrics: [
      { value: 142, label: "sent" },
      { value: "38%", label: "accept" },
      { value: 54, label: "connected" },
    ],
  },
  {
    n: 2,
    day: "Day 2 · after accept",
    channel: "linkedin",
    title: "DM · personalized angle",
    preview: '"Following up - the part I cut from the post was cost-per-qualified-meeting at agency-scale, which is the number you\'d want for Hartwood..."',
    status: "running",
    metrics: [
      { value: 54, label: "in flight" },
      { value: 12, label: "replies" },
      { value: 3, label: "booked" },
    ],
  },
  {
    n: 3,
    day: "Day 5",
    channel: "email",
    title: "Email follow-up · same thread",
    preview: '"Still on this. Three slots open next week. Hartwood\'s stack is exactly the spot I think we can shave 30% on cost-per-meeting..."',
    status: "queued",
    metrics: [
      { value: 32, label: "queued" },
      { value: "Mon 9am", label: "next batch" },
    ],
  },
  {
    n: 4,
    day: "Day 12",
    channel: "email",
    title: "Break-up · graceful close",
    preview: '"Last note - if it\'s not the right time, let me know and I\'ll close the loop. Otherwise, slot below."',
    status: "queued",
    metrics: [
      { value: "scheduled", label: "auto" },
    ],
  },
];

const STATUS_LABEL: Record<Step["status"], string> = {
  done: "✓ done",
  running: "↻ running",
  queued: "⏱ queued",
};

export function CampaignFlowMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const [enrolled, setEnrolled] = useState(142);

  useEffect(() => {
    if (!inView) return;
    const i = setInterval(() => setEnrolled((e) => e + Math.floor(Math.random() * 3) + 1), 2400);
    return () => clearInterval(i);
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      className="campaign"
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.42, ease: easeOut }}
      aria-label="Campaign sequence - running"
    >
      <div className="campaign__bar">
        <div className="campaign__bar-l">
          <span className="campaign__bar-icon">a.</span>
          <span className="campaign__bar-title">Series A SaaS · WE <span>· running</span></span>
        </div>
        <span className="campaign__bar-stat">
          <span className="campaign__bar-dot" /> live · <b>{enrolled}</b> enrolled
        </span>
      </div>

      <div className="campaign__steps">
        {STEPS.map((s, i) => (
          <motion.div
            className={`campaign__step campaign__step--${s.status}`}
            key={s.n}
            initial={{ opacity: 0, x: -6 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.32, ease: easeOut, delay: 0.2 + i * 0.08 }}
          >
            <div className="campaign__step-rail">
              <span className="campaign__step-num">{s.n}</span>
              {i < STEPS.length - 1 && <span className="campaign__step-line" />}
            </div>
            <div className="campaign__step-body">
              <div className="campaign__step-head">
                <span className={`campaign__channel campaign__channel--${s.channel}`}>
                  {s.channel === "linkedin" ? "in" : "@"}
                </span>
                <span className="campaign__step-day">{s.day}</span>
                <span className={`campaign__step-status campaign__step-status--${s.status}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </div>
              <div className="campaign__step-title">{s.title}</div>
              <div className="campaign__step-preview">{s.preview}</div>
              <div className="campaign__step-metrics">
                {s.metrics.map((m) => (
                  <div key={m.label} className="campaign__metric">
                    <b>{m.value}</b>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="campaign__foot">
        <div className="campaign__foot-l">
          <span className="campaign__foot-cap">Voice match across all steps</span>
          <div className="campaign__foot-meter">
            <span className="campaign__foot-meter-bar" style={{ width: "92%" }} />
          </div>
          <span className="campaign__foot-pct">92%</span>
        </div>
        <div className="campaign__foot-r">
          <span><b>47</b> sent today</span>
          <span><b>12</b> replies</span>
          <span className="campaign__foot-accent"><b>3</b> booked</span>
        </div>
      </div>
    </motion.div>
  );
}
