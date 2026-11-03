import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { QuickenrichCompanyFinderError } from '../enrichment/quickenrich.ts';
import { resolveCompany, type CompanyIdentity, type ResolveDeps } from './resolve.ts';

type Row = Record<string, unknown>;
type QueryResult = { data: Row | Row[] | null; error: null };
type RpcCall = { name: string; args: Row };

class StubSupabase {
  tables: Record<string, Row[]>;
  rpcCalls: RpcCall[] = [];
  mutations: Array<{ table: string; action: string; patch: Row }> = [];
  claimStatus: 'granted' | 'cached_miss' | 'busy' = 'granted';
  lookupAttempts = 0;
  onClaim?: () => void;

  constructor(identities: CompanyIdentity[] = []) {
    this.tables = {
      company_identities: identities.map((identity) => ({ ...identity })),
      crm_companies: [],
      lead_pool_verified: [],
    };
  }

  from(table: string) {
    assertEquals(table in this.tables, true, `Unexpected table: ${table}`);
    return new StubQuery(this, table);
  }

  async rpc(name: string, args: Row) {
    this.rpcCalls.push({ name, args });
    if (name === 'claim_signal_company_lookup') {
      this.onClaim?.();
      if (this.claimStatus === 'granted') this.lookupAttempts++;
      return { data: [{ status: this.claimStatus, token: this.claimStatus === 'granted' ? 'fixture-lease' : null }], error: null };
    }
    assertEquals(name, 'finish_signal_company_lookup');
    assertEquals(args.p_token, 'fixture-lease');
    // Model only the finish contract needed to prove unavailable refunds a claim.
    if (args.p_outcome === 'unavailable') this.lookupAttempts--;
    return { data: true, error: null };
  }

  client(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }

  finishes(): Row[] {
    return this.rpcCalls.filter((call) => call.name === 'finish_signal_company_lookup').map((call) => call.args);
  }
}

class StubQuery implements PromiseLike<QueryResult> {
  private filters: Array<(row: Row) => boolean> = [];
  private cap = Infinity;
  private action: 'select' | 'insert' | 'update' = 'select';
  private patch: Row = {};
  private result?: Promise<QueryResult>;

  constructor(private db: StubSupabase, private table: string) {}
  select(_columns: string) { return this; }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    assertEquals(operator, 'is');
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  ilike(column: string, value: string) {
    assertEquals(value.endsWith('%'), true);
    this.filters.push((row) => String(row[column]).toLowerCase().startsWith(value.slice(0, -1).toLowerCase()));
    return this;
  }
  limit(value: number) { this.cap = value; return this; }
  insert(patch: Row) { this.action = 'insert'; this.patch = patch; return this; }
  update(patch: Row) { this.action = 'update'; this.patch = patch; return this; }
  async maybeSingle() {
    const result = await this.execute();
    const rows = result.data as Row[];
    assertEquals(rows.length <= 1, true, 'Fixture query unexpectedly returned multiple identities');
    return { data: rows[0] ?? null, error: null };
  }
  then<T = QueryResult, U = never>(
    fulfilled?: ((value: QueryResult) => T | PromiseLike<T>) | null,
    rejected?: ((reason: unknown) => U | PromiseLike<U>) | null,
  ): PromiseLike<T | U> {
    return this.execute().then(fulfilled, rejected);
  }
  private execute(): Promise<QueryResult> {
    if (!this.result) {
      this.result = Promise.resolve().then(() => {
        let rows = this.db.tables[this.table].filter((row) => this.filters.every((filter) => filter(row))).slice(0, this.cap);
        if (this.action === 'insert') {
          const row = { id: `inserted-${this.db.tables[this.table].length}`, ...this.patch };
          this.db.tables[this.table].push(row);
          rows = [row];
        } else if (this.action === 'update') {
          for (const row of rows) Object.assign(row, this.patch);
        }
        if (this.action !== 'select') this.db.mutations.push({ table: this.table, action: this.action, patch: { ...this.patch } });
        return { data: rows.map((row) => ({ ...row })), error: null };
      });
    }
    return this.result;
  }
}

function identity(overrides: Partial<CompanyIdentity> = {}): CompanyIdentity {
  return {
    id: 'identity-acme', name: 'Acme', name_normalized: 'acme', domain: null,
    linkedin_url: null, cik: null, resolved_via: 'unresolved', resolution_attempts: 0,
    updated_at: new Date().toISOString(), ...overrides,
  };
}

