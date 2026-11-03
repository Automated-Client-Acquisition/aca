import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

type Step = { kind: "ok" | "fail"; label: string; meta: string };
type Attempt = {
  n: number;
  target: string;
  task: string;
  steps: Step[];
  outcome: { label: string; tone: "blocked" | "manual" | "failed" };
};

const ATTEMPTS: Attempt[] = [
  {
    n: 1,
    target: "Hartwood",
    task: "cold email · first-touch",
    steps: [
      { kind: "ok", label: "Drafted in your voice", meta: "0.8s · GPT-5" },
      { kind: "fail", label: "Send blocked", meta: "domain not warmed · SPF missing" },
    ],
    outcome: { label: "HOLDING · need deliverability infra", tone: "blocked" },
  },
  {
    n: 2,
    target: "Plenum",
    task: "LinkedIn DM · personalized",
    steps: [
      { kind: "ok", label: "Personalization pulled from post", meta: "1.2s" },
      { kind: "fail", label: "Sender at 92% rate limit", meta: "1 LinkedIn account · no pool" },
    ],
    outcome: { label: "HOLDING · need sender pool", tone: "blocked" },
  },
  {
    n: 3,
    target: "David @ Wendover",
    task: "reply triage",
    steps: [
      { kind: "ok", label: "Reply drafted, classified positive", meta: "0.6s" },
      { kind: "fail", label: "No unified inbox", meta: "still buried in Gmail · 11 unanswered" },
    ],
    outcome: { label: "MANUAL · need triage layer", tone: "manual" },
  },
  {
    n: 4,
    target: "Greypine",
    task: "book meeting",
    steps: [
      { kind: "ok", label: "Calendar overlap found", meta: "Tue 14:00 · Wed 11:00" },
      { kind: "fail", label: "Calendly link sent · prospect dropped", meta: "added 14% friction" },
    ],
    outcome: { label: "FAILED · need in-thread booking", tone: "failed" },
  },
];

export function BrokenSDRMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const [visibleSteps, setVisibleSteps] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const total = ATTEMPTS.reduce((acc, a) => acc + a.steps.length + 1, 0);
    const i = setInterval(() => {
      setVisibleSteps((v) => {
        if (v >= total) {
          clearInterval(i);
          return v;
        }
        return v + 1;
      });
    }, 220);
    return () => clearInterval(i);
  }, [inView]);

  let cursor = 0;

  return (
    <motion.div
      ref={ref}
      className="broken"
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.42, ease: easeOut }}
      aria-label="AI SDR running simulation - hitting infrastructure walls"
    >
      <div className="broken__bar">
        <div className="broken__bar-l">
          <span className="broken__bar-icon">▶</span>
          <span className="broken__bar-title">AI SDR · running</span>
          <span className="broken__bar-meta">your Claude · no infra</span>
        </div>
        <span className="broken__bar-stat">
          <span className="broken__bar-dot" /> 4 errors
        </span>
      </div>

      <div className="broken__list">
        {ATTEMPTS.map((a) => {
          const headerVisible = ++cursor <= visibleSteps;
          return (
            <div className={`broken__attempt ${headerVisible ? "broken__attempt--in" : ""}`} key={a.n}>
              <div className="broken__attempt-head">
                <span className="broken__attempt-num">#{a.n}</span>
                <div className="broken__attempt-body">
                  <span className="broken__attempt-target">{a.target}</span>
                  <span className="broken__attempt-task">· {a.task}</span>
                </div>
              </div>
              <div className="broken__steps">
                {a.steps.map((s, si) => {
                  const stepVisible = ++cursor <= visibleSteps;
                  return (
                    <div
                      key={si}
                      className={`broken__step broken__step--${s.kind} ${stepVisible ? "broken__step--in" : ""}`}
                    >
                      <span className="broken__step-icon">{s.kind === "ok" ? "✓" : "✗"}</span>
                      <span className="broken__step-label">{s.label}</span>
                      <span className="broken__step-meta">{s.meta}</span>
                    </div>
                  );
                })}
                <div className={`broken__outcome broken__outcome--${a.outcome.tone}`}>
                  ⤷ {a.outcome.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="broken__foot">
        <div className="broken__foot-stats">
          <span><b>47</b> drafts</span>
          <span><b>3</b> sent</span>
          <span className="broken__foot-stat--zero"><b>0</b> booked</span>
        </div>
        <div className="broken__foot-line">
          <em>The AI is fine. The infrastructure is not.</em>
        </div>
      </div>
    </motion.div>
  );
}
