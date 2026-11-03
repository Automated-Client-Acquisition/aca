import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { kickerRepeatsHeadline } from "../carousel/plan.ts";

// The live 09-29 deck: "3 SIGNALS" over "3 signals your prospect is ready to sign".
Deno.test("kicker - a cover kicker made only of headline words is a repeat", () => {
  assert(kickerRepeatsHeadline("3 SIGNALS", "3 signals your prospect is ready to sign"));
  assert(kickerRepeatsHeadline("SIGNAL", "3 signals your prospect is ready to sign"));
  assert(!kickerRepeatsHeadline("FOR B2B SELLERS", "3 signals your prospect is ready to sign"));
  assert(!kickerRepeatsHeadline("THE PLAYBOOK", "3 signals your prospect is ready to sign"));
  assert(!kickerRepeatsHeadline("", "anything"));
});