function paidDeps(db: StubSupabase, reserved = 5) {
  let reservations = 0;
  let discoveryReservations = 0;
  const settlements: number[][] = [];
  const deps: ResolveDeps = {
    supabase: db.client(), quickenrichToken: 'fixture-key',
    reserveQuickenrich: async () => { reservations++; return reserved; },
    settleQuickenrich: (limit, used) => { settlements.push([limit, used]); },
    reserveQuickenrichDiscovery: async () => { discoveryReservations++; },
  };
  return { deps, settlements, reservations: () => reservations, discoveryReservations: () => discoveryReservations };
}

const matchingCompany = {
  company_name: 'Acme, Inc.', company_url: 'https://www.acme.example/about',
  country_code: 'US', industry: 'Software', number_of_employees: '42',
};

async function mockFetchCompanyFinder(
  response: (url: string) => Response,
  run: (requests: Row[]) => Promise<void>,
) {
  const original = globalThis.fetch;
  const requests: Row[] = [];
  globalThis.fetch = (async (url, options) => {
    assertEquals(['https://app.quickenrich.io/api/companies/company-finder',
      'https://app.quickenrich.io/api/employees/contact-finder'].includes(String(url)), true, 'Unexpected network request');
    assertEquals(options?.method, 'POST');
    requests.push({ endpoint: String(url), ...JSON.parse(String(options?.body)) });
    return response(String(url));
  }) as typeof fetch;
  try { await run(requests); } finally { globalThis.fetch = original; }
}

const forbidFinder = () => { throw new Error('Free/cache result must not call the paid provider'); };

Deno.test('resolved CIK, domain and name caches never reserve or call Company Finder', async () => {
  for (const hints of [
    { company_name: 'Acme', cik: '123' },
    { company_name: 'Acme', domain: 'acme.example' },
    { company_name: 'Acme' },
  ]) {
    const db = new StubSupabase([identity({ domain: 'acme.example', cik: '0000000123' })]);
    const paid = paidDeps(db);
    await mockFetchCompanyFinder(forbidFinder, async (requests) => {
      const result = await resolveCompany(paid.deps, hints);
      assertEquals(result.identity?.domain, 'acme.example');
      assertEquals(result.billed, false);
      assertEquals(requests.length, 0);
      assertEquals(paid.reservations(), 0);
      assertEquals(db.rpcCalls.length, 0);
    });
  }
});

Deno.test('QuickEnrich can resolve a legacy MoltSets negative name cache without consuming its attempts', async () => {
  const db = new StubSupabase([identity({ resolution_attempts: 2, resolved_via: 'moltsets' })]);
  const paid = paidDeps(db);
  await mockFetchCompanyFinder(() => Response.json({ success: true, data: [matchingCompany], meta: { credits_used: 1 } }), async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'Acme' });
    assertEquals(result.via, 'quickenrich_matched');
    assertEquals(result.identity?.id, 'identity-acme');
    assertEquals(result.identity?.domain, 'acme.example');
    assertEquals(result.identity?.resolution_attempts, 2);
    assertEquals(requests.length, 1);
    assertEquals(db.tables.company_identities.length, 1);
    assertEquals(db.finishes()[0].p_outcome, 'matched');
    assertEquals(paid.settlements, [[5, 1]]);
  });
});

Deno.test('a successful QuickEnrich lookup promotes the existing CIK placeholder', async () => {
  const db = new StubSupabase([identity({ cik: '0000000123', resolution_attempts: 2 })]);
  const paid = paidDeps(db);
  await mockFetchCompanyFinder(() => Response.json({ success: true, data: [matchingCompany] }), async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'Acme', cik: '123', state: 'CA' });
    assertEquals(result.identity?.id, 'identity-acme');
    assertEquals(result.identity?.cik, '0000000123');
    assertEquals(result.identity?.domain, 'acme.example');
    assertEquals(result.identity?.resolved_via, 'quickenrich');
    assertEquals(db.tables.company_identities.length, 1);
    assertEquals(db.mutations.some((entry) => entry.action === 'insert'), false);
    assertEquals(requests[0].country_code, { include: ['US'], exclude: [] });
    assertEquals(db.finishes()[0].p_country, 'US');
  });
});

