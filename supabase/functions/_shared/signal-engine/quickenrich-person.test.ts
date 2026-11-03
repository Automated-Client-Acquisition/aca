import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifySignalBuyerPersona,
  normalizeQuickenrichSignalCandidate,
  normalizeQuickenrichSignalPerson,
  prioritizeSignalCandidates,
} from "./quickenrich-person.ts";

const domain = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
      .toLowerCase()
    : null;
const rank = () => 70;

Deno.test("structured name wins over conflicting provider display name", () => {
  const person = normalizeQuickenrichSignalPerson(
    {
      first_name: "Simon",
      last_name: "Brooks",
      full_name: "Stephen Bruington",
      email: "simon.brooks@acme.com",
      employee_linkedin: "https://linkedin.com/in/simonbrooks26/?trk=x",
      company_url: "acme.com",
      title: "VP Sales",
      email_verification_date: "2026-09-09",
    },
    "acme.com",
    domain,
    rank,
  );
  assertEquals(person?.full_name, "Simon Brooks");
  assertEquals(
    person?.linkedin_url,
    "https://www.linkedin.com/in/simonbrooks26",
  );
});

Deno.test("rejects cross-channel identity mismatches and wrong companies", () => {
  assertEquals(
    normalizeQuickenrichSignalPerson(
      {
        first_name: "Stephen",
        last_name: "Bruington",
        email: "stephen.bruington@acme.com",
        employee_linkedin: "https://linkedin.com/in/simonbrooks26",
        company_url: "acme.com",
        title: "VP Sales",
      },
      "acme.com",
      domain,
      rank,
    ),
    null,
  );
  assertEquals(
    normalizeQuickenrichSignalPerson(
      {
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@other.com",
        employee_linkedin: "https://linkedin.com/in/adalovelace",
        company_url: "other.com",
        title: "CEO",
      },
      "acme.com",
      domain,
      rank,
    ),
    null,
  );
});

Deno.test("classifies actual buyers and rejects misleading partner titles", () => {
  assertEquals(
    classifySignalBuyerPersona("Founder & CEO")?.persona,
    "executive",
  );
  assertEquals(
    classifySignalBuyerPersona("VP of Sales")?.persona,
    "sales_revenue",
  );
  assertEquals(
    classifySignalBuyerPersona("Head of Growth")?.persona,
    "marketing_growth",
  );
  assertEquals(classifySignalBuyerPersona("Senior People Partner"), null);
  assertEquals(
    classifySignalBuyerPersona("Partner Sales Account Manager"),
    null,
  );
  assertEquals(classifySignalBuyerPersona("Director of Engineering"), null);
  assertEquals(classifySignalBuyerPersona("Product Owner"), null);
});

Deno.test("persona candidate ranking fills missing buyer lanes first", () => {
  const rows = [
    {
      first_name: "Ada",
      last_name: "Lovelace",
      title: "CEO",
      employee_linkedin: "linkedin.com/in/adalovelace",
      company_url: "acme.com",
    },
    {
      first_name: "Grace",
      last_name: "Hopper",
      title: "VP Sales",
      employee_linkedin: "linkedin.com/in/gracehopper",
      company_url: "acme.com",
    },
    {
      first_name: "Katherine",
      last_name: "Johnson",
      title: "Head of Marketing",
      employee_linkedin: "linkedin.com/in/katherinejohnson",
      company_url: "acme.com",
    },
  ];
  const candidates = rows.map((row) =>
    normalizeQuickenrichSignalCandidate(row, "acme.com", domain)
  ).filter((row) => row !== null);
  assertEquals(
    prioritizeSignalCandidates(candidates, ["executive"]).map((row) =>
      row.outreach_persona
    ),
    [
      "sales_revenue",
      "marketing_growth",
    ],
  );
});
