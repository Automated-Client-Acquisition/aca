import { handleTenantOrderProvision } from './index.ts';
import { findPax8CompanyByExternalId, tenantOrderCompanyName } from '../_shared/pax8-client.ts';

function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
}
const order = {
  id: 'order-1', status: 'failed', stripe_subscription_id: 'sub-1',
  company_name: 'LeadWave', business_domain: 'leadwave.work',
  contact_first_name: 'Mitchell', contact_last_name: 'White', contact_email: 'buyer@example.com',
  address_line1: '142 Kingston Street', city: 'Brighton', postal_code: 'BN2 3AB', country_code: 'GB',
  phone_country_code: '+44', phone_number: '2038018752', pax8_company_id: null,
};
const company = { id: 'company-1', name: 'LeadWave', phone: '2038018752', website: 'leadwave.com', externalId: order.id, address: { postalCode: 'BN2' } };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
function setup(row: Record<string, unknown> = order, providerFailure = false, options: { emptyCompanies?: boolean; orderFailure?: boolean; saveFailure?: boolean; subscriptionStatus?: string; subscriptionReadFailure?: boolean } = {}) {
  const original = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries({
    SUPABASE_URL: 'https://database.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    PAX8_CLIENT_ID: 'test-client', PAX8_CLIENT_SECRET: 'test-secret',
    PAX8_MPN_ID: 'test-mpn', PAX8_PARTNER_TENANT_ID: 'test-partner',
    PAX8_M365_BB_COMMITMENT_TERM_ID: 'test-term', PAX8_M365_BB_NO_TEAMS_PRODUCT_ID: 'test-product',
  })) {
    previous.set(key, Deno.env.get(key)); Deno.env.set(key, value);
  }
  const priorResend = Deno.env.get('RESEND_API_KEY');
  Deno.env.delete('RESEND_API_KEY');
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: url.pathname + url.search, method, body });
    if (url.hostname === 'database.test') {
      if (method === 'PATCH') return options.saveFailure ? reply({ message: 'storage unavailable' }, 500) : reply(null);
      return reply(row);
    }
    if (url.pathname === '/v1/token') return reply({ access_token: 'test-provider-token', expires_in: 3600 });
    if (providerFailure) return reply({ error: 'provider unavailable' }, 503);
    if (url.pathname === '/v1/companies' && method === 'GET') return reply({ content: options.emptyCompanies ? [] : [company], page: { totalPages: 1 } });
    if (url.pathname === '/v1/companies' && method === 'POST') return reply(company);
    if (url.pathname === '/v1/companies/company-1') return reply(company);
    if (url.pathname === '/v1/subscriptions/provider-sub-1') return options.subscriptionReadFailure
      ? reply({ error: 'temporarily unavailable' }, 503) : reply({ id: 'provider-sub-1', status: options.subscriptionStatus ?? 'PendingAutomated' });
    if (url.pathname === '/v1/orders/provider-order-1') return reply({ id: 'provider-order-1', lineItems: [{ subscriptionId: 'provider-sub-1', provisioningDetails: [{ key: 'mca2020Email', values: [order.contact_email] }] }] });
    if (url.pathname === '/v1/subscriptions') return reply({ content: [] });
    if (url.pathname === '/v1/orders' && options.orderFailure) return reply({ error: 'Microsoft rejected address' }, 400);
    if (url.pathname === '/v1/orders') return reply({ id: 'provider-order-1', lineItems: [{ subscriptionId: 'provider-sub-1', provisioningDetails: [{ key: 'mca2020Email', values: [order.contact_email] }] }] });
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  return { calls, restore() {
    globalThis.fetch = original;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
    if (priorResend === undefined) Deno.env.delete('RESEND_API_KEY'); else Deno.env.set('RESEND_API_KEY', priorResend);
  } };
}
function request(dryRun = false, authenticated = true) {
  return new Request('https://function.test', { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-service-key' } : {}),
  }, body: JSON.stringify({ tenantOrderId: order.id, dryRun }) });
}
Deno.test('dry run reports invalid saved address without writes or paid provider calls', async () => {
  const mock = setup({ ...order, postal_code: 'BN2' });
  try {
    const res = await handleTenantOrderProvision(request(true));
    const data = await res.json();
    assert(res.status === 200 && data.addressValid === false, 'Expected incomplete postcode report');
    assert(mock.calls.every(c => c.method === 'GET' || c.path === '/v1/token'), 'Dry run mutated data');
  } finally { mock.restore(); }
});
Deno.test('failed dry-run reads preserve the paid order status', async () => {
  const mock = setup(order, true);
  try {
    assert((await handleTenantOrderProvision(request(true))).status === 500, 'Expected provider failure');
    assert(!mock.calls.some(c => c.method === 'PATCH'), 'Dry run changed order status');
  } finally { mock.restore(); }
});
Deno.test('incomplete postcode blocks company creation and ordering', async () => {
  const mock = setup({ ...order, postal_code: 'BN2' });
  try {
    assert((await handleTenantOrderProvision(request())).status === 500, 'Expected address failure');
    assert(!mock.calls.some(c => c.path === '/v1/orders' || (c.path === '/v1/companies' && c.method === 'POST')), 'Invalid address reached billable provider call');
  } finally { mock.restore(); }
});
Deno.test('retry reuses saved company, saves identity, corrects provider address, then orders once', async () => {
  const mock = setup({ ...order, pax8_company_id: 'company-1' });
  try {
    assert((await handleTenantOrderProvision(request())).status === 200, 'Expected successful retry');
    assert(!mock.calls.some(c => c.path.startsWith('/v1/companies?') || (c.path === '/v1/companies' && c.method === 'POST')), 'Retry scanned or duplicated company');
    const saved = mock.calls.findIndex(c => c.method === 'PATCH' && c.path.startsWith('/rest/v1/tenant_orders') && c.body?.pax8_company_id);
    const corrected = mock.calls.findIndex(c => c.path === '/v1/companies/company-1' && c.method === 'PATCH');
    const placed = mock.calls.findIndex(c => c.path === '/v1/orders');
    assert(mock.calls[corrected]?.body?.name === company.name && mock.calls[corrected]?.body?.phone === company.phone, 'Address PATCH omitted required company identity');
    assert(saved >= 0 && corrected > saved && placed > corrected, 'Provider work happened before identity/address persisted');
    assert(mock.calls.filter(c => c.path === '/v1/orders').length === 1, 'Duplicate provider order');
    assert(mock.calls.find(c => c.body?.pax8_order_id)?.body?.failure_reason === null, 'Recovered order retained stale failure');
  } finally { mock.restore(); }
});
Deno.test('unauthenticated calls and unpaid/cancelled orders cannot provision', async () => {
  for (const row of [order, { ...order, stripe_subscription_id: null }, { ...order, status: 'cancelled' }]) {
    const mock = setup(row);
    try {
      const res = await handleTenantOrderProvision(request(false, row !== order));
      assert(res.status === (row === order ? 401 : 409), 'Expected authentication/payment guard');
      assert(!mock.calls.some(c => c.path.startsWith('/v1/')), 'Rejected request reached provider');
    } finally { mock.restore(); }
  }
});
Deno.test('different orders with the same business name have different provider names', () => {
  assert(tenantOrderCompanyName('LeadWave', 'one') !== tenantOrderCompanyName('LeadWave', 'two'), 'Provider company names collided');
});
Deno.test('external-id search follows top-level pagination to avoid duplicate companies', async () => {
  const mock = setup();
  const initial = globalThis.fetch;
  const pages: string[] = [];
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/companies') {
      pages.push(url.search);
      return Promise.resolve(reply(url.searchParams.get('page') === '0'
        ? { content: [{ id: 'unrelated' }], totalPages: 2 }
        : { content: [company], totalPages: 2 }));
    }
    return initial(input, init);
  };
  try {
    assert((await findPax8CompanyByExternalId(order.id))?.id === company.id, 'Missed existing company on page 2');
    assert(pages.length === 2, 'Did not follow provider pagination');
  } finally { mock.restore(); }
});

