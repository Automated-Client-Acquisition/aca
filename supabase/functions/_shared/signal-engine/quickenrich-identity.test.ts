import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  QuickenrichAdapter,
  QuickenrichCompanyFinderError,
  type QuickenrichCompanyFinderErrorCode,
} from '../enrichment/quickenrich.ts';
import { selectQuickenrichContactIdentity, selectQuickenrichIdentity } from './quickenrich-identity.ts';

const acme = {
  company_name: 'Acme, Inc.',
  company_url: 'https://www.acme.example/about',
  industry: 'Software',
  number_of_employees: '42',
  country_code: 'US',
};

Deno.test('QuickEnrich exact legal-name match normalizes the website and preserves actual credits', () => {
  assertEquals(selectQuickenrichIdentity({
    success: true,
    data: [acme],
    meta: { credits_used: 1, total: 1, has_more: false },
  }, 'Acme Corporation', 'US'), {
    candidate: { name: 'Acme, Inc.', domain: 'acme.example', industry: 'Software', employee_count: 42, country: 'US' },
    creditsUsed: 1,
    reason: 'matched',
  });
  assertEquals(selectQuickenrichIdentity({ success: true, data: acme }, 'Acme').creditsUsed, 1);
});

Deno.test('QuickEnrich documented Company Finder fields use url and employee_count', () => {
  // Field shape from the current Company Finder example in /docs; search
  // filters use company_url while returned records use url.
  const row = {
    company_name: 'Acme Cloud Solutions',
    url: 'acme.com',
    email_domain: 'acme.com',
    final_email_domain: 'acme.com',
    linkedin_url: 'https://linkedin.com/company/acme',
    city: 'Austin',
    country_code: 'US',
    industry: 'Computer Software',
    employee_count: '51-200',
  };
  const result = selectQuickenrichIdentity({
    success: true, code: 200, data: [row],
    meta: { page: 1, total: 1, last_page: 1, credits_used: 1, next_cursor: null, has_more: false },
  }, 'Acme Cloud Solutions Inc.', 'US');
  assertEquals(result.candidate, { name: 'Acme Cloud Solutions', domain: 'acme.com', industry: 'Computer Software', country: 'US' });
  assertEquals(result.creditsUsed, 1);
  assertEquals(result.reason, 'matched');
  assertEquals(selectQuickenrichIdentity({ success: true, data: [{ ...row, company_url: 'legacy.example', employee_count: 42, number_of_employees: '99' }] }, 'Acme Cloud Solutions').candidate?.employee_count, 42);
  assertEquals(selectQuickenrichIdentity({ success: true, data: [{ ...row, company_url: 'legacy.example' }] }, 'Acme Cloud Solutions').candidate?.domain, 'acme.com');
});

Deno.test('QuickEnrich email fields cannot substitute for the returned website', () => {
  const error = assertThrows(() => selectQuickenrichIdentity({ success: true, data: [{
    company_name: 'Acme', email_domain: 'acme.example', final_email_domain: 'info@acme.example',
  }] }, 'Acme'), QuickenrichCompanyFinderError);
  assertEquals(error.code, 'INVALID_RESPONSE');
  assertEquals(selectQuickenrichIdentity({ success: true, data: [{
    company_name: 'Acme', url: 'info@acme.example', email_domain: 'acme.example',
  }] }, 'Acme').reason, 'not_found');
});

Deno.test('QuickEnrich rejects fuzzy names and ISO country mismatches', () => {
  assertEquals(selectQuickenrichIdentity({ success: true, data: [
    { ...acme, company_name: 'Acme Australia' },
    { ...acme, company_url: 'acme.example.au', country_code: 'AU' },
  ] }, 'Acme', 'US'), { candidate: null, creditsUsed: 2, reason: 'not_found' });
  // Non-ISO hints are handled by the caller; do not compare them to an ISO code.
  assertEquals(selectQuickenrichIdentity({ success: true, data: acme }, 'Acme', 'United States').reason, 'matched');
});

Deno.test('QuickEnrich distinct matching domains are ambiguous but duplicate canonical domains agree', () => {
  assertEquals(selectQuickenrichIdentity({ success: true, data: [acme, { ...acme, company_url: 'other-acme.example' }] }, 'Acme').reason, 'ambiguous');
  const duplicate = selectQuickenrichIdentity({ success: true, data: [acme, { ...acme, company_url: 'acme.example' }] }, 'Acme');
  assertEquals(duplicate.reason, 'matched');
  assertEquals(duplicate.creditsUsed, 2);
});

Deno.test('QuickEnrich incomplete paid pages are cached ambiguity even when a match is present', () => {
  for (const meta of [
    { has_more: true },
    { total: 2 },
    { next_cursor: 'another-page' },
  ]) {
    assertEquals(selectQuickenrichIdentity({ success: true, data: [acme], meta }, 'Acme'), {
      candidate: null, creditsUsed: 1, reason: 'ambiguous',
    });
  }
});

