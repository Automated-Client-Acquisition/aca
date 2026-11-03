/**
 * P1 core unit tests — pure, no network or DB.
 * Run: deno test --allow-all supabase/functions/_shared/list-building/__tests__/p1-core.test.ts
 */

import {
  assertEquals,
  assert,
  assertExists,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { parseContactName } from '../name-parser.ts';
import { generatePermutations } from '../permutation-generator.ts';
import { PatternCache } from '../pattern-cache.ts';

// ============================================================================
// parseContactName
// ============================================================================

Deno.test('parseContactName: John Smith -> basic first/last', () => {
  const p = parseContactName('John Smith');
  assertEquals(p.first, 'john');
  assertEquals(p.last, 'smith');
  assertEquals(p.flags.hyphen, false);
  assertEquals(p.flags.accent, false);
  assertEquals(p.flags.single_name, false);
  assertEquals(p.flags.has_middle, false);
});

Deno.test('parseContactName: François Müller -> accent flag + normalization', () => {
  const p = parseContactName('François Müller');
  assertEquals(p.first, 'francois');
  assertEquals(p.last, 'muller');
  assertEquals(p.flags.accent, true);
});

Deno.test('parseContactName: "Smith-Jones, Marie" -> comma form + hyphen flag', () => {
  const p = parseContactName('Smith-Jones, Marie');
  assertEquals(p.first, 'marie');
  assertEquals(p.last, 'smith-jones');
  assertEquals(p.flags.hyphen, true);
});

Deno.test('parseContactName: Madonna -> single_name flag', () => {
  const p = parseContactName('Madonna');
  assertEquals(p.first, 'madonna');
  assertEquals(p.last, null);
  assertEquals(p.flags.single_name, true);
});

Deno.test('parseContactName: William Gates -> nickname variants', () => {
  const p = parseContactName('William Gates');
  assertEquals(p.first, 'william');
  assertEquals(p.last, 'gates');
  assert(p.flags.nickname_variants.includes('bill'));
  assert(p.flags.nickname_variants.includes('will'));
});

Deno.test('parseContactName: Dr. Jean-Claude Van Damme -> honorific + hyphen + middle', () => {
  const p = parseContactName('Dr. Jean-Claude Van Damme');
  assertEquals(p.first, 'jean-claude');
  assertEquals(p.last, 'damme');
  assertEquals(p.flags.hyphen, true);
  assertEquals(p.flags.has_middle, true);
});

// ============================================================================
// generatePermutations
// ============================================================================

Deno.test('generatePermutations: tier 1 always emitted', () => {
  const parsed = parseContactName('John Smith');
  const perms = generatePermutations(parsed, 'example.com');
  const t1 = perms.filter((p) => p.tier === 1);
  assert(t1.length >= 5);
  assert(perms.some((p) => p.pattern === 'firstname.lastname' && p.email === 'john.smith@example.com'));
});

Deno.test('generatePermutations: tier 5 only when hyphen/accent', () => {
  const plain = parseContactName('John Smith');
  const hyphen = parseContactName('Jean-Claude Van-Damme');
  const plainPerms = generatePermutations(plain, 'example.com');
  const hyphenPerms = generatePermutations(hyphen, 'example.com');
  assertEquals(plainPerms.filter((p) => p.tier === 5).length, 0);
  assert(hyphenPerms.filter((p) => p.tier === 5).length > 0);
});

Deno.test('generatePermutations: tier 4 roles only when companySize<10 or explicit', () => {
  const parsed = parseContactName('John Smith');
  const big = generatePermutations(parsed, 'example.com', { companySize: 500 });
  const small = generatePermutations(parsed, 'example.com', { companySize: 5 });
  assertEquals(big.filter((p) => p.tier === 4).length, 0);
  assert(small.filter((p) => p.tier === 4).length >= 6);

  const forced = generatePermutations(parsed, 'example.com', { includeRoles: true });
  assert(forced.filter((p) => p.tier === 4).length >= 6);
});

Deno.test('generatePermutations: forcePattern short-circuits to single result', () => {
  const parsed = parseContactName('John Smith');
  const perms = generatePermutations(parsed, 'example.com', {
    forcePattern: 'firstname.lastname',
  });
  assertEquals(perms.length, 1);
  assertEquals(perms[0].email, 'john.smith@example.com');
});

Deno.test('generatePermutations: nickname emits firstname.lastname_nickname variants', () => {
  const parsed = parseContactName('William Gates');
  const perms = generatePermutations(parsed, 'microsoft.com');
  const nicks = perms.filter((p) => p.pattern.endsWith('_nickname'));
  assert(nicks.some((p) => p.email.startsWith('bill.gates@')));
  assert(nicks.some((p) => p.email === 'bill@microsoft.com'));
});

// ============================================================================
// PatternCache — fake supabase
// ============================================================================

interface Upsert {
  table: string;
  row: Record<string, unknown>;
}

function makeFakeSupabase(existingRow: Record<string, unknown> | null = null) {
  const upserts: Upsert[] = [];
  let currentRow = existingRow;

  const api = {
    upserts,
    get currentRow() {
      return currentRow;
    },
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return this;
            },
            maybeSingle() {
              return Promise.resolve({ data: currentRow, error: null });
            },
          };
        },
        upsert(row: Record<string, unknown>) {
          upserts.push({ table, row });
          currentRow = row;
          return Promise.resolve({ data: row, error: null });
        },
      };
    },
  };
  return api;
}