Deno.test('new company uses a unique order name and retains its ID when Microsoft rejects the order', async () => {
  const mock = setup(order, false, { emptyCompanies: true, orderFailure: true });
  try {
    assert((await handleTenantOrderProvision(request())).status === 500, 'Expected Microsoft failure');
    const created = mock.calls.find(c => c.path === '/v1/companies' && c.method === 'POST');
    assert(created?.body?.name === tenantOrderCompanyName(order.company_name, order.id), 'Company name was not unique');
    const saved = mock.calls.findIndex(c => c.method === 'PATCH' && c.body?.pax8_company_id === company.id);
    const placed = mock.calls.findIndex(c => c.path === '/v1/orders');
    assert(saved >= 0 && saved < placed, 'Lost provider identity after failed order');
    assert(mock.calls.at(-1)?.body?.status === 'failed', 'Failed paid order was not retained');
  } finally { mock.restore(); }
});
Deno.test('database failure saving company identity prevents a billable provider order', async () => {
  const mock = setup(order, false, { saveFailure: true });
  try {
    assert((await handleTenantOrderProvision(request())).status === 500, 'Expected persistence failure');
    assert(!mock.calls.some(c => c.path === '/v1/orders'), 'Placed order despite lost provider identity');
  } finally { mock.restore(); }
});