Deno.test('QuickEnrich cached misses and busy leases spend no credits or identity attempts', async () => {
  for (const status of ['cached_miss', 'busy'] as const) {
    const db = new StubSupabase([identity({ resolution_attempts: 2 })]);
    db.claimStatus = status;
    db.lookupAttempts = 1;
    const paid = paidDeps(db);
    await mockFetchCompanyFinder(forbidFinder, async (requests) => {
      const result = await resolveCompany(paid.deps, { company_name: 'Acme' });
      assertEquals(result.via, status === 'busy' ? 'quickenrich_busy' : 'quickenrich_negative_cache');
      assertEquals(result.billed, false);
      assertEquals(result.paidAttempted, undefined);
      assertEquals(requests.length, 0);
      assertEquals(paid.reservations(), 0);
      assertEquals(db.finishes().length, 0);
      assertEquals(db.lookupAttempts, 1);
      assertEquals(db.tables.company_identities[0].resolution_attempts, 2);
    });
  }
});

Deno.test('provider 402 and 429 release the lookup as unavailable and preserve attempts', async () => {
  for (const [status, code] of [[402, 'INSUFFICIENT_CREDITS'], [429, 'RATE_LIMITED']] as const) {
    const db = new StubSupabase([identity({ resolution_attempts: 2 })]);
    const paid = paidDeps(db);
    await mockFetchCompanyFinder(() => Response.json({ success: false, message: 'Provider unavailable' }, { status }), async (requests) => {
      const error = await assertRejects(() => resolveCompany(paid.deps, { company_name: 'Acme' }), QuickenrichCompanyFinderError);
      assertEquals(error.code, code);
      assertEquals(error.httpStatus, status);
      assertEquals(requests.length, 1);
      assertEquals(paid.settlements, [[5, 0]]);
      assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['unavailable', 0]]);
      assertEquals(db.lookupAttempts, 0);
      assertEquals(db.tables.company_identities[0].resolution_attempts, 2);
    });
  }
});

Deno.test('Company Finder settles actual returned credits even when no name matches', async () => {
  const db = new StubSupabase([identity()]);
  const paid = paidDeps(db);
  await mockFetchCompanyFinder(() => Response.json({ success: true,
    data: [{ ...matchingCompany, company_name: 'Other Company' }], meta: { credits_used: 2 } }), async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'Acme' });
    assertEquals(result.via, 'quickenrich_not_found');
    assertEquals(result.identity?.domain, null);
    assertEquals(result.creditsUsed, 2);
    assertEquals(result.billed, true);
    assertEquals(result.paidAttempted, true);
    assertEquals(requests[0].per_page, 5);
    assertEquals(requests[0].company_name, { include: ['Acme'], exclude: [] });
    assertEquals(paid.settlements, [[5, 2]]);
    assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['not_found', 2]]);
    assertEquals(db.lookupAttempts, 1);
    assertEquals(db.tables.company_identities[0].resolution_attempts, 0);
  });
});

Deno.test('identity resolved after lease acquisition avoids a duplicate paid lookup', async () => {
  const db = new StubSupabase([identity()]);
  db.onClaim = () => { db.tables.company_identities[0].domain = 'acme.example'; };
  const paid = paidDeps(db);
  await mockFetchCompanyFinder(forbidFinder, async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'Acme' });
    assertEquals(result.via, 'cache_name');
    assertEquals(result.identity?.domain, 'acme.example');
    assertEquals(result.billed, false);
    assertEquals(requests.length, 0);
    assertEquals(paid.reservations(), 1);
    assertEquals(paid.settlements, [[5, 0]]);
    assertEquals(db.finishes()[0].p_outcome, 'unavailable');
    assertEquals(db.lookupAttempts, 0);
  });
});

Deno.test('truncated paid results hold ambiguity and reconcile credits without choosing the visible match', async () => {
  const db = new StubSupabase([identity()]);
  const paid = paidDeps(db);
  await mockFetchCompanyFinder(() => Response.json({ success: true, data: [matchingCompany],
    meta: { credits_used: 3, total: 20, has_more: true } }), async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'Acme' });
    assertEquals(result.via, 'quickenrich_ambiguous');
    assertEquals(result.identity?.domain, null);
    assertEquals(result.creditsUsed, 3);
    assertEquals(result.paidAttempted, true);
    assertEquals(requests.length, 1);
    assertEquals(paid.settlements, [[5, 3]]);
    assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['ambiguous', 3]]);
    assertEquals(db.mutations.length, 0);
  });
});

