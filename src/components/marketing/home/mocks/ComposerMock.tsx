import { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate, useInView } from "framer-motion";
import { easeOut } from "../motion";

export function ComposerMock({
  recipient = "Lena Kapoor",
  recipientRole = "VP RevOps, Hartwood",
  warm = false,
}: {
  recipient?: string;
  recipientRole?: string;
  warm?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const meter = useMotionValue(0);
  const pctText = useTransform(meter, (v) => `${Math.round(v)}%`);
  const meterWidth = useTransform(meter, (v) => `${v}%`);

  useEffect(() => {
    if (!inView) return;
    const ctrl = animate(meter, 92, { duration: 0.7, ease: easeOut });
    return ctrl.stop;
  }, [inView, meter]);

  return (
    <motion.div
      ref={ref}
      className="composer"
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.42, ease: easeOut }}
      aria-label={`Message draft to ${recipient}`}
    >
      <div className="composer__bar">
        <span className="badge badge--li">in</span>
        <span className="who">DM to <b>{recipient}</b> · {recipientRole}</span>
      </div>
      <div className="composer__draft">
        {warm ? (
          <>
            {recipient.split(" ")[0]} - your reaction to my <mark>outbound-math post</mark> stuck with me. The thing I cut from the post was the part on cost-per-qualified-meeting at agency-scale - which is exactly the number you'd want.
            <br /><br />
            Worth 15 min next week to walk through it?
          </>
        ) : (
          <>
            {recipient.split(" ")[0]} - saw your <mark>post about outbound being dead</mark>. We rebuilt the whole stack last year and ended up <mark>cutting Salesloft and Apollo</mark> for one orchestration layer.
            <br /><br />
            Worth 15 min next week to compare notes?
          </>
        )}
        <span className="composer__sig">- signed as you · approved by autopilot</span>
      </div>
      <div className="composer__foot">
        <div className="composer__match">
          <span>Voice match</span>
          <span className="meter">
            <motion.i style={{ width: meterWidth }} />
          </span>
          <motion.span>{pctText}</motion.span>
        </div>
        <div className="composer__btns">
          <button>Edit</button>
          <button>Hold</button>
          <button className="primary">Send →</button>
        </div>
      </div>
    </motion.div>
  );
}
