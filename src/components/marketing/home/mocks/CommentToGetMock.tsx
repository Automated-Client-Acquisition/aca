import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

type Comment = {
  initials: string;
  avCls: "inbox__av--a" | "inbox__av--b" | "inbox__av--c";
  name: string;
  role: string;
  text: string;
  status: "delivered" | "qualified" | "booked" | "drafting";
};

const COMMENTS: Comment[] = [
  { initials: "LK", avCls: "inbox__av--a", name: "Lena Kapoor", role: "VP RevOps · Hartwood", text: "Send 🙌", status: "booked" },
  { initials: "DW", avCls: "inbox__av--b", name: "David Wu", role: "Founder · Wendover", text: "Yes please, can you DM?", status: "qualified" },
  { initials: "MS", avCls: "inbox__av--c", name: "Mara Singh", role: "Head of GTM · Plenum", text: "+1 interested", status: "delivered" },
  { initials: "HM", avCls: "inbox__av--a", name: "Hugo Marin", role: "CEO · Ardent Labs", text: "send 🙏", status: "delivered" },
  { initials: "PA", avCls: "inbox__av--b", name: "Priya Anand", role: "Head of Growth · Greypine", text: "Interested!", status: "drafting" },
];

const STATUS_LABEL: Record<Comment["status"], string> = {
  drafting: "drafting DM",
  delivered: "magnet delivered ✓",
  qualified: "qualifying in-thread",
  booked: "booked · Tue 14:00",
};

const STATUS_TONE: Record<Comment["status"], string> = {
  drafting: "c2g__pill--drafting",
  delivered: "c2g__pill--delivered",
  qualified: "c2g__pill--qualified",
  booked: "c2g__pill--booked",
};

export function CommentToGetMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const [counter, setCounter] = useState({ comments: 127, delivered: 89, booked: 12 });

  useEffect(() => {
    if (!inView) return;
    const interval = setInterval(() => {
      setCounter((c) => ({
        comments: c.comments + Math.floor(Math.random() * 2) + 1,
        delivered: c.delivered + (Math.random() > 0.4 ? 1 : 0),
        booked: c.booked + (Math.random() > 0.85 ? 1 : 0),
      }));
    }, 2400);
    return () => clearInterval(interval);
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      className="c2g"
      initial={{ opacity: 0, y: 14 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: easeOut }}
      aria-label="Comment-to-get warm-lead capture system"
    >
      <div className="c2g__post">
        <div className="c2g__post-bar">
          <span className="badge badge--li">in</span>
          <div>
            <div className="c2g__post-author">Cedric Seguela <span>· founder @ aca.</span></div>
            <div className="c2g__post-time">Posted 2h · published to 3 LinkedIn accounts</div>
          </div>
          <span className="chip chip--ai c2g__post-chip">comment-to-get · live</span>
        </div>
        <div className="c2g__post-body">
          <em>Just shipped the 60-day blueprint for B2B founders running outbound on a $0 budget.</em>
          <p className="c2g__post-cta">Comment <strong>"send"</strong> and the AI agent DMs the deck to you in 30 seconds.</p>
        </div>
        <div className="c2g__post-stats">
          <div className="c2g__post-stat">
            <b>{counter.comments}</b>
            <span>comments</span>
          </div>
          <div className="c2g__post-stat">
            <b>{counter.delivered}</b>
            <span>magnets sent</span>
          </div>
          <div className="c2g__post-stat c2g__post-stat--accent">
            <b>{counter.booked}</b>
            <span>booked this week</span>
          </div>
        </div>
      </div>

      <div className="c2g__arrow">AI agent DMs each commenter →</div>

      <motion.div
        className="c2g__feed"
        initial="hidden"
        animate={inView ? "visible" : "hidden"}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08, delayChildren: 0.4 } } }}
      >
        <div className="c2g__feed-head">
          <h4>Comment thread · auto-handled</h4>
          <span className="chip chip--live">5 new in last 4m</span>
        </div>
        {COMMENTS.map((c) => (
          <motion.div
            key={c.initials}
            className="c2g__row"
            variants={{
              hidden: { opacity: 0, x: -8 },
              visible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: easeOut } },
            }}
          >
            <div className={`inbox__av ${c.avCls}`}>{c.initials}</div>
            <div className="c2g__row-body">
              <div className="c2g__row-name">{c.name} <span>· {c.role}</span></div>
              <div className="c2g__row-text">"{c.text}"</div>
            </div>
            <div className="c2g__row-arrow" aria-hidden>→</div>
            <div className="c2g__row-dm">
              <div className="c2g__row-dm-head">
                <span className="badge badge--li">in</span>
                <span>auto-DM · magnet attached</span>
              </div>
              <div className="c2g__row-dm-body">
                {c.name.split(" ")[0]} - here's the 60-day blueprint <em>(blueprint.pdf · 4 pages)</em>. Quick q before you read: are you running outbound now or starting from scratch?
              </div>
            </div>
            <span className={`c2g__pill ${STATUS_TONE[c.status]}`}>
              {c.status === "drafting" && (
                <span className="dots-bounce" aria-hidden>
                  <i /><i /><i />
                </span>
              )}
              {STATUS_LABEL[c.status]}
            </span>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
