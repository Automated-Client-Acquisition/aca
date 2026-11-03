import { auditTenantOrderBilling } from './tenant-order-billing.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const runtimeEnv = (name: string) => ({ STRIPE_SECRET_KEY: 'test-only-secret', STRIPE_M365_BB_PRICE_ID: 'price_tenant' }[name]);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const list = (data: unknown[], has_more = false) => ({ data, has_more });

function fixtureSubscription(id: string, created: number, metadata: Record<string, string>, refunded = 0) {
  return {
    id, customer: 'cus_buyer', created, status: refunded ? 'canceled' : 'active',
    current_period_end: 1800000000, trial_end: null, cancel_at_period_end: false,
    metadata: { ...metadata, private: 'must-not-return' },
    items: { data: [{
      quantity: 1,
      price: {
        id: metadata.tenant_order_id ? 'price_tenant' : 'price_app', unit_amount: 970, currency: 'usd',
        metadata: { private: 'must-not-return' },
        product: { id: 'prod_test', name: 'Product name', metadata: { plan_tier: metadata.plan_tier, private: 'must-not-return' } },
      },
    }] },
    latest_invoice: {
      id: `in_${id}`, status: 'paid', paid: true, created, amount_paid: 970, amount_due: 970, currency: 'usd',
      payment_intent: { latest_charge: {
        id: `ch_${id}`, status: 'succeeded', paid: true, amount: 970,
        amount_refunded: refunded, refunded: refunded === 970, currency: 'usd',
        payment_method_details: { private: 'must-not-return' },
      } },
    },
  };
}

Deno.test('GET-only audit discovers cancelled and app subscriptions, deduplicates, and limits returned data', async () => {
  const calls: URL[] = [];
  const subscriptions = [
    fixtureSubscription('sub_old', 1, { tenant_order_id: 'old-order', organization_id: 'buyer-org' }, 970),
    fixtureSubscription('sub_new', 3, { tenant_order_id: 'new-order', organization_id: 'buyer-org' }),
    fixtureSubscription('sub_app', 2, { plan_tier: 'pro', organization_id: 'buyer-org', source: 'onboarding' }),
  ];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    equal(url.origin, 'https://api.stripe.com');
    equal(init?.method, 'GET');
    equal(new Headers(init?.headers).get('Stripe-Version'), '2024-06-20');
    equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-only-secret');
    if (url.pathname === '/v1/customers/cus_buyer') return json({ id: 'cus_buyer', email: 'buyer@example.com', private: 'must-not-return' });
    if (url.pathname === '/v1/customers') {
      equal(url.searchParams.get('email'), 'buyer@example.com');
      return json(list([{ id: 'cus_buyer', email: 'buyer@example.com' }]));
    }
    if (url.pathname === '/v1/subscriptions') {
      equal(url.searchParams.get('status'), 'all');
      equal(url.searchParams.get('customer'), 'cus_buyer');
      return json(list(subscriptions.map(({ id }) => ({ id }))));
    }
    if (url.pathname.startsWith('/v1/subscriptions/')) {
      equal(url.searchParams.getAll('expand[]'), ['items.data.price.product', 'latest_invoice.payment_intent.latest_charge']);
      return json(subscriptions.find(subscription => `/v1/subscriptions/${subscription.id}` === url.pathname));
    }
    if (url.pathname === '/v1/refunds') {
      return json(list(url.searchParams.get('charge') === 'ch_sub_old'
        ? [{ id: 're_old', status: 'succeeded', amount: 970, currency: 'usd', private: 'must-not-return' }]
        : []));
    }
    throw new Error(`Unexpected mock request: ${url.pathname}`);
  };
  const result = await auditTenantOrderBilling({ subscriptionIds: ['sub_new'], customerIds: ['cus_buyer'], customerEmail: 'buyer@example.com' }, { fetch: mockFetch, readEnv: runtimeEnv });
  equal(result.customers, [{ id: 'cus_buyer', email: 'buyer@example.com', deleted: false }]);
  equal(result.subscriptions.map(({ id, kind, status }) => ({ id, kind, status })), [
    { id: 'sub_new', kind: 'tenant', status: 'active' },
    { id: 'sub_app', kind: 'app', status: 'active' },
    { id: 'sub_old', kind: 'tenant', status: 'canceled' },
  ]);
  equal(result.subscriptions[1].currentPeriodEnd, 1800000000);
  equal(result.subscriptions[2].latestInvoice?.amountPaid, 970);
  equal(result.subscriptions[2].latestInvoice?.charge?.amountRefunded, 970);
  equal(result.subscriptions[2].latestInvoice?.charge?.refunds, [{ id: 're_old', status: 'succeeded', amount: 970, currency: 'usd' }]);
  equal(calls.filter(url => url.pathname === '/v1/subscriptions/sub_new').length, 1);
  for (const sensitive of ['must-not-return', 'test-only-secret', 'payment_method_details']) {
    if (JSON.stringify(result).includes(sensitive)) throw new Error('Billing audit returned private Stripe data');
  }
});

