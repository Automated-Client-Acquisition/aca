import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveDailyLimit,
  summarizeFleet,
  summarizePool,
  type FleetDemand,
  type FleetSequenceDemand,
} from "./fleet-demand.ts";

function seq(
  id: string,
  overrides: Partial<FleetSequenceDemand> = {},
): FleetSequenceDemand {
  return {
    id,
    name: id,
    daily_limit: 1000,
    tags: [],
    tag_match: "any",
    sent_today: 0,
    due: 1000,
    demand: 1000,
    pool_capacity: 4063,
    shared_capacity: 4063,
    ...overrides,
  };
}

function demand(overrides: Partial<FleetDemand> = {}): FleetDemand {
  const bucket = { mailboxes: 1211, capacity: 4063, sent_today: 0 };
  return {
    day_start: "2026-10-20T00:00:00Z",
    blocked_domain_ids: [],
    fleet: bucket,
    pool: bucket,
    sequences: [],
    self: null,
    ...overrides,
  };
}

test("org view sums every active sequence against the whole fleet", () => {
  const s = summarizeFleet(
    demand({
      sequences: [
        seq("a", { daily_limit: 2500, due: 2500, demand: 2500 }),
        seq("b", { daily_limit: 2500, due: 2500, demand: 2500 }),
        seq("c"),
        seq("idle", { due: 0, demand: 0 }),
      ],
    }),
  );
  assert.equal(s.capacity, 4063);
  assert.equal(s.asked, 6000);
  assert.equal(s.overBy, 1937);
  assert.deepEqual(
    s.lines.map((l) => l.id),
    ["a", "b", "c"],
  );
});

test("a sequence with few due leads only asks for those", () => {
  const s = summarizeFleet(
    demand({ sequences: [seq("parity", { daily_limit: 500, due: 15, demand: 15 })] }),
  );
  assert.equal(s.asked, 15);
  assert.equal(s.lines[0].due, 15);
  assert.equal(s.overBy, 0);
});

test("pool view adds this sequence's live limit and skips non-overlapping pools", () => {
  const s = summarizePool(
    demand({
      sequences: [
        seq("shared", { daily_limit: 3000, due: 3000, demand: 3000 }),
        seq("other-tag", { shared_capacity: 0 }),
      ],
    }),
    2500,
  );
  assert.equal(s.asked, 5500);
  assert.equal(s.overBy, 1437);
  assert.deepEqual(
    s.lines.map((l) => l.name),
    ["shared", "This sequence"],
  );
});

test("a competitor only counts up to the capacity it shares with this pool", () => {
  const s = summarizePool(
    demand({
      pool: { mailboxes: 100, capacity: 300, sent_today: 0 },
      sequences: [seq("big", { daily_limit: 2500, due: 2500, demand: 2500, shared_capacity: 300 })],
    }),
    100,
  );
  assert.equal(s.asked, 400);
  assert.equal(s.overBy, 100);
});

test("an active sequence asks for what it has due; a draft asks for its limit", () => {
  const active = summarizePool(
    demand({ self: { status: "active", sent_today: 10, due: 30 } }),
    2500,
  );
  assert.equal(active.asked, 40);
  assert.equal(active.lines[0].due, 30);

  const draft = summarizePool(
    demand({ self: { status: "draft", sent_today: 0, due: 0 } }),
    2500,
  );
  assert.equal(draft.asked, 2500);
});

test("no daily limit asks for the whole pool", () => {
  const s = summarizePool(demand({ sequences: [seq("x")] }), null);
  assert.equal(s.asked, 4063 + 1000);
  assert.equal(s.lines.find((l) => l.id === null)?.limit, null);
});

test("effectiveDailyLimit mirrors the worker's defaults", () => {
  assert.equal(effectiveDailyLimit({}), 30);
  assert.equal(effectiveDailyLimit({ daily_limit: null }), null);
  assert.equal(effectiveDailyLimit({ daily_limit: 0 }), null);
  assert.equal(effectiveDailyLimit({ daily_limit: 2500 }), 2500);
});

test("a few emails over from rounding is not flagged; more than 1% is", () => {
  const even = (limit: number) =>
    summarizeFleet(
      demand({
        fleet: { mailboxes: 1211, capacity: 6055, sent_today: 0 },
        sequences: ["a", "b", "c", "d"].map((id) =>
          seq(id, { daily_limit: limit, due: limit, demand: limit }),
        ),
      }),
    );
  assert.equal(even(1514).overBy, 1);
  assert.equal(even(1514).oversubscribed, false);
  assert.equal(even(1600).oversubscribed, true);
});