Deno.test('exhausted run credit budget releases the name lease without a provider call', async () => {
  const db = new StubSupabase([identity()]);
  const paid = paidDeps(db, 0);
  await mockFetchCompanyFinder(forbidFinder, async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'Acme' });
    assertEquals(result.via, 'quickenrich_budget');
    assertEquals(result.billed, false);
    assertEquals(requests.length, 0);
    assertEquals(db.finishes()[0].p_outcome, 'unavailable');
    assertEquals(db.lookupAttempts, 0);
  });
});

Deno.test('operational capacity failure before fetching refunds the lookup attempt', async () => {
  const db = new StubSupabase([identity({ resolution_attempts: 2 })]);
  const paid = paidDeps(db);
  paid.deps.reserveQuickenrich = async () => {
    throw new QuickenrichCompanyFinderError('RATE_LIMITED', 429, 'Shared provider capacity exhausted', 60);
  };
  await mockFetchCompanyFinder(forbidFinder, async (requests) => {
    const error = await assertRejects(() => resolveCompany(paid.deps, { company_name: 'Acme' }), QuickenrichCompanyFinderError);
    assertEquals(error.code, 'RATE_LIMITED');
    assertEquals(error.retryAfterSeconds, 60);
    assertEquals(requests.length, 0);
    assertEquals(paid.settlements, [[0, 0]]);
    assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['unavailable', 0]]);
    assertEquals(db.lookupAttempts, 0);
    assertEquals(db.tables.company_identities[0].resolution_attempts, 2);
  });
});

const emptyCompanyResult = () => Response.json({ success: true, data: [], meta: { credits_used: 0, total: 0 } });
const techWolfContact = {
  company_name: 'TechWolf', company_url: 'https://www.techwolf.ai', country_code: 'BE',
  first_name: 'Fixture', last_name: 'Employee',
};

function techWolfPlaceholder() {
  return identity({ id: 'identity-techwolf', name: 'TechWolf', name_normalized: 'techwolf' });
}

Deno.test('free contact fallback resolves 88 agreeing employees to one company identity', async () => {
  const db = new StubSupabase([techWolfPlaceholder()]);
  const paid = paidDeps(db);
  const contacts = Array.from({ length: 88 }, (_, index) => ({ ...techWolfContact, last_name: `Employee ${index}` }));
  await mockFetchCompanyFinder((url) => {
    if (url.endsWith('/company-finder')) return emptyCompanyResult();
    assertEquals(paid.discoveryReservations(), 1, 'Reserve discovery capacity before requesting contacts');
    return Response.json({ success: true, data: contacts, meta: { total: 88, has_more: false, credits_used: 0 } });
  }, async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'TechWolf', country: 'BE' });
    assertEquals(result.via, 'quickenrich_contacts_matched');
    assertEquals(result.identity?.id, 'identity-techwolf');
    assertEquals(result.identity?.domain, 'techwolf.ai');
    assertEquals(result.billed, false);
    assertEquals(result.creditsUsed, 0);
    assertEquals(requests.length, 2);
    assertEquals(requests[1].company_name, { include: ['TechWolf'], exclude: [] });
    assertEquals(requests[1].country_code, { include: ['BE'], exclude: [] });
    assertEquals(requests[1].per_page, 100);
    assertEquals(db.tables.company_identities.length, 1);
    assertEquals(paid.settlements, [[5, 0]]);
    assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['matched', 0]]);
  });
});

Deno.test('both Company Finder and contact fallback empty produce a genuine cached miss', async () => {
  const db = new StubSupabase([identity()]);
  const paid = paidDeps(db);
  await mockFetchCompanyFinder(() => Response.json({ success: true, data: [], meta: { total: 0, has_more: false, credits_used: 0 } }), async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'Acme' });
    assertEquals(result.via, 'quickenrich_contacts_not_found');
    assertEquals(result.identity?.domain, null);
    assertEquals(result.creditsUsed, 0);
    assertEquals(result.billed, false);
    assertEquals(result.paidAttempted, true);
    assertEquals(requests.length, 2);
    assertEquals(paid.discoveryReservations(), 1);
    assertEquals(paid.settlements, [[5, 0]]);
    assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['not_found', 0]]);
    assertEquals(db.lookupAttempts, 1);
  });
});

