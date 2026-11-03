import { handleTenantOrderRecoverBilling } from './index.ts';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const keep = {
  id: 'order-keep', organization_id: 'buyer-org', company_name: 'LeadWave', contact_email: 'buyer@example.com',
  created_at: '2026-09-30T12:00:00Z', status: 'active', stripe_subscription_id: 'sub_keep', stripe_customer_id: 'cus_keep',
  pax8_order_id: 'provider-order', pax8_subscription_id: 'provider-sub', pax8_tenant_id: null,
};
const duplicate = (suffix: string, created: string) => ({
  ...keep, id: `order-${suffix}`, status: 'failed', created_at: created,
  stripe_subscription_id: `sub_${suffix}`, stripe_customer_id: `cus_${suffix}`,
  pax8_order_id: null, pax8_subscription_id: null,
});
type Order = Omit<typeof keep, 'pax8_order_id' | 'pax8_subscription_id' | 'pax8_tenant_id'> & {
  pax8_order_id: string | null;
  pax8_subscription_id: string | null;
  pax8_tenant_id: string | null;
};
type Config = {
  editRows?: (rows: Order[]) => void;
  editStripe?: (sub: Record<string, unknown>, order: Order) => void;
  providerStatus?: string;
  refundStatus?: string;
  failRefundOnce?: boolean;
};
function setup(config: Config = {}) {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://database.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    STRIPE_SECRET_KEY: 'test-stripe-key', STRIPE_M365_BB_PRICE_ID: 'price_tenant',
    PAX8_CLIENT_ID: 'test-client', PAX8_CLIENT_SECRET: 'test-secret',
  })) { previous.set(name, Deno.env.get(name)); Deno.env.set(name, value); }
  const rows: Order[] = [{ ...keep }, duplicate('first', '2026-09-30T10:00:00Z'), duplicate('second', '2026-09-30T11:00:00Z')];
  config.editRows?.(rows);
  const subscriptions = new Map(rows.map(order => {
    const sub: Record<string, unknown> = {
      id: order.stripe_subscription_id, customer: order.stripe_customer_id, status: 'active', cancel_at_period_end: false,
      metadata: { tenant_order_id: order.id, organization_id: order.organization_id },
      items: { data: [{ price: { id: 'price_tenant', product: { id: 'prod_tenant' } }, quantity: 1 }] },
      latest_invoice: {
        id: `in_${order.id}`, status: 'paid', paid: true, amount_paid: 970, amount_due: 970, currency: 'usd',
        charge: { id: `ch_${order.id}`, paid: true, status: 'succeeded', amount: 970, currency: 'usd', amount_refunded: 0, refunded: false },
      },
    };
    config.editStripe?.(sub, order);
    return [order.stripe_subscription_id, sub];
  }));
  const refunds = new Map<string, Record<string, unknown>[]>();
  const idempotent = new Map<string, Record<string, unknown>>();
  const calls: Array<{ url: URL; method: string; params: URLSearchParams; headers: Headers }> = [];
  let failRefundOnce = config.failRefundOnce ?? false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const params = new URLSearchParams(typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body : undefined);
    const headers = new Headers(init?.headers);
    calls.push({ url, method, params, headers });
    if (url.hostname === 'database.test') {
      if (method === 'PATCH') {
        const id = url.searchParams.get('id')?.replace('eq.', '');
        const row = rows.find(row => row.id === id);
        assert(row && row.id !== keep.id, 'Attempted to mutate kept order');
        row.status = 'cancelled';
        return reply({ id });
      }
      return reply(rows);
    }
    if (url.hostname === 'api.pax8.com') {
      if (url.pathname === '/v1/token') return reply({ access_token: 'test-provider-token', expires_in: 3600 });
      assert(url.pathname === '/v1/subscriptions/provider-sub' && method === 'GET', 'Unexpected provider write');
      return reply({ id: 'provider-sub', status: config.providerStatus ?? 'Active' });
    }
    assert(url.hostname === 'api.stripe.com', 'Unexpected financial host');
    if (url.pathname.startsWith('/v1/subscriptions/')) {
      const id = url.pathname.split('/').at(-1)!;
      const subscription = subscriptions.get(id);
      assert(subscription, 'Unknown Stripe subscription');
      if (method === 'DELETE') {
        assert(id !== 'sub_keep', 'Retained subscription cancelled');
        subscription.status = 'canceled';
      } else assert(method === 'GET', 'Unexpected subscription mutation');
      return reply(subscription);
    }
    if (url.pathname.startsWith('/v1/invoices/')) {
      assert(method === 'GET', 'Invoice mutated');
      const id = url.pathname.split('/').at(-1)!;
      const order = rows.find(order => `in_${order.id}` === id)!;
      return reply({ id, billing_reason: 'subscription_create', subscription: order.stripe_subscription_id, customer: order.stripe_customer_id });
    }
    if (url.pathname === '/v1/refunds' && method === 'GET') {
      return reply({ data: refunds.get(url.searchParams.get('charge')!) ?? [], has_more: false });
    }
    if (url.pathname === '/v1/refunds' && method === 'POST') {
      if (failRefundOnce) { failRefundOnce = false; return reply({ error: { message: 'private-provider-body test-stripe-key' } }, 503); }
      const key = headers.get('Idempotency-Key')!;
      if (idempotent.has(key)) return reply(idempotent.get(key));
      const chargeId = params.get('charge')!;
      assert(chargeId !== 'ch_order-keep', 'Retained charge refunded');
      const result = { id: `re_${chargeId}`, charge: chargeId, amount: Number(params.get('amount')), currency: 'usd', status: config.refundStatus ?? 'succeeded' };
      idempotent.set(key, result);
      refunds.set(chargeId, [result]);
      if (result.status === 'succeeded') {
        const sub = [...subscriptions.values()].find(value => (value.latest_invoice as { charge: { id: string } }).charge.id === chargeId)!;
        const charge = (sub.latest_invoice as { charge: Record<string, unknown> }).charge;
        charge.amount_refunded = result.amount; charge.refunded = result.amount === 970;
      }
      return reply(result);
    }
    throw new Error(`Unexpected mock request: ${method} ${url.pathname}`);
  };
  return { calls, rows, subscriptions, refunds, restore() {
    globalThis.fetch = originalFetch;
    for (const [name, value] of previous) { if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value); }
  } };
}
function request(dryRun = false, extras: Record<string, unknown> = {}, authorized = true) {
  return new Request('https://function.test', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test-service-key' } : {}) },
    body: JSON.stringify({ keepTenantOrderId: keep.id, duplicateTenantOrderIds: ['order-first', 'order-second'], expectedRefundTotal: 1940, dryRun, ...extras }),
  });
}
const financialWrites = (mock: ReturnType<typeof setup>) => mock.calls.filter(call => call.url.hostname === 'api.stripe.com' && call.method !== 'GET');