Deno.test('audit follows customer, subscription, and refund pagination without dropping older purchases', async () => {
  const pages: string[] = [];
  const subscription = fixtureSubscription('sub_paid', 1, { tenant_order_id: 'order' }, 100);
  const mockFetch: typeof fetch = async input => {
    const url = new URL(String(input));
    const cursor = url.searchParams.get('starting_after');
    pages.push(`${url.pathname}:${cursor ?? 'first'}`);
    if (url.pathname === '/v1/customers') return json(cursor
      ? list([{ id: 'cus_second', email: 'buyer@example.com' }])
      : list([{ id: 'cus_first', email: 'buyer@example.com' }], true));
    if (url.pathname === '/v1/subscriptions') {
      if (url.searchParams.get('customer') === 'cus_second') return json(list([]));
      return json(cursor ? list([{ id: 'sub_other' }]) : list([{ id: 'sub_paid' }], true));
    }
    if (url.pathname === '/v1/subscriptions/sub_paid') return json(subscription);
    if (url.pathname === '/v1/subscriptions/sub_other') return json({ id: 'sub_other', status: 'canceled', customer: 'cus_first', items: { data: [] } });
    if (url.pathname === '/v1/refunds') return json(cursor
      ? list([{ id: 're_second', status: 'pending', amount: 50, currency: 'usd' }])
      : list([{ id: 're_first', status: 'succeeded', amount: 100, currency: 'usd' }], true));
    throw new Error('Unexpected request');
  };
  const result = await auditTenantOrderBilling({ customerEmail: 'buyer@example.com' }, { fetch: mockFetch, readEnv: runtimeEnv });
  equal(result.customers.length, 2);
  equal(result.subscriptions.length, 2);
  equal(result.subscriptions[0].latestInvoice?.charge?.refunds.map(refund => refund.status), ['succeeded', 'pending']);
  for (const expected of ['/v1/customers:cus_first', '/v1/subscriptions:sub_paid', '/v1/refunds:re_first']) {
    if (!pages.includes(expected)) throw new Error(`Missing pagination request ${expected}`);
  }
});

Deno.test('unexpanded invoice and charge references are retrieved before judging payment and refund state', async () => {
  const mockFetch: typeof fetch = async input => {
    const url = new URL(String(input));
    switch (url.pathname) {
      case '/v1/subscriptions/sub_paid': return json({ id: 'sub_paid', status: 'active', latest_invoice: 'in_paid', items: { data: [{ price: { id: 'price_tenant', product: 'prod_tenant' } }] } });
      case '/v1/invoices/in_paid': return json({ id: 'in_paid', paid: true, amount_paid: 970, currency: 'usd', charge: 'ch_paid' });
      case '/v1/charges/ch_paid': return json({ id: 'ch_paid', amount: 970, amount_refunded: 0, refunded: false, paid: true, currency: 'usd' });
      case '/v1/refunds': return json(list([]));
      default: throw new Error('Unexpected request');
    }
  };
  const result = await auditTenantOrderBilling({ subscriptionIds: ['sub_paid'] }, { fetch: mockFetch, readEnv: runtimeEnv });
  equal(result.subscriptions[0].kind, 'tenant');
  equal(result.subscriptions[0].latestInvoice?.paid, true);
  equal(result.subscriptions[0].latestInvoice?.charge?.amountRefunded, 0);
});

