/** Validate a full UK postcode, including both the outward and inward codes. */
export function normalizeUkPostcode(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/\s+/g, '');
  const completePostcode = /^(?:GIR0AA|[A-PR-UWYZ](?:\d{1,2}|[A-HK-Y]\d{1,2}|\d[A-HJKPSTUW]|[A-HK-Y]\d[ABEHMNPRVWXY])\d[ABD-HJLNP-UW-Z]{2})$/;
  if (!completePostcode.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export interface FailedPaidTenantOrder {
  id: string;
  business_domain: string;
  contact_email: string;
}

interface TenantOrderLookupQuery extends PromiseLike<{
  data: FailedPaidTenantOrder[] | null;
  error: { message: string } | null;
}> {
  select(columns: string): TenantOrderLookupQuery;
  eq(column: string, value: string): TenantOrderLookupQuery;
  not(column: string, operator: 'is', value: null): TenantOrderLookupQuery;
  limit(count: number): TenantOrderLookupQuery;
}

/**
 * A failed provider attempt is still paid when a Stripe subscription exists.
 * Recover that purchase instead of starting another subscription for it.
 */
export async function findFailedPaidTenantOrder(
  client: { from: (table: string) => unknown },
  organizationId: string,
  businessDomain: string,
  contactEmail: string,
): Promise<FailedPaidTenantOrder | null> {
  const query = client.from('tenant_orders') as TenantOrderLookupQuery;
  const { data, error } = await query
    .select('id, business_domain, contact_email')
    .eq('organization_id', organizationId)
    .eq('status', 'failed')
    .not('stripe_subscription_id', 'is', null);
  if (error) throw new Error(`Failed to check existing paid tenant orders: ${error.message}`);
  return data?.find((order) =>
    order.business_domain === businessDomain || order.contact_email === contactEmail
  ) ?? null;
}

/** Tenant subscriptions are separate purchases from the organization's app plan. */
export function isTenantOrderSubscription(metadata: Record<string, string> | null | undefined): boolean {
  return !!metadata?.tenant_order_id;
}

/** Invoices omit checkout metadata; identify tenant billing from the saved subscription. */
export async function hasTenantOrderForSubscription(
  client: { from: (table: string) => unknown },
  subscriptionId: string,
): Promise<boolean> {
  const query = client.from('tenant_orders') as TenantOrderLookupQuery;
  const { data, error } = await query
    .select('id')
    .eq('stripe_subscription_id', subscriptionId)
    .limit(1);
  // Never interpret a failed lookup as app billing: let Stripe retry the event.
  if (error) throw new Error(`Failed to identify tenant subscription: ${error.message}`);
  return !!data?.length;
}
