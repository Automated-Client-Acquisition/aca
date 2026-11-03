/** GET-only Stripe reconciliation. Never return API keys or complete Stripe objects. */
type StripeRecord = Record<string, unknown>;

export interface BillingMetadata {
  tenant_order_id?: string;
  organization_id?: string;
  plan_tier?: string;
  source?: string;
}

export interface BillingSubscriptionSummary {
  id: string;
  status: string | null;
  customerId: string | null;
  created: number | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: number | null;
  currentPeriodEnd: number | null;
  metadata: BillingMetadata;
  kind: 'tenant' | 'app' | 'unknown';
  items: Array<{
    priceId: string | null;
    productId: string | null;
    productName: string | null;
    quantity: number | null;
    unitAmount: number | null;
    currency: string | null;
    priceMetadata: BillingMetadata;
    productMetadata: BillingMetadata;
  }>;
  latestInvoice: {
    id: string;
    created: number | null;
    status: string | null;
    paid: boolean | null;
    amountPaid: number | null;
    amountDue: number | null;
    currency: string | null;
    charge: {
      id: string;
      status: string | null;
      paid: boolean | null;
      amount: number | null;
      amountRefunded: number | null;
      refunded: boolean | null;
      currency: string | null;
      refunds: Array<{ id: string; status: string | null; amount: number | null; currency: string | null }>;
    } | null;
  } | null;
}

export interface TenantBillingAudit {
  customers: Array<{ id: string; email: string | null; deleted: boolean }>;
  subscriptions: BillingSubscriptionSummary[];
}

interface BillingAuditRuntime {
  fetch?: typeof fetch;
  readEnv?: (name: string) => string | undefined;
}

