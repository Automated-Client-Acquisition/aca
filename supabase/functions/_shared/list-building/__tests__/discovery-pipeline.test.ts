/**
 * Discovery event identity regression tests.
 * Run: deno test --allow-all supabase/functions/_shared/list-building/__tests__/discovery-pipeline.test.ts
 */

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  discoveryEventKey,
  isEligiblePersonFirstDecisionMaker,
} from "../discovery-pipeline.ts";
import type { DiscoveryRecord } from "../pack-modules/types.ts";

function record(overrides: Partial<DiscoveryRecord> = {}): DiscoveryRecord {
  return {
    company: {
      company_name: "Acme Inc",
      domain: "acme.example",
      website_url: "https://acme.example",
      linkedin_url: "https://www.linkedin.com/company/acme",
      source: "directory",
      raw_html_snippet: null,
    },
    source: "signalbase_funding",
    source_url: "https://source.example/funding/acme-series-a",
    signal_metadata: {
      type: "funding",
      date: "2026-08-05",
      detail: "Series A",
      evidence_url: "https://source.example/funding/acme-series-a",
    },
    ...overrides,
  };
}

Deno.test("discoveryEventKey: an exact replay keeps the same identity", () => {
  assertEquals(discoveryEventKey(record()), discoveryEventKey(record()));
});

Deno.test("discoveryEventKey: keeps distinct same-day events for one company", () => {
  const funding = record();
  const hiring = record({
    source: "signalbase_hiring",
    source_url: "https://source.example/hiring/acme-engineers",
    signal_metadata: {
      type: "hiring",
      date: "2026-08-05",
      detail: "Opened 20 engineering roles",
      evidence_url: "https://source.example/hiring/acme-engineers",
    },
  });
  assertNotEquals(discoveryEventKey(funding), discoveryEventKey(hiring));
});

Deno.test("discoveryEventKey: uses a provider record id when no evidence URL exists", () => {
  const first = record({
    source_url: "",
    signal_metadata: {
      type: "funding",
      date: "2026-08-05",
      detail: "Seed",
      evidence_url: "",
    },
    raw_signal: { signalId: "provider-1" },
  });
  const second = record({
    source_url: "",
    signal_metadata: {
      type: "funding",
      date: "2026-08-05",
      detail: "Seed",
      evidence_url: "",
    },
    raw_signal: { signalId: "provider-2" },
  });
  assertNotEquals(discoveryEventKey(first), discoveryEventKey(second));
});

Deno.test("person-first ACA entry requires a senior person and a personal LinkedIn URL", () => {
  assertEquals(isEligiblePersonFirstDecisionMaker({
    first: "Ada",
    last: "Lovelace",
    title: "VP of Engineering",
    linkedin_url: "https://www.linkedin.com/in/ada-lovelace",
  }), true);
  assertEquals(isEligiblePersonFirstDecisionMaker({
    first: "Ada",
    last: "Lovelace",
    title: "Software Engineer",
    linkedin_url: "https://www.linkedin.com/in/ada-lovelace",
  }), false);
  assertEquals(isEligiblePersonFirstDecisionMaker({
    first: "Ada",
    last: "Lovelace",
    title: "CEO",
    linkedin_url: "https://www.linkedin.com/company/acme",
  }), false);
});
