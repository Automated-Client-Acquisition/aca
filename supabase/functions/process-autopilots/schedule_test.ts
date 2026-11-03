// Regression tests for autopilot run scheduling.
//
// Run: deno test supabase/functions/process-autopilots/schedule_test.ts
//
// The bug these guard against: optimal ("smart timing") mode used to ignore the
// configured `frequency` and fire at every hardcoded engagement hour, so a
// "1/day, optimal" autopilot posted ~5x/day. Tests 1-3 fail against that old
// behavior and pass against the cadence-respecting fix.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  AutopilotSchedule,
  calculateNextRun,
  frequencyIntervalMs,
  getTimezoneOffset,
  nextSlotAfter,
  OPTIMAL_HOURS,
  SCHEDULED_LEAD_MS,
  slotForRun,
  snapToOptimalHour,
  upcomingSlots,
  weeklySlots,
} from "./schedule.ts";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-06-05T08:00:00.000Z"); // 08:00 UTC, deterministic anchor

function base(overrides: Partial<AutopilotSchedule>): AutopilotSchedule {
  return {
    frequency: { amount: 1, unit: "day" },
    scheduling_mode: "immediate",
    timezone: "UTC",
    scheduled_times: undefined,
    ...overrides,
  };
}

// ── The core regression ──────────────────────────────────────────────────────

Deno.test("optimal mode RESPECTS a 1/day cadence (the reported bug)", () => {
  const next = calculateNextRun(
    base({ frequency: { amount: 1, unit: "day" }, scheduling_mode: "optimal" }),
    NOW,
  );
  const deltaHours = (next.getTime() - NOW.getTime()) / HOUR;

  // ~1 day out, NOT a few hours out. Old code returned the next optimal hour
  // (09:00 same day = +1h), which would fail this assertion.
  assert(
    deltaHours >= 23,
    `expected next run ~1 day out, got ${deltaHours.toFixed(1)}h`,
  );
  // ...and still aligned to an engagement hour.
  assert(
    OPTIMAL_HOURS.includes(next.getUTCHours()),
    `expected an optimal hour, got ${next.getUTCHours()}:00`,
  );
});

Deno.test("optimal mode RESPECTS a 3/week cadence", () => {
  // 3/week preset = every 56 hours.
  const next = calculateNextRun(
    base({ frequency: { amount: 56, unit: "hour" }, scheduling_mode: "optimal" }),
    NOW,
  );
  const deltaHours = (next.getTime() - NOW.getTime()) / HOUR;
  assert(
    deltaHours >= 55,
    `expected next run ~56h out, got ${deltaHours.toFixed(1)}h`,
  );
  assert(OPTIMAL_HOURS.includes(next.getUTCHours()));
});

Deno.test("optimal mode CAPS a sub-daily cadence to the daytime engagement window", () => {
  // 2/day preset = every 12 hours. From 08:00 the +12h target is 20:00, which
  // is past the last optimal hour (19:00) — there is no good overnight slot, so
  // it snaps forward to the next morning's first optimal hour (09:00 next day).
  //
  // This is the deliberate tradeoff: optimal mode never posts MORE often than
  // the cadence (the reported bug was over-posting). A user who genuinely wants
  // 2 posts/day with tight spacing should use `immediate` mode, since the
  // optimal hours are all clustered in the daytime. The old logic instead fired
  // at every optimal hour (~+1h gaps) regardless of the 12h cadence.
  const next = calculateNextRun(
    base({ frequency: { amount: 12, unit: "hour" }, scheduling_mode: "optimal" }),
    NOW,
  );
  assertEquals(next.getUTCHours(), 9); // first optimal hour of...
  assertEquals(next.getUTCDate(), 6); // ...the next day
  // Crucially: NOT +1h like the old all-optimal-hours behavior.
  assert((next.getTime() - NOW.getTime()) / HOUR >= 11);
});

// ── Immediate mode still works ───────────────────────────────────────────────

Deno.test("immediate mode uses the exact frequency interval (1/day)", () => {
  const next = calculateNextRun(
    base({ frequency: { amount: 1, unit: "day" }, scheduling_mode: "immediate" }),
    NOW,
  );
  assertEquals(next.getTime() - NOW.getTime(), 24 * HOUR);
});

Deno.test("immediate mode uses the exact frequency interval (every 6h)", () => {
  const next = calculateNextRun(
    base({ frequency: { amount: 6, unit: "hour" }, scheduling_mode: "immediate" }),
    NOW,
  );
  assertEquals(next.getTime() - NOW.getTime(), 6 * HOUR);
});

// ── Scheduled mode: next slot, started an hour early ─────────────────────────

Deno.test("scheduled mode picks the next explicit time today", () => {
  const schedule = base({ scheduling_mode: "scheduled", scheduled_times: ["09:00", "17:00"] });
  // 08:00 → next slot is 09:00 same day
  assertEquals(nextSlotAfter(schedule, NOW)!.at.toISOString(), "2026-06-05T09:00:00.000Z");
});

