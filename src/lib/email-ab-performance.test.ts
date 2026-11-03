import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateABPerformance,
  getStepABPerformanceVariants,
  hydrateABVariantIds,
} from "./email-ab-performance.ts";
import type { EmailABVariant, EmailSequenceStep } from "../types/email.ts";

function variant(
  id: string,
  overrides: Partial<EmailABVariant> = {},
): EmailABVariant {
  return {
    id,
    sequence_id: "seq",
    step_index: 0,
    variant_label: id,
    subject: `Subject ${id}`,
    body: "Body",
    split_percentage: 50,
    sent: 100,
    opened: 40,
    clicked: 10,
    replied: 8,
    bounced: 20,
    is_winner: false,
    created_at: "",
    ...overrides,
  };
}

test("performance uses non-bounced sends for engagement and sends for bounce rate", () => {
  const { rows, totals, leaderId, sampleReached } = calculateABPerformance(
    [variant("A"), variant("B", { sent: 50, bounced: 0, replied: 2 })],
    "reply_rate",
    100,
  );
  assert.equal(rows[0].delivered, 80);
  assert.equal(rows[0].open_rate, 50);
  assert.equal(rows[0].click_rate, 12.5);
  assert.equal(rows[0].reply_rate, 10);
  assert.equal(rows[0].bounce_rate, 20);
  assert.equal(leaderId, "A");
  assert.equal(sampleReached, false);
  assert.deepEqual(totals, { sent: 150, delivered: 130, replied: 10 });
});

test("no sends or all bounced never yields a false leader or invalid rate", () => {
  for (const sent of [0, 100]) {
    const result = calculateABPerformance(
      [
        variant("A", {
          sent,
          bounced: sent,
          opened: 0,
          clicked: 0,
          replied: 0,
        }),
        variant("B", {
          sent: 0,
          bounced: 0,
          opened: 0,
          clicked: 0,
          replied: 0,
        }),
      ],
      "reply_rate",
    );
    assert.equal(result.rows[0].reply_rate, null);
    assert.equal(result.leaderId, null);
    assert.equal(result.tied, false);
    assert.equal(result.sampleReached, false);
  }
});

test("ties and recorded winners remain distinct from sample progress", () => {
  const tied = calculateABPerformance(
    [variant("A"), variant("B")],
    "reply_rate",
    50,
  );
  assert.equal(tied.leaderId, null);
  assert.equal(tied.tied, true);
  assert.equal(tied.sampleReached, true);
  assert.equal(tied.rows[0].sampleProgress, 100);
  const winner = calculateABPerformance(
    [variant("A"), variant("B", { is_winner: true, replied: 1 })],
    "reply_rate",
  );
  assert.equal(winner.winner?.id, "B");
  assert.equal(winner.leaderId, null);
  assert.equal(winner.tied, false);
});

test("zero recorded engagement has no leader even after samples are reached", () => {
  const result = calculateABPerformance(
    [variant("A", { replied: 0 }), variant("B", { replied: 0 })],
    "reply_rate",
  );
  assert.equal(result.leaderId, null);
  assert.equal(result.sampleReached, true);
});

test("reordered steps keep their own variant stats by ID and use current copy/split", () => {
  const step: EmailSequenceStep = {
    order: 4,
    type: "ab_test",
    variants: [
      {
        id: "A",
        variant_label: "A",
        subject: "Edited subject",
        body: "Updated body",
        split_percentage: 60,
      },
      {
        id: "new",
        variant_label: "B",
        subject: "New variant",
        body: "",
        split_percentage: 40,
      },
    ],
  };
  const recorded = [
    variant("A"),
    variant("old", { step_index: 4, variant_label: "B", sent: 500 }),
  ];
  const result = getStepABPerformanceVariants(step, recorded, "seq");
  assert.equal(result[0].sent, 100);
  assert.equal(result[0].step_index, 4);
  assert.equal(result[0].subject, "Edited subject");
  assert.equal(result[0].split_percentage, 60);
  assert.equal(result[1].sent, 0);
  assert.equal(
    getStepABPerformanceVariants(step, recorded, "other")[0].sent,
    0,
  );
  assert.equal(recorded[0].step_index, 0);
});

test("legacy IDs resolve once by original sequence/step and follow later moves", () => {
  const step: EmailSequenceStep = {
    order: 2,
    type: "ab_test",
    variants: [
      { variant_label: "A", subject: "", body: "", split_percentage: 100 },
    ],
  };
  const recorded = [
    variant("other", { step_index: 0 }),
    variant("match", { step_index: 2, variant_label: "A" }),
  ];
  const [resolved] = hydrateABVariantIds([step], recorded, "seq");
  assert.equal(resolved.variants?.[0].id, "match");
  assert.equal(step.variants?.[0].id, undefined);
  const rows = getStepABPerformanceVariants(
    { ...resolved, order: 0 },
    [
      variant("other", { step_index: 0 }),
      variant("match", { step_index: 2, variant_label: "A" }),
    ],
    "seq",
  );
  assert.equal(rows[0].id, "match");
  assert.equal(rows[0].sent, 100);
  assert.equal(getStepABPerformanceVariants(step, recorded, "seq")[0].sent, 0);
});