Deno.test('accepted pending orders do not claim completion or buyer contact as admin credentials', async () => {
  const mock = setup();
  try {
    const data = await (await handleTenantOrderProvision(request())).json();
    assert(data.status === 'provisioning', 'Acceptance was reported as completion');
    const saved = mock.calls.find(c => c.body?.pax8_order_id);
    assert(saved?.body?.m365_admin_email === null, 'Buyer contact was used as tenant admin');
    assert(!saved?.body?.m365_admin_temp_password_sent_at, 'Claimed unconfirmed credentials delivery');
  } finally { mock.restore(); }
});
Deno.test('provider Active subscription is required before reporting completion', async () => {
  const mock = setup(order, false, { subscriptionStatus: 'Active' });
  try {
    const data = await (await handleTenantOrderProvision(request())).json();
    assert(data.status === 'active', 'Did not recognize completed provisioning');
    const saved = mock.calls.findIndex(c => c.body?.pax8_order_id);
    const checked = mock.calls.findIndex(c => c.path === '/v1/subscriptions/provider-sub-1');
    assert(checked > saved, 'Read subscription before durable acceptance');
  } finally { mock.restore(); }
});
Deno.test('failed status read retains acceptance and prevents reordering on retry', async () => {
  const mock = setup({ ...order, pax8_order_id: 'provider-order-1' }, false, { subscriptionReadFailure: true });
  try {
    assert((await handleTenantOrderProvision(request())).status === 500, 'Expected read failure');
    assert(!mock.calls.some(c => c.path === '/v1/orders' && c.method === 'POST'), 'Ordered again');
    const failure = mock.calls.find(c => c.body?.status === 'failed');
    assert(failure?.path.includes('pax8_order_id=is.null'), 'Failure update could overwrite accepted order');
  } finally { mock.restore(); }
});
Deno.test('dry-run reconciliation of accepted order reads subscription without any mutations', async () => {
  const mock = setup({ ...order, pax8_order_id: 'provider-order-1' }, false, { subscriptionStatus: 'Active' });
  try {
    const data = await (await handleTenantOrderProvision(request(true))).json();
    assert(data.status === 'active' && data.wouldPlaceOrder === false, 'Did not reconcile provider completion');
    assert(mock.calls.every(c => c.method === 'GET' || c.path === '/v1/token'), 'Dry run mutated accepted order');
  } finally { mock.restore(); }
});

Deno.test('provider validation-only checks corrected company without placing a billable order', async () => {
  const mock = setup({ ...order, pax8_company_id: 'company-1' });
  try {
    const req = request();
    const preflight = new Request(req.url, { method: 'POST', headers: req.headers,
      body: JSON.stringify({ tenantOrderId: order.id, validateOnly: true }) });
    const data = await (await handleTenantOrderProvision(preflight)).json();
    assert(data.validatedOnly === true, 'Did not report validation-only');
    assert(mock.calls.some(c => c.path === '/v1/orders?isMock=true'), 'Skipped provider preflight');
    assert(!mock.calls.some(c => c.path === '/v1/orders' || c.body?.pax8_order_id), 'Preflight placed or recorded a billable order');
  } finally { mock.restore(); }
});

Deno.test('accepted orders needing details or cancelled by provider expose recovery instead of polling forever', async () => {
  for (const subscriptionStatus of ['WaitingForDetails', 'Cancelled', 'PendingCancel']) {
    const mock = setup({ ...order, pax8_order_id: 'provider-order-1' }, false, { subscriptionStatus });
    try {
      const data = await (await handleTenantOrderProvision(request())).json();
      assert(data.status === 'failed' && data.failure_reason.includes(subscriptionStatus), 'Provider terminal state was hidden');
      assert(!mock.calls.some(c => c.path === '/v1/orders' && c.method === 'POST'), 'Recovery created a duplicate order');
    } finally { mock.restore(); }
  }
});