Deno.test('dry run verifies all three paid purchases and the active provider without any financial or DB writes', async () => {
  const mock = setup();
  try {
    const res = await handleTenantOrderRecoverBilling(request(true));
    const data = await res.json();
    assert(res.status === 200 && data.success && data.originalRefundTotal === 1940 && data.remainingRefundTotal === 1940, 'Dry run did not validate authorized total');
    assert(financialWrites(mock).length === 0 && !mock.calls.some(call => call.method === 'PATCH'), 'Dry run performed writes');
    assert(mock.calls.some(call => call.url.pathname === '/v1/subscriptions/provider-sub'), 'Kept provider not verified');
  } finally { mock.restore(); }
});

Deno.test('cancels only the duplicates without invoice or proration and refunds exactly $19.40 with stable keys', async () => {
  const mock = setup();
  try {
    const res = await handleTenantOrderRecoverBilling(request());
    const data = await res.json();
    assert(res.status === 200 && data.success && data.duplicates.length === 2, 'Recovery failed');
    const writes = financialWrites(mock);
    assert(writes.length === 4, 'Expected two cancellations and two refunds');
    const refunds = writes.filter(call => call.method === 'POST');
    assert(refunds.reduce((sum, call) => sum + Number(call.params.get('amount')), 0) === 1940, 'Refund total differs from approval');
    for (const cancellation of writes.filter(call => call.method === 'DELETE')) {
      assert(cancellation.params.get('invoice_now') === 'false' && cancellation.params.get('prorate') === 'false', 'Unexpected cancellation billing');
    }
    for (const refund of refunds) {
      assert(refund.params.get('reason') === 'duplicate', 'Wrong refund reason');
      const orderId = refund.params.get('metadata[tenant_order_id]');
      assert(refund.headers.get('Idempotency-Key') === `tenant-duplicate-refund:${orderId}:in_${orderId}`, 'Unstable refund idempotency key');
    }
    const firstWrite = mock.calls.findIndex(call => call.url.hostname === 'api.stripe.com' && call.method !== 'GET');
    assert(mock.calls.slice(0, firstWrite).filter(call => call.url.pathname.startsWith('/v1/invoices/')).length === 2, 'Wrote before all targets were validated');
    assert(mock.rows.find(row => row.id === keep.id)?.status === 'active' && mock.subscriptions.get('sub_keep')?.status === 'active', 'Kept tenant changed');
  } finally { mock.restore(); }
});

Deno.test('successful retry skips fully refunded charges and cancelled subscriptions', async () => {
  const mock = setup();
  try {
    assert((await handleTenantOrderRecoverBilling(request())).status === 200, 'First attempt failed');
    const writesBefore = financialWrites(mock).length;
    const res = await handleTenantOrderRecoverBilling(request());
    const data = await res.json();
    assert(res.status === 200 && data.remainingRefundTotal === 0 && data.duplicates.every((item: { alreadyCompleted: boolean }) => item.alreadyCompleted), 'Retry did not reconcile completed refunds');
    assert(financialWrites(mock).length === writesBefore, 'Retry repeated financial writes');
  } finally { mock.restore(); }
});

