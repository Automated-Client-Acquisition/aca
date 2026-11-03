import type { EmailSequencePerformance } from "@/types/email";

/**
 * Each funnel step needs enough events behind it before its rate means
 * anything: 1 positive out of 1 reply reads as "100% positive". Below these
 * floors a campaign's rate is shown dimmed, can't be "best", and sorts after
 * the campaigns that clear the floor.
 */
export const MIN_LEADS_TO_RANK = 100;
const MIN_REPLIES_TO_RANK = 5;
const MIN_POSITIVE_TO_RANK = 3;

export type RateKey = "positive_per_lead" | "reply_rate" | "positive_rate" | "meeting_rate";
export type SortKey = RateKey | "bounce_rate" | "sent" | "name";

export const RATE_KEYS: RateKey[] = ["positive_per_lead", "reply_rate", "positive_rate", "meeting_rate"];

/** Whether a campaign has enough volume behind this step's rate to rank it. */
export function rankable(row: EmailSequencePerformance, key: RateKey): boolean {
  switch (key) {
    case "positive_rate":
      return row.replied >= MIN_REPLIES_TO_RANK;
    case "meeting_rate":
      return row.positive >= MIN_POSITIVE_TO_RANK;
    default:
      return row.delivered >= MIN_LEADS_TO_RANK;
  }
}

export const UNRANKED_REASON: Record<RateKey, string> = {
  positive_per_lead: `under ${MIN_LEADS_TO_RANK} delivered leads`,
  reply_rate: `under ${MIN_LEADS_TO_RANK} delivered leads`,
  positive_rate: `fewer than ${MIN_REPLIES_TO_RANK} replies`,
  meeting_rate: `fewer than ${MIN_POSITIVE_TO_RANK} positive replies`,
};

/** Secondary order for ties: the count behind the rate, then volume. */
export function tieBreak(a: EmailSequencePerformance, b: EmailSequencePerformance, key: SortKey): number {
  const countKey =
    key === "positive_rate" || key === "positive_per_lead"
      ? "positive"
      : key === "reply_rate"
        ? "replied"
        : key === "meeting_rate"
          ? "meetings"
          : null;
  if (countKey && b[countKey] !== a[countKey]) return b[countKey] - a[countKey];
  return b.sent - a.sent;
}

/**
 * The campaign that turns the most leads into positive replies (the funnel's
 * end-to-end yield); falls back to reply rate when nothing got a positive yet.
 */
export function bestCampaign(rows: EmailSequencePerformance[]) {
  const eligible = rows.filter((r) => r.delivered >= MIN_LEADS_TO_RANK);
  const pick = (key: "positive_per_lead" | "reply_rate", count: "positive" | "replied") => {
    const withSignal = eligible.filter((r) => r[count] > 0);
    if (withSignal.length === 0) return null;
    return [...withSignal].sort((a, b) => b[key] - a[key] || tieBreak(a, b, key))[0];
  };
  const byPositive = pick("positive_per_lead", "positive");
  if (byPositive) return { row: byPositive, metric: "positive" as const };
  const byReply = pick("reply_rate", "replied");
  if (byReply) return { row: byReply, metric: "reply" as const };
  return null;
}