Deno.test("scheduled mode rolls to tomorrow's first slot when all passed", () => {
  const lateNow = new Date("2026-06-05T20:00:00.000Z"); // after 17:00
  const schedule = base({ scheduling_mode: "scheduled", scheduled_times: ["09:00", "17:00"] });
  assertEquals(nextSlotAfter(schedule, lateNow)!.at.toISOString(), "2026-06-06T09:00:00.000Z");
});

Deno.test("scheduled runs start SCHEDULED_LEAD_MS before their slot", () => {
  const schedule = base({ scheduling_mode: "scheduled", scheduled_times: ["17:00"] });
  const next = calculateNextRun(schedule, NOW);
  assertEquals(next.toISOString(), "2026-06-05T16:00:00.000Z");
  assertEquals(SCHEDULED_LEAD_MS, HOUR);
});

Deno.test("scheduled: a slot closer than the lead isn't skipped after a run", () => {
  // The 09:00 run started at 08:07; 09:30 is the next slot even though it's
  // less than an hour after now + lead.
  const schedule = base({ scheduling_mode: "scheduled", scheduled_times: ["09:00", "09:30"] });
  const now = new Date("2026-06-05T08:07:00.000Z");
  const next = calculateNextRun(schedule, now, new Date("2026-06-05T09:00:00.000Z"));
  assertEquals(next.toISOString(), "2026-06-05T08:30:00.000Z");
  assertEquals(slotForRun(schedule, next)!.at.toISOString(), "2026-06-05T09:30:00.000Z");
});

Deno.test("scheduled: a late run doesn't backfill missed slots", () => {
  const schedule = base({ scheduling_mode: "scheduled", scheduled_times: ["09:00", "12:00", "17:00"] });
  const now = new Date("2026-06-05T13:00:00.000Z"); // cron was down from 08:00
  const next = calculateNextRun(schedule, now, new Date("2026-06-05T09:00:00.000Z"));
  assertEquals(next.toISOString(), "2026-06-05T16:00:00.000Z"); // the 17:00 slot
});

Deno.test("slotForRun: a next_run_at without the lead belongs to the slot at that time", () => {
  const schedule = base({ scheduling_mode: "scheduled", scheduled_times: ["09:00", "17:00"] });
  assertEquals(slotForRun(schedule, new Date("2026-06-05T09:00:00.000Z"))!.at.toISOString(), "2026-06-05T09:00:00.000Z");
  assertEquals(slotForRun(schedule, new Date("2026-06-05T08:00:00.000Z"))!.at.toISOString(), "2026-06-05T09:00:00.000Z");
});

// ── Plan each day: schedule_slots ────────────────────────────────────────────

const PLANNED = base({
  scheduling_mode: "scheduled",
  timezone: "UTC",
  // Ignored while schedule_slots is set
  scheduled_times: ["06:00"],
  schedule_slots: [
    { day: 1, time: "09:00" },
    { day: 3, time: "17:00" },
    { day: 3, time: "09:00", blueprint_id: "carousel" },
    { day: 6, time: "11:00", blueprint_id: "notepad" },
  ],
});

Deno.test("schedule_slots: different times per day, in order, with pins", () => {
  // Monday 2026-09-28 10:00 UTC
  const slots = upcomingSlots(PLANNED, 5, new Date("2026-09-28T10:00:00.000Z"));
  assertEquals(slots.map((s) => [s.at.toISOString(), s.blueprint_id]), [
    ["2026-09-30T09:00:00.000Z", "carousel"],
    ["2026-09-30T17:00:00.000Z", null],
    ["2026-10-03T11:00:00.000Z", "notepad"],
    ["2026-10-05T09:00:00.000Z", null],
    ["2026-10-07T09:00:00.000Z", "carousel"],
  ]);
});

Deno.test("schedule_slots: bad entries are ignored", () => {
  const schedule = base({
    scheduling_mode: "scheduled",
    schedule_slots: [{ day: 9, time: "09:00" }, { day: 1, time: "25:00" }, { day: 2, time: "08:15" }],
  });
  assertEquals(weeklySlots(schedule), [{ day: 2, minutes: 8 * 60 + 15, blueprint_id: null }]);
});

Deno.test("not scheduled → no weekly slots", () => {
  assertEquals(weeklySlots(base({ scheduling_mode: "optimal", scheduled_times: ["09:00"] })), []);
});

// ── Time zones and DST ───────────────────────────────────────────────────────

Deno.test("London 08:00 in summer is 07:00 UTC (posts used to go out at 09:00 BST)", () => {
  const schedule = base({ scheduling_mode: "scheduled", timezone: "Europe/London", scheduled_times: ["08:00"] });
  const slot = nextSlotAfter(schedule, new Date("2026-07-07T16:00:00.000Z"))!;
  assertEquals(slot.at.toISOString(), "2026-07-08T07:00:00.000Z");
});

