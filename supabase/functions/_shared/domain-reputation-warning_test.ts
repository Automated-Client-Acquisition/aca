import { warnDomainReputation } from "./domain-reputation-warning.ts";

const params = {
  domainId: "domain-id", domain: "sender.test", organizationId: "org-id",
  healthStatus: "burned", blockCount: 5, reconciledCount: 10,
  windowHours: 24, sample: "550 reputation refusal", provider: "google" as const,
  notify: false,
};

function fakeHealthLog(count: number, lookupError = false) {
  const inserted: Array<Record<string, unknown>> = [];
  const filters: string[] = [];
  const client = {
    from(table: string) {
      if (table !== "email_domain_health_log") throw new Error(`Unexpected write/query: ${table}`);
      const query = {
        select() { return query; }, eq() { return query; },
        like(_field: string, value: string) { filters.push(value); return query; },
        gte() { return Promise.resolve({ count, error: lookupError ? { message: "unavailable" } : null }); },
        insert(row: Record<string, unknown>) { inserted.push(row); return Promise.resolve({ error: null }); },
      };
      return query;
    },
  };
  return { client, inserted, filters };
}

Deno.test("critical warning is diagnostic only and explains recipient scope", async () => {
  const fake = fakeHealthLog(0);
  const result = await warnDomainReputation(fake.client as unknown as Parameters<typeof warnDomainReputation>[0], params);
  if (!result.warned || result.reason !== "logged_only") throw new Error("Observation must be log-only");
  if (fake.inserted.length !== 1) throw new Error("Expected one health observation");
  const notes = String(fake.inserted[0].notes);
  for (const expected of ["[google]", "5/10", "Google recipients", "not all providers/mailboxes", "Monitoring continues; sending unchanged", "Operator may pause/resume"]) {
    if (!notes.includes(expected)) throw new Error(`Missing warning context: ${expected}`);
  }
});

Deno.test("warning dedupe is provider-scoped and avoids repeated writes", async () => {
  const fake = fakeHealthLog(1);
  const result = await warnDomainReputation(fake.client as unknown as Parameters<typeof warnDomainReputation>[0], params);
  if (result.warned || result.reason !== "already_warned" || fake.inserted.length) throw new Error("Duplicate observation must be skipped");
  if (fake.filters[0] !== "EARLY WARNING [google]%") throw new Error("Provider scope must participate in dedupe");
});

Deno.test("warning lookup failure avoids unbounded log or notification writes", async () => {
  const fake = fakeHealthLog(0, true);
  const result = await warnDomainReputation(fake.client as unknown as Parameters<typeof warnDomainReputation>[0], params);
  if (result.warned || result.reason !== "dedupe_lookup_failed" || fake.inserted.length) throw new Error("Unavailable dedupe must not produce writes");
});