Deno.test('complete contact fallback with conflicting company domains holds ambiguity', async () => {
  const db = new StubSupabase([techWolfPlaceholder()]);
  const paid = paidDeps(db);
  await mockFetchCompanyFinder((url) => url.endsWith('/company-finder') ? emptyCompanyResult()
    : Response.json({ success: true, data: [techWolfContact, { ...techWolfContact, company_url: 'https://other-techwolf.example' }],
      meta: { total: 2, has_more: false, credits_used: 0 } }), async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'TechWolf' });
    assertEquals(result.via, 'quickenrich_contacts_ambiguous');
    assertEquals(result.identity?.domain, null);
    assertEquals(requests.length, 2);
    assertEquals(paid.settlements, [[5, 0]]);
    assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['ambiguous', 0]]);
    assertEquals(db.mutations.length, 0);
  });
});

Deno.test('truncated contact fallback cannot resolve a company from its first employee', async () => {
  const db = new StubSupabase([techWolfPlaceholder()]);
  const paid = paidDeps(db);
  await mockFetchCompanyFinder((url) => url.endsWith('/company-finder') ? emptyCompanyResult()
    : Response.json({ success: true, data: [techWolfContact], meta: { total: 200, has_more: true, credits_used: 0 } }), async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'TechWolf' });
    assertEquals(result.via, 'quickenrich_contacts_ambiguous');
    assertEquals(result.identity?.domain, null);
    assertEquals(requests.length, 2);
    assertEquals(db.finishes()[0].p_outcome, 'ambiguous');
    assertEquals(db.mutations.length, 0);
  });
});

Deno.test('contact fallback 429 is an operational error and cannot become a cached miss', async () => {
  const db = new StubSupabase([identity({ resolution_attempts: 2 })]);
  const paid = paidDeps(db);
  await mockFetchCompanyFinder((url) => url.endsWith('/company-finder') ? emptyCompanyResult()
    : Response.json({ success: false, message: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } }), async (requests) => {
    const error = await assertRejects(() => resolveCompany(paid.deps, { company_name: 'Acme' }), QuickenrichCompanyFinderError);
    assertEquals(error.code, 'RATE_LIMITED');
    assertEquals(error.httpStatus, 429);
    assertEquals(requests.length, 2);
    assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['unavailable', 0]]);
    assertEquals(paid.settlements, [[5, 0]]);
    assertEquals(db.lookupAttempts, 0);
    assertEquals(db.tables.company_identities[0].resolution_attempts, 2);
  });
});

Deno.test('discovery capacity failure after known empty company result releases the lookup lease', async () => {
  const db = new StubSupabase([identity()]);
  const paid = paidDeps(db);
  paid.deps.reserveQuickenrichDiscovery = async () => {
    throw new QuickenrichCompanyFinderError('RATE_LIMITED', 429, 'Contact Finder capacity exhausted', 30);
  };
  await mockFetchCompanyFinder((url) => {
    assertEquals(url.endsWith('/company-finder'), true, 'Capacity failure must happen before contact request');
    return emptyCompanyResult();
  }, async (requests) => {
    const error = await assertRejects(() => resolveCompany(paid.deps, { company_name: 'Acme' }), QuickenrichCompanyFinderError);
    assertEquals(error.code, 'RATE_LIMITED');
    assertEquals(error.retryAfterSeconds, 30);
    assertEquals(requests.length, 1);
    assertEquals(paid.settlements, [[5, 0]]);
    assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['unavailable', 0]]);
    assertEquals(db.lookupAttempts, 0);
  });
});

Deno.test('empty company response with billed credits cannot lose spend in free fallback', async () => {
  const db = new StubSupabase([identity()]);
  const paid = paidDeps(db);
  await mockFetchCompanyFinder((url) => {
    assertEquals(url.endsWith('/company-finder'), true, 'Only a known zero-credit miss is eligible for free fallback');
    return Response.json({ success: true, data: [], meta: { credits_used: 2, total: 0 } });
  }, async (requests) => {
    const result = await resolveCompany(paid.deps, { company_name: 'Acme' });
    assertEquals(result.via, 'quickenrich_not_found');
    assertEquals(result.billed, true);
    assertEquals(result.creditsUsed, 2);
    assertEquals(requests.length, 1);
    assertEquals(paid.discoveryReservations(), 0);
    assertEquals(paid.settlements, [[5, 2]]);
    assertEquals(db.finishes().map((args) => [args.p_outcome, args.p_credits]), [['not_found', 2]]);
  });
});