Deno.test("a slot after the clocks change uses the new offset", () => {
  // BST ends Sunday 2026-10-25. From Saturday 24th, Monday 26th 08:00 London = 08:00 UTC.
  const schedule = base({ scheduling_mode: "scheduled", timezone: "Europe/London", scheduled_times: ["08:00"], scheduled_days: [1] });
  const slot = nextSlotAfter(schedule, new Date("2026-10-24T12:00:00.000Z"))!;
  assertEquals(slot.at.toISOString(), "2026-10-26T08:00:00.000Z");
});

Deno.test("getTimezoneOffset is per instant", () => {
  assertEquals(getTimezoneOffset("Europe/London", new Date("2026-07-01T12:00:00Z")), 1);
  assertEquals(getTimezoneOffset("Europe/London", new Date("2026-12-01T12:00:00Z")), 0);
  assertEquals(getTimezoneOffset("Asia/Kolkata", new Date("2026-12-01T12:00:00Z")), 5.5);
  assertEquals(getTimezoneOffset("Not/AZone"), 0);
});

// ── snapToOptimalHour invariants ─────────────────────────────────────────────

Deno.test("snapToOptimalHour: result is always >= target and on an optimal hour", () => {
  for (let h = 0; h < 24; h++) {
    const target = new Date(Date.UTC(2026, 5, 5, h, 30, 0)); // :30 each hour
    const snapped = snapToOptimalHour(target, "UTC");
    assert(
      snapped.getTime() >= target.getTime() - HOUR,
      `snapped before target for h=${h}`,
    );
    assert(
      OPTIMAL_HOURS.includes(snapped.getUTCHours()),
      `not an optimal hour for h=${h}: got ${snapped.getUTCHours()}`,
    );
  }
});

Deno.test("snapToOptimalHour: handles a negative-offset timezone without date drift", () => {
  // 03:00 UTC = 22:00 (10pm) previous day in New York (UTC-4/-5).
  // Past all optimal hours that local day → must land on the NEXT local day's
  // first optimal hour (09:00 local), not skip a day.
  const target = new Date("2026-06-05T03:00:00.000Z");
  const snapped = snapToOptimalHour(target, "America/New_York");
  const nyHour = Number(
    snapped.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }).slice(0, 2),
  );
  assertEquals(nyHour % 24, 9); // 09:00 local
});

// ── frequencyIntervalMs ──────────────────────────────────────────────────────

Deno.test("frequencyIntervalMs converts each unit correctly", () => {
  assertEquals(frequencyIntervalMs({ amount: 3, unit: "hour" }), 3 * HOUR);
  assertEquals(frequencyIntervalMs({ amount: 2, unit: "day" }), 48 * HOUR);
  assertEquals(frequencyIntervalMs({ amount: 1, unit: "week" }), 168 * HOUR);
});

// ── scheduled mode with weekdays ─────────────────────────────────────────────

Deno.test("scheduled + weekdays: skips days that aren't listed", () => {
  // Thursday 2026-09-24 10:00 UTC; Mon/Wed/Fri at 09:00 UTC → Friday 09:00.
  const now = new Date("2026-09-24T10:00:00.000Z");
  const next = nextSlotAfter(
    { frequency: { amount: 1, unit: "day" }, scheduling_mode: "scheduled", timezone: "UTC", scheduled_times: ["09:00"], scheduled_days: [1, 3, 5] },
    now,
  )!.at;
  assertEquals(next.toISOString(), "2026-09-25T09:00:00.000Z");
});

Deno.test("scheduled + weekdays: later slot today still counts when today is listed", () => {
  // Friday 2026-09-25 08:00 UTC, Fri at 09:00 → today 09:00.
  const now = new Date("2026-09-25T08:00:00.000Z");
  const next = nextSlotAfter(
    { frequency: { amount: 1, unit: "day" }, scheduling_mode: "scheduled", timezone: "UTC", scheduled_times: ["09:00"], scheduled_days: [5] },
    now,
  )!.at;
  assertEquals(next.toISOString(), "2026-09-25T09:00:00.000Z");
});

Deno.test("scheduled + weekdays: wraps to next week", () => {
  // Friday 2026-09-25 10:00 UTC, only Fridays at 09:00 → next Friday.
  const now = new Date("2026-09-25T10:00:00.000Z");
  const next = nextSlotAfter(
    { frequency: { amount: 1, unit: "day" }, scheduling_mode: "scheduled", timezone: "UTC", scheduled_times: ["09:00"], scheduled_days: [5] },
    now,
  )!.at;
  assertEquals(next.toISOString(), "2026-10-02T09:00:00.000Z");
});

Deno.test("scheduled + weekdays: weekday is judged in local time", () => {
  // 2026-09-26 02:00 UTC is still Friday 22:00 in New York. Mondays at 09:00 NY
  // (13:00 UTC in EDT) → Monday 2026-09-28 13:00 UTC.
  const now = new Date("2026-09-26T02:00:00.000Z");
  const next = nextSlotAfter(
    { frequency: { amount: 1, unit: "day" }, scheduling_mode: "scheduled", timezone: "America/New_York", scheduled_times: ["09:00"], scheduled_days: [1] },
    now,
  )!.at;
  assertEquals(next.toISOString(), "2026-09-28T13:00:00.000Z");
});