Deno.test('QuickEnrich website validation rejects non-web schemes, credentials, IPs and invalid hosts', () => {
  for (const website of ['ftp://acme.example', 'https://user:secret@acme.example', 'https://127.0.0.1', '-bad.example', 'invalid host']) {
    assertEquals(selectQuickenrichIdentity({ success: true, data: { ...acme, company_url: website } }, 'Acme').reason, 'not_found');
  }
});

Deno.test('QuickEnrich employee ranges are not invented exact headcounts', () => {
  assertEquals(selectQuickenrichIdentity({ success: true, data: { ...acme, number_of_employees: '51-200' } }, 'Acme').candidate?.employee_count, undefined);
});

Deno.test('QuickEnrich genuine empty results spend zero fallback credits', () => {
  assertEquals(selectQuickenrichIdentity({ success: true, data: [] }, 'Acme'), {
    candidate: null, creditsUsed: 0, reason: 'not_found',
  });
});

function contactDiscovery(hasMore = false) {
  return {
    success: true,
    data: Array.from({ length: 88 }, (_, index) => ({
      first_name: `Member${index}`, last_name: 'Fixture', title: 'Engineer',
      employee_linkedin: `https://linkedin.com/in/fixture-${index}`,
      company_name: 'TechWolf', company_url: index % 2 ? 'techwolf.com' : 'https://www.techwolf.com',
      country_code: 'BE', has_email: true, has_phone: false,
    })),
    meta: { page: 1, per_page: 100, total: hasMore ? 120 : 88, last_page: hasMore ? 2 : 1,
      credits_used: 0, next_cursor: hasMore ? 'next-page' : null, has_more: hasMore },
  };
}

Deno.test('Free Contact Finder collapses 88 contacts into one exact company identity', () => {
  assertEquals(selectQuickenrichContactIdentity(contactDiscovery(), 'TechWolf Inc.', 'BE'), {
    candidate: { name: 'TechWolf', domain: 'techwolf.com', country: 'BE' },
    creditsUsed: 0, reason: 'matched',
  });
});

Deno.test('Free Contact Finder truncated pages and distinct same-name company domains remain ambiguous', () => {
  assertEquals(selectQuickenrichContactIdentity(contactDiscovery(true), 'TechWolf', 'BE'), {
    candidate: null, creditsUsed: 0, reason: 'ambiguous',
  });
  const collision = contactDiscovery();
  collision.data[0].company_url = 'other-techwolf.example';
  assertEquals(selectQuickenrichContactIdentity(collision, 'TechWolf', 'BE').reason, 'ambiguous');
});

Deno.test('Free Contact Finder rejects unexpected billing and does not infer credits from contact count', () => {
  for (const response of [
    { success: true, data: [] },
    { ...contactDiscovery(), meta: { credits_used: 1 } },
    { ...contactDiscovery(), meta: { credits_used: '0' } },
  ]) {
    const error = assertThrows(() => selectQuickenrichContactIdentity(response, 'TechWolf'), QuickenrichCompanyFinderError);
    assertEquals(error.code, 'INVALID_RESPONSE');
  }
  assertEquals(selectQuickenrichContactIdentity({ success: true, data: [], meta: { credits_used: 0 } }, 'TechWolf'), {
    candidate: null, creditsUsed: 0, reason: 'not_found',
  });
});

Deno.test('QuickEnrich malformed results and credit metadata cannot become negative cache misses', () => {
  for (const response of [
    null, {}, { success: false, data: [] }, { success: true },
    { success: true, data: null }, { success: true, data: ['acme.example'] },
    { success: true, data: [{}] }, { success: true, data: [{}], meta: { has_more: true } },
    { success: true, data: [], meta: null },
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1', null].map((credits_used) => ({ success: true, data: [acme], meta: { credits_used } })),
    { success: true, data: [], meta: { total: -1 } },
    { success: true, data: [], meta: { has_more: 'false' } },
  ]) {
    const error = assertThrows(() => selectQuickenrichIdentity(response, 'Acme'), QuickenrichCompanyFinderError);
    assertEquals(error.code, 'INVALID_RESPONSE');
  }
});

