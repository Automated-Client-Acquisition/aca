import type {
  ABVariantDraft,
  EmailABVariant,
  EmailSequenceStep,
} from "@/types/email";

export type ABWinningMetric = "open_rate" | "click_rate" | "reply_rate";
export const AB_METRIC_LABELS: Record<ABWinningMetric, string> = {
  open_rate: "Open rate",
  click_rate: "Click rate",
  reply_rate: "Reply rate",
};

function count(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateABPerformance(
  variants: EmailABVariant[],
  metric: ABWinningMetric,
  sampleSize = 100,
) {
  const sampleTarget =
    Number.isFinite(sampleSize) && sampleSize > 0 ? sampleSize : 100;
  const rows = variants.map((variant) => {
    const sent = count(variant.sent),
      bounced = count(variant.bounced);
    const delivered = Math.max(0, sent - bounced);
    const rate = (events: number) =>
      delivered > 0 ? (count(events) / delivered) * 100 : null;
    return {
      ...variant,
      sent,
      bounced,
      opened: count(variant.opened),
      clicked: count(variant.clicked),
      replied: count(variant.replied),
      delivered,
      open_rate: rate(variant.opened),
      click_rate: rate(variant.clicked),
      reply_rate: rate(variant.replied),
      bounce_rate: sent > 0 ? (bounced / sent) * 100 : null,
      sampleProgress: Math.min(100, (sent / sampleTarget) * 100),
    };
  });
  const winner = rows.find((row) => row.is_winner);
  const maxRate = Math.max(0, ...rows.map((row) => row[metric] ?? 0));
  const leaders =
    maxRate > 0 ? rows.filter((row) => row[metric] === maxRate) : [];
  const leaderId = !winner && leaders.length === 1 ? leaders[0].id : null;
  const sampleReached =
    rows.length >= 2 && rows.every((row) => row.sent >= sampleTarget);
  const totals = rows.reduce(
    (total, row) => ({
      sent: total.sent + row.sent,
      delivered: total.delivered + row.delivered,
      replied: total.replied + row.replied,
    }),
    { sent: 0, delivered: 0, replied: 0 },
  );
  return {
    rows,
    totals,
    winner,
    leaderId,
    tied: !winner && leaders.length > 1,
    sampleReached,
    sampleTarget,
  };
}

/** Resolve legacy IDs once, using saved positions before the user can reorder. */
export function hydrateABVariantIds(
  steps: EmailSequenceStep[],
  recorded: EmailABVariant[],
  sequenceId: string,
): EmailSequenceStep[] {
  return steps.map((step) =>
    step.type !== "ab_test"
      ? step
      : {
          ...step,
          variants: step.variants?.map((draft) =>
            draft.id
              ? draft
              : {
                  ...draft,
                  id:
                    recorded.find(
                      (row) =>
                        row.sequence_id === sequenceId &&
                        row.step_index === step.order &&
                        row.variant_label === draft.variant_label,
                    )?.id || crypto.randomUUID(),
                },
          ),
        },
  );
}

/** Saved IDs follow a step when its position changes; never borrow another step's stats. */
export function getStepABPerformanceVariants(
  step: EmailSequenceStep,
  recorded: EmailABVariant[],
  sequenceId: string,
): EmailABVariant[] {
  return (step.variants || []).map((draft: ABVariantDraft) => {
    const saved = draft.id
      ? recorded.find(
          (row) => row.id === draft.id && row.sequence_id === sequenceId,
        )
      : undefined;
    return {
      id: draft.id || saved?.id || `step-${step.order}-${draft.variant_label}`,
      sequence_id: sequenceId,
      step_index: step.order,
      variant_label: draft.variant_label,
      subject: draft.subject,
      body: draft.body,
      split_percentage: draft.split_percentage,
      sent: saved?.sent ?? 0,
      opened: saved?.opened ?? 0,
      clicked: saved?.clicked ?? 0,
      replied: saved?.replied ?? 0,
      bounced: saved?.bounced ?? 0,
      is_winner: saved?.is_winner ?? false,
      created_at: saved?.created_at || "",
    };
  });
}
