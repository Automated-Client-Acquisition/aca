import { useEffect, useRef, useState } from "react";

// Counts up to `target` once scrolled into view. Pure presentational flourish
// used on the "lead-magnet-lp" stats bands. Shared across the /free-*-agent
// pages (each of which uses the .lm-lp__bigstat classes).
export function CountStat({
  target,
  suffix,
  label,
  prefix,
}: {
  target: number;
  suffix: string;
  label: string;
  prefix?: string;
}) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !ran.current) {
          ran.current = true;
          const duration = 1100;
          const start = performance.now();
          const tick = (now: number) => {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(Math.round(eased * target));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  return (
    <div className="lm-lp__bigstat" ref={ref}>
      <b>{prefix ?? ""}{prefix ? "" : val}{suffix}</b>
      <span>{label}</span>
    </div>
  );
}
