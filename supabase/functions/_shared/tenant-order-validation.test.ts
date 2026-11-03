import {
  findFailedPaidTenantOrder,
  hasTenantOrderForSubscription,
  isTenantOrderSubscription,
  normalizeUkPostcode,
} from './tenant-order-validation.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('rejects the incomplete BN2 postcode that failed Microsoft provisioning', () => {
  for (const postcode of ['BN2', 'BN2 1', 'BN2 1A', '', 'BN2 1CI', 'ZZ1 1ZZ']) {
    equal(normalizeUkPostcode(postcode), null);
  }
});

Deno.test('accepts and normalizes full UK postcode formats', () => {
  for (const [input, expected] of [
    [' bn21aa ', 'BN2 1AA'],
    ['BN2  1AA', 'BN2 1AA'],
    ['M1 1AE', 'M1 1AE'],
    ['M60 1NW', 'M60 1NW'],
    ['W1A 1HQ', 'W1A 1HQ'],
    ['CR2 6XH', 'CR2 6XH'],
    ['DN55 1PT', 'DN55 1PT'],
    ['EC1A 1BB', 'EC1A 1BB'],
    ['GIR 0AA', 'GIR 0AA'],
  ]) equal(normalizeUkPostcode(input), expected);
});

interface OrderRow {
  id: string;
  organization_id: string;
  status: string;
  stripe_subscription_id: string | null;
  business_domain: string;
  contact_email: string;
}

function stubClient(orders: OrderRow[], error: { message: string } | null = null) {
  return {
    from(table: string) {
      equal(table, 'tenant_orders');
      let rows = orders;
      const query = {
        select() { return query; },
        eq(column: keyof OrderRow, value: string) {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        not(column: keyof OrderRow, operator: string, value: null) {
          equal(operator, 'is');
          equal(value, null);
          rows = rows.filter((row) => row[column] !== null);
          return query;
        },
        limit(count: number) { rows = rows.slice(0, count); return query; },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({
            data: rows.map(({ id, business_domain, contact_email }) => ({ id, business_domain, contact_email })),
            error,
          }).then(resolve);
        },
      };
      return query;
    },
  };
}

const paidFailedOrder: OrderRow = {
  id: 'paid-failed',
  organization_id: 'buyer-org',
  status: 'failed',
  stripe_subscription_id: 'sub_existing',
  business_domain: 'example.com',
  contact_email: 'buyer@example.com',
};

Deno.test('a paid failed order blocks a repeat purchase for either its domain or contact', async () => {
  const client = stubClient([paidFailedOrder]);
  equal((await findFailedPaidTenantOrder(client, 'buyer-org', 'example.com', 'different@example.com'))?.id, 'paid-failed');
  equal((await findFailedPaidTenantOrder(client, 'buyer-org', 'different.com', 'buyer@example.com'))?.id, 'paid-failed');
});

Deno.test('an unpaid failed order still permits a fresh purchase', async () => {
  const client = stubClient([{ ...paidFailedOrder, stripe_subscription_id: null }]);
  equal(await findFailedPaidTenantOrder(client, 'buyer-org', 'example.com', 'buyer@example.com'), null);
});

Deno.test('other organizations and unrelated paid failed orders do not block checkout', async () => {
  const client = stubClient([paidFailedOrder]);
  equal(await findFailedPaidTenantOrder(client, 'another-org', 'example.com', 'buyer@example.com'), null);
  equal(await findFailedPaidTenantOrder(client, 'buyer-org', 'different.com', 'different@example.com'), null);
});

Deno.test('cancelled purchases do not trigger the paid failed recovery guard', async () => {
  const client = stubClient([{ ...paidFailedOrder, status: 'cancelled' }]);
  equal(await findFailedPaidTenantOrder(client, 'buyer-org', 'example.com', 'buyer@example.com'), null);
});

Deno.test('a database read failure stops checkout rather than allowing another charge', async () => {
  let message: string | undefined;
  try {
    await findFailedPaidTenantOrder(stubClient([], { message: 'database unavailable' }), 'buyer-org', 'example.com', 'buyer@example.com');
  } catch (error) {
    message = (error as Error).message;
  }
  equal(message, 'Failed to check existing paid tenant orders: database unavailable');
});

Deno.test('tenant subscription metadata is excluded from app billing updates', () => {
  equal(isTenantOrderSubscription({ organization_id: 'buyer-org', tenant_order_id: 'paid-failed' }), true);
  equal(isTenantOrderSubscription({ organization_id: 'buyer-org', plan_tier: 'pro' }), false);
  equal(isTenantOrderSubscription(null), false);
});

Deno.test('invoice billing identifies tenant subscriptions even after failure or cancellation', async () => {
  for (const status of ['failed', 'active', 'cancelled']) {
    equal(await hasTenantOrderForSubscription(stubClient([{ ...paidFailedOrder, status }]), 'sub_existing'), true);
  }
  equal(await hasTenantOrderForSubscription(stubClient([paidFailedOrder]), 'sub_app'), false);
});

Deno.test('tenant subscription lookup failures throw so Stripe retries without changing app billing', async () => {
  let message: string | undefined;
  try {
    await hasTenantOrderForSubscription(stubClient([], { message: 'database unavailable' }), 'sub_existing');
  } catch (error) {
    message = (error as Error).message;
  }
  equal(message, 'Failed to identify tenant subscription: database unavailable');
});