Deno.test('a failure after cancellation safely retries the refund without repeating cancellation or exposing Stripe errors', async () => {
  const mock = setup({ failRefundOnce: true });
  try {
    const first = await handleTenantOrderRecoverBilling(request());
    const firstBody = await first.json();
    assert(first.status === 502 && !JSON.stringify(firstBody).includes('test-stripe-key') && !JSON.stringify(firstBody).includes('private-provider-body'), 'Private Stripe failure leaked');
    const retry = await handleTenantOrderRecoverBilling(request());
    assert(retry.status === 200, 'Recovery retry failed');
    assert(mock.calls.filter(call => call.url.pathname === '/v1/subscriptions/sub_first' && call.method === 'DELETE').length === 1, 'Retry repeated cancellation');
    const attempts = mock.calls.filter(call => call.url.pathname === '/v1/refunds' && call.method === 'POST' && call.params.get('charge') === 'ch_order-first');
    assert(attempts.length === 2 && attempts[0].headers.get('Idempotency-Key') === attempts[1].headers.get('Idempotency-Key'), 'Retry changed idempotency key');
  } finally { mock.restore(); }
});

Deno.test('rejects foreign, newer, provider-backed, or unauthenticated targets before financial writes', async () => {
  const cases: Config[] = [
    { editRows: rows => { rows[2].organization_id = 'another-org'; } },
    { editRows: rows => { rows[2].contact_email = 'another@example.com'; } },
    { editRows: rows => { rows[2].created_at = '2026-09-30T13:00:00Z'; } },
    { editRows: rows => { rows[2].pax8_order_id = 'existing-provider-order'; } },
    { editRows: rows => { rows[2].pax8_subscription_id = 'existing-provider-sub'; } },
    { providerStatus: 'PendingAutomated' },
  ];
  for (const config of cases) {
    const mock = setup(config);
    try {
      assert((await handleTenantOrderRecoverBilling(request())).status === 409, 'Unsafe target accepted');
      assert(financialWrites(mock).length === 0, 'Unsafe target reached financial writes');
    } finally { mock.restore(); }
  }
  const mock = setup();
  try {
    assert((await handleTenantOrderRecoverBilling(request(false, {}, false))).status === 401 && mock.calls.length === 0, 'Missing service auth accepted');
  } finally { mock.restore(); }
});

Deno.test('unpaid, partially refunded, refunded kept, or wrong Stripe metadata purchases never cancel any targets', async () => {
  for (const mode of ['unpaid', 'partial', 'keep-refunded', 'metadata']) {
    const mock = setup({ editStripe: (sub, row) => {
      if (mode === 'metadata' && row.id === 'order-second') sub.metadata = { tenant_order_id: 'foreign-order', organization_id: 'buyer-org' };
      const invoice = sub.latest_invoice as { paid: boolean; charge: { amount_refunded: number; refunded: boolean } };
      if (mode === 'unpaid' && row.id === 'order-second') invoice.paid = false;
      if (mode === 'partial' && row.id === 'order-second') invoice.charge.amount_refunded = 100;
      if (mode === 'keep-refunded' && row.id === keep.id) { invoice.charge.amount_refunded = 970; invoice.charge.refunded = true; }
    } });
    try {
      assert((await handleTenantOrderRecoverBilling(request())).status === 409, 'Unsafe billing state accepted');
      assert(financialWrites(mock).length === 0, 'Invalid second target allowed first target writes');
    } finally { mock.restore(); }
  }
});

Deno.test('pending refunds are reported without a second refund or proceeding to the next target', async () => {
  const mock = setup({ refundStatus: 'pending' });
  try {
    const response = await handleTenantOrderRecoverBilling(request());
    const data = await response.json();
    assert(response.status === 202 && data.pending && data.duplicates[0].refundStatus === 'pending', 'Pending result reported complete');
    const writesBefore = financialWrites(mock).length;
    const retry = await handleTenantOrderRecoverBilling(request());
    assert(retry.status === 409 && financialWrites(mock).length === writesBefore, 'Pending refund was repeated');
    assert(!mock.calls.some(call => call.url.pathname === '/v1/subscriptions/sub_second' && call.method === 'DELETE'), 'Recovery continued after pending refund');
  } finally { mock.restore(); }
});

Deno.test('the exact original total and unique explicit targets are required before writes', async () => {
  const mock = setup();
  try {
    assert((await handleTenantOrderRecoverBilling(request(false, { expectedRefundTotal: 970 }))).status === 409, 'Wrong authorized amount accepted');
    assert((await handleTenantOrderRecoverBilling(request(false, { duplicateTenantOrderIds: ['order-first', 'order-first'] }))).status === 400, 'Duplicate IDs accepted');
    assert((await handleTenantOrderRecoverBilling(request(false, { duplicateTenantOrderIds: [keep.id] }))).status === 400, 'Kept order accepted as duplicate');
    assert((await handleTenantOrderRecoverBilling(request(false, { dryRun: undefined }))).status === 400, 'Omitted dryRun accepted');
    assert(financialWrites(mock).length === 0, 'Invalid explicit plan caused financial writes');
  } finally { mock.restore(); }
});
