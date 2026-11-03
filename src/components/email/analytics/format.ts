import type { TimeRange } from "@/hooks/useEmailStats";

/**
 * Rates on this page run from 0.01% (meetings) to 30%+ (bounce on a bad
 * list), so precision scales with size: small rates keep two decimals
 * instead of collapsing to "0.0%".
 */
export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  // Pick the precision from the value as it will display, so 0.996 reads
  // "1.0%" rather than "1.00%", and 9.96 reads "10%".
  if (Number(value.toFixed(1)) >= 10) return `${Math.round(value)}%`;
  if (Number(value.toFixed(2)) >= 1) return `${value.toFixed(1)}%`;
  if (value < 0.01) return "<0.01%";
  return `${value.toFixed(2)}%`;
}

/** "21%" (the arrow carries the direction), or "12.4x" once growth passes 3x and a percentage stops reading well. */
export function formatChange(change: number): string {
  const magnitude = Math.abs(change);
  if (change > 200) return `${(1 + change / 100).toFixed(1).replace(/\.0$/, "")}x`;
  return `${Math.round(magnitude)}%`;
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** Share of `part` in `whole` as a percentage, 0 when there is no whole. */
export function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * Relative change between two periods, or null when it would mislead: no
 * baseline, or too few events to compare (a baseline of 1 positive reply
 * makes the next one "+100%"). Needs 3+ events in the previous period and
 * 10+ across both.
 */
export function relativeChange(
  current: number,
  previous: number | undefined,
  currentCount?: number,
  previousCount?: number,
): number | null {
  if (previous === undefined || previous <= 0) return null;
  if (
    currentCount !== undefined &&
    previousCount !== undefined &&
    (previousCount < 3 || currentCount + previousCount < 10)
  ) {
    return null;
  }
  const change = ((current - previous) / previous) * 100;
  // Under 5% either way is noise at these volumes; call it flat.
  return Math.abs(change) < 5 ? 0 : change;
}

export type HealthTone = "good" | "warning" | "critical";

/** Bounce-rate bands used across cold-email tooling: under 2% is healthy, over 5% hurts deliverability. */
export function bounceHealth(rate: number): { tone: HealthTone; label: string } {
  if (rate > 5) return { tone: "critical", label: "High" };
  if (rate >= 2) return { tone: "warning", label: "Watch" };
  return { tone: "good", label: "Healthy" };
}

export const TIME_RANGE_LABELS: Record<Exclude<TimeRange, "custom">, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

/** "the previous 30 days" etc. — what the deltas compare against. */
export function previousPeriodLabel(timeRange: TimeRange): string | null {
  switch (timeRange) {
    case "7d":
      return "previous 7 days";
    case "30d":
      return "previous 30 days";
    case "90d":
      return "previous 90 days";
    case "custom":
      return "previous period";
    default:
      return null;
  }
}