function record(value: unknown): StripeRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as StripeRecord : {};
}
function string(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function boolean(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function objectId(value: unknown): string | null { return string(value) ?? string(record(value).id); }
function metadata(value: unknown): BillingMetadata {
  const source = record(value);
  const result: BillingMetadata = {};
  for (const key of ['tenant_order_id', 'organization_id', 'plan_tier', 'source'] as const) {
    if (typeof source[key] === 'string') result[key] = source[key];
  }
  return result;
}
function rows(value: unknown): StripeRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

/** Audit supplied subscriptions and customer/email-linked subscriptions; amounts are in cents. */
export async function auditTenantOrderBilling(input: {
  subscriptionIds?: readonly string[];
  customerIds?: readonly string[];
  customerEmail?: string;
  organizationId?: string;
}, runtime: BillingAuditRuntime = {}): Promise<TenantBillingAudit> {
  const readEnv = runtime.readEnv ?? ((name: string) => Deno.env.get(name));
  const apiKey = readEnv('STRIPE_SECRET_KEY');
  if (!apiKey) throw new Error('Stripe billing audit is unavailable: STRIPE_SECRET_KEY is not configured');
  const fetchStripe = runtime.fetch ?? fetch;
  const tenantPriceId = readEnv('STRIPE_M365_BB_PRICE_ID');
  const subscriptionIds = new Set(input.subscriptionIds ?? []);
  const customerIds = new Set(input.customerIds ?? []);
  if (subscriptionIds.size > 20 || customerIds.size > 20) throw new Error('Billing audit accepts at most 20 subscription and customer IDs');
  for (const id of subscriptionIds) if (!/^sub_[a-zA-Z0-9]+$/.test(id)) throw new Error('Invalid subscription ID for billing audit');
  for (const id of customerIds) if (!/^cus_[a-zA-Z0-9]+$/.test(id)) throw new Error('Invalid customer ID for billing audit');
  if (input.customerEmail && input.customerEmail.length > 512) throw new Error('Invalid email for billing audit');
  if (input.organizationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.organizationId)) {
    throw new Error('Invalid organization ID for billing audit');
  }

  async function get(path: string, query: URLSearchParams = new URLSearchParams()): Promise<StripeRecord> {
    const response = await fetchStripe(`https://api.stripe.com/v1${path}?${query}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Stripe-Version': '2024-06-20' },
    });
    // Stripe errors can echo submitted data. Keep response bodies and keys private.
    if (!response.ok) throw new Error(`Stripe billing read failed (${response.status}) for ${path}`);
    const result = record(await response.json());
    if (!Object.keys(result).length) throw new Error(`Invalid Stripe billing response for ${path}`);
    return result;
  }

  async function list(path: string, filters: Record<string, string>): Promise<StripeRecord[]> {
    const results: StripeRecord[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ ...filters, limit: '100' });
      if (cursor) query.set('starting_after', cursor);
      const response = await get(path, query);
      if (!Array.isArray(response.data)) throw new Error(`Invalid Stripe billing list for ${path}`);
      const batch = rows(response.data);
      results.push(...batch);
      if (response.has_more === false) return results;
      const nextCursor = objectId(batch.at(-1));
      if (response.has_more !== true || !nextCursor || nextCursor === cursor) {
        throw new Error(`Incomplete Stripe billing pagination for ${path}`);
      }
      cursor = nextCursor;
    }
    throw new Error(`Stripe billing audit exceeded the pagination limit for ${path}`);
  }

  async function organizationSubscriptions(): Promise<StripeRecord[]> {
    if (!input.organizationId) return [];
    const results: StripeRecord[] = [];
    const seenPages = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ query: `metadata['organization_id']:'${input.organizationId}'`, limit: '100' });
      if (cursor) query.set('page', cursor);
      const response = await get('/subscriptions/search', query);
      if (!Array.isArray(response.data)) throw new Error('Invalid Stripe billing organization search');
      results.push(...rows(response.data));
      if (response.has_more === false) return results;
      const nextPage = string(response.next_page);
      if (response.has_more !== true || !nextPage || seenPages.has(nextPage)) {
        throw new Error('Incomplete Stripe billing organization search pagination');
      }
      seenPages.add(nextPage);
      cursor = nextPage;
    }
    throw new Error('Stripe billing organization search exceeded the pagination limit');
  }

  const customers = new Map<string, { id: string; email: string | null; deleted: boolean }>();
  function addCustomer(customer: StripeRecord) {
    const id = objectId(customer);
    if (!id) throw new Error('Stripe billing customer has no ID');
    customers.set(id, { id, email: string(customer.email), deleted: customer.deleted === true });
  }
  const [suppliedCustomers, emailCustomers, organizationMatches] = await Promise.all([
    Promise.all([...customerIds].map(id => get(`/customers/${id}`))),
    input.customerEmail ? list('/customers', { email: input.customerEmail.trim() }) : Promise.resolve([]),
    organizationSubscriptions(),
  ]);
  for (const customer of [...suppliedCustomers, ...emailCustomers]) addCustomer(customer);

  // Include cancelled subscriptions; they still carry payment/refund history.
  const customerSubscriptions = await Promise.all([...customers.values()]
    .filter(customer => !customer.deleted)
    .map(customer => list('/subscriptions', { customer: customer.id, status: 'all' })));
  for (const subscription of customerSubscriptions.flat()) {
    const id = objectId(subscription);
    if (!id) throw new Error('Stripe billing subscription has no ID');
    subscriptionIds.add(id);
  }
  const organizationMatchIds = new Set<string>();
  for (const subscription of organizationMatches) {
    const id = objectId(subscription);
    if (!id) throw new Error('Stripe billing organization search subscription has no ID');
    organizationMatchIds.add(id);
    subscriptionIds.add(id);
  }
  if (subscriptionIds.size > 100) throw new Error('Billing audit exceeds 100 subscriptions; narrow the customer scope');

  async function subscriptionSummary(id: string): Promise<BillingSubscriptionSummary> {
    const expansions = new URLSearchParams();
    expansions.append('expand[]', 'items.data.price.product');
    expansions.append('expand[]', 'latest_invoice.payment_intent.latest_charge');
    const subscription = await get(`/subscriptions/${id}`, expansions);
    if (objectId(subscription) !== id) throw new Error('Stripe billing returned a mismatched subscription');
    const subscriptionMetadata = metadata(subscription.metadata);
    if (organizationMatchIds.has(id) && subscriptionMetadata.organization_id !== input.organizationId) {
      throw new Error('Stripe billing organization search returned mismatched ownership');
    }
    const items = rows(record(subscription.items).data).map(item => {
      const price = record(item.price);
      const product = record(price.product);
      return {
        priceId: objectId(item.price), productId: objectId(price.product),
        productName: string(product.name), quantity: number(item.quantity),
        unitAmount: number(price.unit_amount), currency: string(price.currency),
        priceMetadata: metadata(price.metadata), productMetadata: metadata(product.metadata),
      };
    });
    const tenant = !!subscriptionMetadata.tenant_order_id || items.some(item =>
      (!!tenantPriceId && item.priceId === tenantPriceId) || item.priceMetadata.tenant_order_id || item.productMetadata.tenant_order_id);
    const app = !!subscriptionMetadata.plan_tier || subscriptionMetadata.source === 'onboarding' || items.some(item =>
      item.priceMetadata.plan_tier || item.productMetadata.plan_tier);
    let invoice = record(subscription.latest_invoice);
    if (typeof subscription.latest_invoice === 'string') {
      invoice = await get(`/invoices/${subscription.latest_invoice}`, new URLSearchParams({ 'expand[]': 'payment_intent.latest_charge' }));
    }
    const invoiceId = objectId(invoice);
    let charge = record(invoice.charge);
    let paymentIntent = record(invoice.payment_intent);
    if (typeof invoice.payment_intent === 'string') {
      paymentIntent = await get(`/payment_intents/${invoice.payment_intent}`, new URLSearchParams({ 'expand[]': 'latest_charge' }));
    }
    if (!objectId(charge)) charge = record(paymentIntent.latest_charge);
    const chargeId = objectId(invoice.charge) ?? objectId(paymentIntent.latest_charge);
    if (chargeId && !objectId(charge)) charge = await get(`/charges/${chargeId}`);
    const refunds = chargeId ? await list('/refunds', { charge: chargeId }) : [];
    return {
      id, status: string(subscription.status), customerId: objectId(subscription.customer),
      created: number(subscription.created), cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      trialEnd: number(subscription.trial_end), currentPeriodEnd: number(subscription.current_period_end),
      metadata: subscriptionMetadata, kind: tenant ? 'tenant' : app ? 'app' : 'unknown', items,
      latestInvoice: invoiceId ? {
        id: invoiceId, created: number(invoice.created), status: string(invoice.status),
        paid: boolean(invoice.paid), amountPaid: number(invoice.amount_paid), amountDue: number(invoice.amount_due), currency: string(invoice.currency),
        charge: chargeId ? {
          id: chargeId, status: string(charge.status), paid: boolean(charge.paid),
          amount: number(charge.amount), amountRefunded: number(charge.amount_refunded),
          refunded: boolean(charge.refunded), currency: string(charge.currency),
          refunds: refunds.map(refund => ({ id: objectId(refund) ?? '', status: string(refund.status), amount: number(refund.amount), currency: string(refund.currency) })),
        } : null,
      } : null,
    };
  }
  const subscriptions = await Promise.all([...subscriptionIds].map(subscriptionSummary));
  return { customers: [...customers.values()], subscriptions: subscriptions.sort((a, b) => (b.created ?? 0) - (a.created ?? 0)) };
}