async function withFetch(mock: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

const filters = { company_name: { include: ['Acme'], exclude: [] }, include_full_text: true, per_page: 5 };
const contactFilters = { company_name: { include: ['TechWolf'], exclude: [] }, per_page: 100, page: 1 };

async function expectFinderError(
  mock: typeof fetch,
  code: QuickenrichCompanyFinderErrorCode,
  status: number | null,
  timeoutMs = 12_000,
  finder: 'company' | 'contact' = 'company',
): Promise<QuickenrichCompanyFinderError> {
  let error: QuickenrichCompanyFinderError;
  await withFetch(mock, async () => {
    error = await assertRejects(() => finder === 'contact'
      ? QuickenrichAdapter.contactFinder('fixture-key', contactFilters, { timeoutMs })
      : QuickenrichAdapter.companyFinder('fixture-key', filters, { timeoutMs }), QuickenrichCompanyFinderError);
    assertEquals(error.code, code);
    assertEquals(error.httpStatus, status);
  });
  return error!;
}

Deno.test('Company Finder preserves request contract and credit metadata', async () => {
  await withFetch((async (url, options) => {
    assertEquals(url, 'https://app.quickenrich.io/api/companies/company-finder');
    assertEquals(options?.method, 'POST');
    assertEquals(new Headers(options?.headers).get('authorization'), 'Bearer fixture-key');
    assertEquals(JSON.parse(String(options?.body)), filters);
    return Response.json({ success: true, data: [acme], meta: { credits_used: 1 } });
  }) as typeof fetch, async () => {
    const response = await QuickenrichAdapter.companyFinder('fixture-key', filters);
    assertEquals(response.meta?.credits_used, 1);
  });
});

Deno.test('Company Finder classifies HTTP and application failures instead of empty matches', async () => {
  for (const [status, code] of [
    [401, 'AUTHENTICATION_FAILED'], [403, 'AUTHENTICATION_FAILED'],
    [402, 'INSUFFICIENT_CREDITS'], [429, 'RATE_LIMITED'], [503, 'PROVIDER_ERROR'],
  ] as const) {
    const error = await expectFinderError((async () => Response.json({ success: false, message: 'Provider unavailable' }, { status, headers: { 'Retry-After': '60' } })) as typeof fetch, code, status);
    assertEquals(error.retryAfterSeconds, 60);
  }
  await expectFinderError((async () => Response.json({ success: false, error: { code: 'insufficient_credits', message: 'No remaining credits' } })) as typeof fetch, 'INSUFFICIENT_CREDITS', 200);
  await expectFinderError((async () => Response.json({ success: false, error: 'Insufficient credits' })) as typeof fetch, 'INSUFFICIENT_CREDITS', 200);
  await expectFinderError((async () => Response.json({ success: false, error: { code: 'AUTHENTICATION_FAILED' } })) as typeof fetch, 'AUTHENTICATION_FAILED', 200);
  await expectFinderError((async () => Response.json({ success: false, code: 429 })) as typeof fetch, 'RATE_LIMITED', 200);
});

Deno.test('Company Finder rejects malformed successful HTTP bodies', async () => {
  for (const body of ['not JSON', 'null', '{}', '{"success":true}', '{"success":true,"data":["host"]}']) {
    await expectFinderError((async () => new Response(body)) as typeof fetch, 'INVALID_RESPONSE', 200);
  }
  await expectFinderError((async () => new Response('Gateway unavailable', { status: 502 })) as typeof fetch, 'PROVIDER_ERROR', 502);
});

Deno.test('Company Finder reports network failure distinctly from a company miss', async () => {
  await expectFinderError((async () => { throw new TypeError('Network connection refused'); }) as typeof fetch, 'NETWORK_ERROR', null);
});

Deno.test('Company Finder timeout aborts header waits', async () => {
  await expectFinderError(((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })) as typeof fetch, 'TIMEOUT', null, 5);
});

Deno.test('Company Finder timeout stays armed while reading the response body', async () => {
  await expectFinderError((async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      options?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    },
  }))) as typeof fetch, 'TIMEOUT', 200, 5);
});

Deno.test('Contact Finder preserves its free discovery request and real contact-shaped response', async () => {
  await withFetch((async (url, options) => {
    assertEquals(url, 'https://app.quickenrich.io/api/employees/contact-finder');
    assertEquals(options?.method, 'POST');
    assertEquals(new Headers(options?.headers).get('authorization'), 'Bearer fixture-key');
    assertEquals(JSON.parse(String(options?.body)), contactFilters);
    return Response.json(contactDiscovery());
  }) as typeof fetch, async () => {
    const result = await QuickenrichAdapter.contactFinder('fixture-key', contactFilters);
    assertEquals(selectQuickenrichContactIdentity(result, 'TechWolf', 'BE').candidate?.domain, 'techwolf.com');
    assertEquals(result.meta?.credits_used, 0);
  });
});

Deno.test('Contact Finder HTTP, application and malformed responses cannot become free misses', async () => {
  for (const [status, code] of [[401, 'AUTHENTICATION_FAILED'], [402, 'INSUFFICIENT_CREDITS'], [429, 'RATE_LIMITED'], [503, 'PROVIDER_ERROR']] as const) {
    await expectFinderError((async () => Response.json({ success: false }, { status })) as typeof fetch, code, status, 12_000, 'contact');
  }
  await expectFinderError((async () => Response.json({ success: false, code: 429 })) as typeof fetch, 'RATE_LIMITED', 200, 12_000, 'contact');
  await expectFinderError((async () => Response.json({ success: true })) as typeof fetch, 'INVALID_RESPONSE', 200, 12_000, 'contact');
  await expectFinderError((async () => new Response('not JSON')) as typeof fetch, 'INVALID_RESPONSE', 200, 12_000, 'contact');
});

Deno.test('Contact Finder timeout covers both pending headers and a stalled response body', async () => {
  await expectFinderError(((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })) as typeof fetch, 'TIMEOUT', null, 5, 'contact');
  await expectFinderError((async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      options?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    },
  }))) as typeof fetch, 'TIMEOUT', 200, 5, 'contact');
});