Deno.test('Stripe HTTP failures do not leak returned bodies or secrets and never produce partial success', async () => {
  let message = '';
  try {
    await auditTenantOrderBilling({ subscriptionIds: ['sub_paid'] }, {
      readEnv: runtimeEnv,
      fetch: async () => json({ error: { message: 'must-not-return test-only-secret' } }, 403),
    });
  } catch (error) { message = (error as Error).message; }
  equal(message, 'Stripe billing read failed (403) for /subscriptions/sub_paid');
});

Deno.test('missing service configuration and invalid IDs fail without sending requests', async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async () => { calls++; return json({}); };
  for (const [input, readEnv] of [
    [{ subscriptionIds: ['sub_paid'] }, () => undefined],
    [{ subscriptionIds: ['../secrets'] }, runtimeEnv],
    [{ customerIds: ['invalid'] }, runtimeEnv],
  ] as const) {
    let rejected = false;
    try { await auditTenantOrderBilling(input, { fetch: mockFetch, readEnv }); } catch { rejected = true; }
    equal(rejected, true);
  }
  equal(calls, 0);
});

Deno.test('incomplete pagination fails closed instead of presenting a truncated billing audit', async () => {
  let message = '';
  try {
    await auditTenantOrderBilling({ customerEmail: 'buyer@example.com' }, {
      readEnv: runtimeEnv, fetch: async () => json(list([], true)),
    });
  } catch (error) { message = (error as Error).message; }
  equal(message, 'Incomplete Stripe billing pagination for /customers');
});

Deno.test('organization metadata search finds app billing under a different customer and follows next_page tokens', async () => {
  const organizationId = '2b6e6c3e-ba56-4794-9279-ec52e734f915';
  const calls: URL[] = [];
  const mockFetch: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname === '/v1/customers') return json(list([]));
    if (url.pathname === '/v1/subscriptions/search') {
      equal(url.searchParams.get('query'), `metadata['organization_id']:'${organizationId}'`);
      equal(url.searchParams.has('starting_after'), false);
      return json(url.searchParams.get('page') === 'search-next'
        ? { data: [{ id: 'sub_tenant' }], has_more: false }
        : { data: [{ id: 'sub_app' }], has_more: true, next_page: 'search-next' });
    }
    if (url.pathname === '/v1/subscriptions/sub_app') {
      return json({
        id: 'sub_app', customer: 'cus_unrelated', status: 'active', current_period_end: 1800000000,
        metadata: { organization_id: organizationId, plan_tier: 'pro' },
        items: { data: [{ price: { id: 'price_pro', product: { id: 'prod_app' } } }] },
      });
    }
    if (url.pathname === '/v1/subscriptions/sub_tenant') return json({
      id: 'sub_tenant', customer: 'cus_missing', status: 'active',
      metadata: { organization_id: organizationId, tenant_order_id: 'order' }, items: { data: [] },
    });
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  const result = await auditTenantOrderBilling({ customerEmail: 'buyer@example.com', organizationId }, { fetch: mockFetch, readEnv: runtimeEnv });
  equal(result.customers, []);
  equal(result.subscriptions.find(subscription => subscription.id === 'sub_app')?.kind, 'app');
  equal(result.subscriptions.find(subscription => subscription.id === 'sub_app')?.customerId, 'cus_unrelated');
  equal(result.subscriptions.find(subscription => subscription.id === 'sub_app')?.currentPeriodEnd, 1800000000);
  equal(calls.filter(url => url.pathname === '/v1/subscriptions/search').length, 2);
});

Deno.test('organization search validates UUIDs and current returned ownership before accepting billing data', async () => {
  let calls = 0;
  let message = '';
  try {
    await auditTenantOrderBilling({ organizationId: "' OR status:'active" }, {
      readEnv: runtimeEnv, fetch: async () => { calls++; return json(list([])); },
    });
  } catch (error) { message = (error as Error).message; }
  equal(message, 'Invalid organization ID for billing audit');
  equal(calls, 0);
  try {
    await auditTenantOrderBilling({ organizationId: '2b6e6c3e-ba56-4794-9279-ec52e734f915' }, {
      readEnv: runtimeEnv, fetch: async input => String(input).includes('/subscriptions/search')
        ? json(list([{ id: 'sub_foreign' }]))
        : json({ id: 'sub_foreign', metadata: { organization_id: 'another-org' } }),
    });
  } catch (error) { message = (error as Error).message; }
  equal(message, 'Stripe billing organization search returned mismatched ownership');
});
