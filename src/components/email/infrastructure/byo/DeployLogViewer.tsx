import { useEffect, useRef } from "react";
import type { InfraByoJob } from "@/types/email";

interface DeployLogViewerProps {
  job: InfraByoJob | null | undefined;
  height?: string;
}

/**
 * Fixed-height monospace log pane. Auto-scrolls to the bottom as new lines arrive,
 * unless the user has scrolled up (preserves manual inspection).
 */
export function DeployLogViewer({ job, height = "16rem" }: DeployLogViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const onScroll = () => {
      const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
      stickToBottomRef.current = distance < 24;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!ref.current || !stickToBottomRef.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [job?.log]);

  const log = job?.log ?? "";
  const empty = !log;

  return (
    <div
      ref={ref}
      className="rounded-md border bg-black/80 p-3 font-mono text-[11px] leading-relaxed text-green-200 overflow-auto whitespace-pre-wrap"
      style={{ height }}
    >
      {empty ? (
        <span className="text-muted-foreground">
          {job?.status === "pending"
            ? "Queued — waiting for the deployer to pick this up..."
            : "Waiting for output..."}
        </span>
      ) : (
        log
      )}
    </div>
  );
}