Deno.test('PatternCache: confidence 70 after 1 sample', async () => {
  const fake = makeFakeSupabase();
  // deno-lint-ignore no-explicit-any
  const cache = new PatternCache(fake as any, 'org-1');
  const rec = await cache.recordHit('acme.com', 'firstname.lastname', 1, false, true);
  assertEquals(rec.confidence, 70);
  assertEquals(rec.sample_size, 1);
  assertEquals(fake.upserts.length, 1);
});

Deno.test('PatternCache: confidence 85 after 2 samples', async () => {
  const fake = makeFakeSupabase({
    domain: 'acme.com',
    pattern: 'firstname.lastname',
    tier: 1,
    confidence: 70,
    sample_size: 1,
    catch_all: false,
    mx_valid: true,
    negative_result: false,
    last_verified_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  // deno-lint-ignore no-explicit-any
  const cache = new PatternCache(fake as any, 'org-1');
  const rec = await cache.recordHit('acme.com', 'firstname.lastname', 1, false, true);
  assertEquals(rec.confidence, 85);
  assertEquals(rec.sample_size, 2);
});

Deno.test('PatternCache: confidence 97 after 3+ samples', async () => {
  const fake = makeFakeSupabase({
    domain: 'acme.com',
    pattern: 'firstname.lastname',
    tier: 1,
    confidence: 85,
    sample_size: 2,
    catch_all: false,
    mx_valid: true,
    negative_result: false,
    last_verified_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  // deno-lint-ignore no-explicit-any
  const cache = new PatternCache(fake as any, 'org-1');
  const rec = await cache.recordHit('acme.com', 'firstname.lastname', 1, false, true);
  assertEquals(rec.confidence, 97);
  assertEquals(rec.sample_size, 3);
});

Deno.test('PatternCache: shouldSkipDomain for mx invalid / negative / catch_all', () => {
  // deno-lint-ignore no-explicit-any
  const cache = new PatternCache({} as any, 'org-1');
  const base = {
    domain: 'x.com',
    pattern: null,
    tier: null,
    confidence: 0,
    sample_size: 0,
    catch_all: false,
    mx_valid: true,
    negative_result: false,
    last_verified_at: null,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  assertEquals(cache.shouldSkipDomain({ ...base, mx_valid: false }), true);
  assertEquals(cache.shouldSkipDomain({ ...base, negative_result: true }), true);
  assertEquals(cache.shouldSkipDomain({ ...base, catch_all: true }), true);
  assertEquals(cache.shouldSkipDomain(base), false);
  assertEquals(cache.shouldSkipDomain(null), false);
});

// Used only to silence lint if assertExists unused above
void assertExists;
