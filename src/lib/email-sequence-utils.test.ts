import test from "node:test";
import assert from "node:assert/strict";
import {
  reorderSteps,
  convertEmailStepToABTest,
  redistributeABVariantSplit,
  selectedStepIndexAfterMove,
  validateSequenceSteps,
} from "./email-sequence-utils.ts";
import type { EmailSequenceStep } from "../types/email.ts";

test("starting an A/B test preserves email HTML, tokens, metadata and position", () => {
  const email: EmailSequenceStep = {
    order: 3,
    type: "email",
    subject: "Hello {{first_name}}",
    body: "<p>Original <strong>copy</strong></p>",
    body_format: "html",
    delay_hours: 48,
  };
  const result = convertEmailStepToABTest(email);
  assert.equal(result.type, "ab_test");
  assert.equal(result.order, 3);
  assert.equal(result.delay_hours, 48);
  assert.equal(result.variants?.length, 2);
  assert.notEqual(result.variants?.[0].id, result.variants?.[1].id);
  assert.deepEqual(
    result.variants?.map(({ id, ...variant }) => variant),
    ["A", "B"].map((variant_label) => ({
      variant_label,
      subject: email.subject,
      body: email.body,
      body_format: "html",
      split_percentage: 50,
    })),
  );
  assert.equal(email.type, "email");
  assert.equal(email.variants, undefined);
  assert.equal(convertEmailStepToABTest(result), result);
  const delay: EmailSequenceStep = { order: 0, type: "delay", delay_hours: 24 };
  assert.equal(convertEmailStepToABTest(delay), delay);
});

test("editing any audience split keeps 2–4 variants at exactly 100 percent", () => {
  for (let count = 2; count <= 4; count++) {
    const variants = Array.from({ length: count }, (_, i) => ({
      id: String(i),
      variant_label: String(i),
      subject: "Subject",
      body: "Body",
      split_percentage:
        i === count - 1
          ? 100 - Math.floor(100 / count) * (count - 1)
          : Math.floor(100 / count),
    }));
    const before = structuredClone(variants);
    for (let index = 0; index < count; index++) {
      for (const percentage of [0, 1, 40, 99, 100, -5, 120, NaN]) {
        const result = redistributeABVariantSplit(variants, index, percentage);
        assert.equal(
          result.reduce((sum, variant) => sum + variant.split_percentage, 0),
          100,
        );
        assert.ok(result.every((variant) => variant.split_percentage >= 0));
        assert.deepEqual(
          result.map((variant) => variant.id),
          variants.map((variant) => variant.id),
        );
      }
    }
    assert.deepEqual(variants, before);
    const zeroWeights = variants.map((variant) => ({
      ...variant,
      split_percentage: 0,
    }));
    assert.equal(
      redistributeABVariantSplit(zeroWeights, 0, 40).reduce(
        (sum, v) => sum + v.split_percentage,
        0,
      ),
      100,
    );
  }
});

test("moving a step down changes its position and renumbers the sequence", () => {
  const steps: EmailSequenceStep[] = [
    { order: 0, type: "email", subject: "First", body: "Hi" },
    { order: 1, type: "delay", delay_hours: 24 },
    { order: 2, type: "email", subject: "Second", body: "Hello" },
  ];
  const result = reorderSteps(steps, 0, 1);
  assert.deepEqual(
    result.map((step) => step.type),
    ["delay", "email", "email"],
  );
  assert.deepEqual(
    result.map((step) => step.order),
    [0, 1, 2],
  );
  assert.equal(steps[0].subject, "First");
  assert.equal(reorderSteps(steps, 0, 2)[2].subject, "First");
  assert.equal(reorderSteps(steps, 2, 0)[0].subject, "Second");
});

test("empty follow-up subjects inherit the prior email thread", () => {
  assert.deepEqual(
    validateSequenceSteps([
      { order: 0, type: "email", subject: "First", body: "Hello" },
      { order: 1, type: "delay", delay_hours: 24 },
      { order: 2, type: "email", subject: "", body: "Following up" },
      {
        order: 3,
        type: "ab_test",
        variants: [
          {
            variant_label: "A",
            subject: "",
            body: "A follow-up",
            split_percentage: 50,
          },
          {
            variant_label: "B",
            subject: "",
            body: "B follow-up",
            split_percentage: 50,
          },
        ],
      },
    ]),
    [],
  );
});

test("a delay before the first email cannot provide a missing opener subject", () => {
  const errors = validateSequenceSteps([
    { order: 0, type: "delay", delay_hours: 24 },
    { order: 1, type: "email", subject: "", body: "Hello" },
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "subject");
});

test("opener A/B variants still require subjects and empty follow-up bodies stay invalid", () => {
  const errors = validateSequenceSteps([
    {
      order: 0,
      type: "ab_test",
      variants: [
        {
          variant_label: "A",
          subject: "",
          body: "Hello",
          split_percentage: 50,
        },
        { variant_label: "B", subject: "", body: "Hi", split_percentage: 50 },
      ],
    },
    { order: 1, type: "email", subject: "", body: "<p><br></p>" },
  ]);
  assert.deepEqual(
    errors.map((error) => error.field),
    ["variant_0_subject", "variant_1_subject", "body"],
  );
});

test("reordering retains the selected step when it moves or another crosses it", () => {
  assert.equal(selectedStepIndexAfterMove(0, 0, 3), 3);
  assert.equal(selectedStepIndexAfterMove(3, 3, 0), 0);
  assert.equal(selectedStepIndexAfterMove(2, 0, 3), 1);
  assert.equal(selectedStepIndexAfterMove(1, 3, 0), 2);
  assert.equal(selectedStepIndexAfterMove(4, 0, 2), 4);
  assert.equal(selectedStepIndexAfterMove(0, 2, 4), 0);
  assert.equal(selectedStepIndexAfterMove(null, 0, 2), null);
});

test("moving A/B and control steps preserves content, IDs and inputs", () => {
  const steps: EmailSequenceStep[] = [
    {
      order: 0,
      type: "email",
      subject: "First",
      body: "<p>Keep email HTML</p>",
      body_format: "html",
    },
    { order: 1, type: "delay", delay_hours: 72 },
    {
      order: 2,
      type: "ab_test",
      variants: [
        {
          id: "variant-a",
          variant_label: "A",
          subject: "A",
          body: "<p>A copy</p>",
          body_format: "html",
          split_percentage: 50,
        },
        {
          id: "variant-b",
          variant_label: "B",
          subject: "B",
          body: "B copy",
          split_percentage: 50,
        },
      ],
    },
    {
      order: 3,
      type: "condition",
      condition_type: "clicked",
      condition_timeout_hours: 48,
    },
  ];
  const before = JSON.stringify(steps);
  const moved = reorderSteps(steps, 2, 0);
  assert.deepEqual(moved[0].variants, steps[2].variants);
  assert.equal(moved[1].body, steps[0].body);
  assert.equal(moved[1].body_format, "html");
  assert.equal(moved[2].delay_hours, 72);
  assert.equal(moved[3].condition_type, "clicked");
  assert.deepEqual(
    moved.map((step) => step.order),
    [0, 1, 2, 3],
  );
  assert.equal(JSON.stringify(steps), before);
  assert.strictEqual(reorderSteps(steps, -1, 0), steps);
  assert.strictEqual(reorderSteps(steps, 0, 9), steps);
});
