import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { easeOut } from "../motion";

type Item = {
  initials: string;
  avCls: "inbox__av--a" | "inbox__av--b" | "inbox__av--c";
  channel: "linkedin" | "email" | "whatsapp";
  name: string;
  company: string;
  preview: string;
  pill: { label: string; tone: "booked" | "replying" | "escalated" };
  time: string;
  selected?: boolean;
};

const ITEMS: Item[] = [
  {
    initials: "LK",
    avCls: "inbox__av--a",
    channel: "linkedin",
    name: "Lena Kapoor",
    company: "Hartwood",
    preview: "Yeah Tue or Thu both work. Curious what you replaced your stack with.",
    pill: { label: "Booked · Tue 14:00", tone: "booked" },
    time: "14m",
    selected: true,
  },
  {
    initials: "DW",
    avCls: "inbox__av--b",
    channel: "email",
    name: "David Wu",
    company: "Wendover",
    preview: "Interesting. Send me a one-pager and I'll route to our RevOps lead.",
    pill: { label: "ACA replying", tone: "replying" },
    time: "42m",
  },
  {
    initials: "MS",
    avCls: "inbox__av--c",
    channel: "linkedin",
    name: "Mara Singh",
    company: "Plenum",
    preview: "We're already in pilot with Outreach. Maybe Q3?",
    pill: { label: "Escalated · 12m", tone: "escalated" },
    time: "2h",
  },
];

const CHANNEL_ICON: Record<Item["channel"], string> = {
  linkedin: "in",
  email: "@",
  whatsapp: "wa",
};

export function InboxMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });

  return (
    <motion.div
      ref={ref}
      className="inbox"
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.42, ease: easeOut }}
      aria-label="Unified inbox preview"
    >
      <div className="inbox__bar">
        <div className="inbox__bar-l">
          <span className="inbox__bar-icon">a.</span>
          <h4>Inbox <span>· all channels</span></h4>
        </div>
        <div className="inbox__bar-r">
          <span className="inbox__stat"><b>7</b> active</span>
          <span className="inbox__stat"><b>3</b> escalated</span>
          <span className="inbox__stat inbox__stat--accent"><b>27</b> booked this week</span>
        </div>
      </div>
      <motion.div
        className="inbox__list"
        initial="hidden"
        animate={inView ? "visible" : "hidden"}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } } }}
      >
        {ITEMS.map((it) => (
          <motion.div
            className={`inbox__item ${it.selected ? "inbox__item--selected" : ""}`}
            key={it.initials}
            variants={{
              hidden: { opacity: 0, x: -8 },
              visible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: easeOut } },
            }}
          >
            <div className="inbox__item-avatar">
              <div className={`inbox__av ${it.avCls}`}>{it.initials}</div>
              <span className={`inbox__channel inbox__channel--${it.channel}`} aria-label={it.channel}>
                {CHANNEL_ICON[it.channel]}
              </span>
            </div>
            <div className="inbox__item-body">
              <div className="inbox__item-row1">
                <span className="inbox__name">{it.name}</span>
                <span className="inbox__co">· {it.company}</span>
                <span className="inbox__time">{it.time}</span>
              </div>
              <div className="inbox__preview">{it.preview}</div>
              <div className="inbox__item-row3">
                <span className={`inbox__pill inbox__pill--${it.pill.tone}`}>
                  {it.pill.tone === "booked" && <span className="inbox__pill-icon" aria-hidden>✓</span>}
                  {it.pill.tone === "escalated" && <span className="inbox__pill-icon" aria-hidden>!</span>}
                  {it.pill.label}
                  {it.pill.tone === "replying" && (
                    <span className="dots-bounce" aria-hidden>
                      <i /><i /><i />
                    </span>
                  )}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
      <div className="inbox__foot">
        <span className="inbox__foot-meta">filter · all channels · last 24h</span>
        <span className="inbox__foot-cta">open thread →</span>
      </div>
    </motion.div>
  );
}
