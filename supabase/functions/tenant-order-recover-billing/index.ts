import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { auditTenantOrderBilling, type BillingSubscriptionSummary } from '../_shared/tenant-order-billing.ts';
import { getPax8Subscription } from '../_shared/pax8-client.ts';
import { hostedOnlyResponse } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
class RecoveryError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
interface TenantOrder {
  id: string;
  organization_id: string;
  company_name: string;
  contact_email: string;
  created_at: string;
  status: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  pax8_order_id: string | null;
  pax8_subscription_id: string | null;
  pax8_tenant_id: string | null;
}
interface DuplicateReceipt {
  tenantOrderId: string;
  subscriptionId: string;
  invoiceId: string;
  chargeId: string;
  originalAmount: number;
  alreadyRefunded: number;
  remainingAmount: number;
  subscriptionStatus: string;
  cancelled?: boolean;
  refundId?: string;
  refundStatus?: string;
  alreadyCompleted?: boolean;
}
const normalized = (value: string) => value.trim().toLowerCase();

function validatePaidSubscription(order: TenantOrder, subscription: BillingSubscriptionSummary | undefined) {
  if (!subscription || subscription.kind !== 'tenant'
    || subscription.metadata.tenant_order_id !== order.id
    || subscription.metadata.organization_id !== order.organization_id
    || subscription.metadata.plan_tier
    || subscription.customerId !== order.stripe_customer_id) {
    throw new RecoveryError('Stripe tenant ownership does not match the selected order');
  }
  const invoice = subscription.latestInvoice;
  const charge = invoice?.charge;
  if (!invoice || invoice.status !== 'paid' || invoice.paid !== true || invoice.amountPaid !== 970
    || invoice.amountDue !== 970 || invoice.currency !== 'usd'
    || !charge || charge.paid !== true || charge.status !== 'succeeded'
    || charge.amount !== 970 || charge.currency !== 'usd'
    || !Number.isInteger(charge.amountRefunded) || (charge.amountRefunded !== 0 && charge.amountRefunded !== 970)) {
    throw new RecoveryError('Each selected tenant order must have a confirmed $9.70 USD purchase charge without a partial refund');
  }
  if (charge.refunds.some(refund => refund.status !== 'succeeded' || refund.currency !== 'usd'
    || !Number.isInteger(refund.amount) || (refund.amount ?? 0) <= 0)
    || charge.refunds.reduce((sum, refund) => sum + (refund.amount ?? 0), 0) !== charge.amountRefunded
    || charge.refunded !== (charge.amountRefunded === 970)) {
    throw new RecoveryError('Existing refund state is pending, failed, or inconsistent; review it before retrying');
  }
  return { subscription, invoice, charge };
}

/** Internal, explicitly bounded recovery of paid duplicate tenant purchases. */
export async function handleTenantOrderRecoverBilling(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const hostedOnly = hostedOnlyResponse("Microsoft 365 tenant billing", corsHeaders);
  if (hostedOnly) return hostedOnly;
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  const receipts: DuplicateReceipt[] = [];
  try {
    const body = await req.json();
    const { keepTenantOrderId, duplicateTenantOrderIds, expectedRefundTotal, dryRun } = body ?? {};
    if (typeof keepTenantOrderId !== 'string' || !keepTenantOrderId
      || !Array.isArray(duplicateTenantOrderIds) || duplicateTenantOrderIds.length < 1 || duplicateTenantOrderIds.length > 5
      || duplicateTenantOrderIds.some(id => typeof id !== 'string' || !id || id === keepTenantOrderId)
      || new Set(duplicateTenantOrderIds).size !== duplicateTenantOrderIds.length
      || typeof dryRun !== 'boolean' || !Number.isInteger(expectedRefundTotal) || expectedRefundTotal <= 0) {
      throw new RecoveryError('Provide one retained order, one to five distinct duplicate orders, the expected refund total in cents, and dryRun', 400);
    }
    const apiKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!apiKey) throw new RecoveryError('Stripe billing recovery is not configured', 500);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    const { data, error } = await supabase.from('tenant_orders')
      .select('id,organization_id,company_name,contact_email,created_at,status,stripe_subscription_id,stripe_customer_id,pax8_order_id,pax8_subscription_id,pax8_tenant_id')
      .in('id', [keepTenantOrderId, ...duplicateTenantOrderIds]);
    if (error) throw new RecoveryError('Could not load the selected tenant orders', 500);
    const orders = (data ?? []) as TenantOrder[];
    if (orders.length !== duplicateTenantOrderIds.length + 1) throw new RecoveryError('One or more selected tenant orders were not found', 404);
    const keep = orders.find(order => order.id === keepTenantOrderId)!;
    const duplicates = duplicateTenantOrderIds.map(id => orders.find(order => order.id === id)!);
    if (!keep || keep.status !== 'active' || !keep.pax8_order_id || !keep.pax8_subscription_id
      || !keep.stripe_subscription_id || !keep.stripe_customer_id || !Number.isFinite(Date.parse(keep.created_at))) {
      throw new RecoveryError('The retained tenant must be active with recorded provider and Stripe subscriptions');
    }
    for (const duplicate of duplicates) {
      if (!duplicate || duplicate.organization_id !== keep.organization_id
        || normalized(duplicate.company_name) !== normalized(keep.company_name)
        || normalized(duplicate.contact_email) !== normalized(keep.contact_email)
        || !Number.isFinite(Date.parse(duplicate.created_at)) || Date.parse(duplicate.created_at) >= Date.parse(keep.created_at)
        || !['failed', 'cancelled'].includes(duplicate.status)
        || !duplicate.stripe_subscription_id || !duplicate.stripe_customer_id
        || duplicate.pax8_order_id || duplicate.pax8_subscription_id || duplicate.pax8_tenant_id) {
        throw new RecoveryError('Duplicates must be older failed or cancelled purchases for the same organization, company, and contact, without a provider tenant');
      }
    }
    const stripeIds = [keep.stripe_subscription_id, ...duplicates.map(order => order.stripe_subscription_id!)];
    if (new Set(stripeIds).size !== stripeIds.length) throw new RecoveryError('Selected orders must have distinct Stripe subscriptions');

    // Complete provider verification and every Stripe read before any financial write.
    let provider;
    try { provider = await getPax8Subscription(keep.pax8_subscription_id); }
    catch { throw new RecoveryError('Could not verify the retained provider subscription', 502); }
    if (provider.id !== keep.pax8_subscription_id || provider.status !== 'Active') {
      throw new RecoveryError('The retained provider subscription is not confirmed Active');
    }
    const audit = await auditTenantOrderBilling({ subscriptionIds: stripeIds });
    const kept = validatePaidSubscription(keep, audit.subscriptions.find(subscription => subscription.id === keep.stripe_subscription_id));
    if (kept.subscription.status !== 'active' || kept.subscription.cancelAtPeriodEnd || kept.charge.amountRefunded !== 0) {
      throw new RecoveryError('The retained Stripe subscription must be active, paid, and completely unrefunded');
    }

    async function stripeRequest(path: string, method: 'GET' | 'DELETE' | 'POST', params?: URLSearchParams, idempotencyKey?: string) {
      let response: Response;
      try {
        response = await fetch(`https://api.stripe.com/v1${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`, 'Stripe-Version': '2024-06-20',
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          ...(params ? { body: params } : {}),
        });
      } catch { throw new RecoveryError('Stripe recovery request could not be confirmed; audit before retrying', 502); }
      if (!response.ok) throw new RecoveryError(`Stripe recovery ${method} failed (${response.status}); audit before retrying`, 502);
      try { return await response.json(); }
      catch { throw new RecoveryError('Stripe recovery returned an invalid response; audit before retrying', 502); }
    }

    const plans = await Promise.all(duplicates.map(async duplicate => {
      const { subscription, invoice, charge } = validatePaidSubscription(duplicate, audit.subscriptions.find(item => item.id === duplicate.stripe_subscription_id));
      if (!['active', 'canceled', 'past_due', 'unpaid'].includes(subscription.status ?? '')) {
        throw new RecoveryError('A duplicate Stripe subscription has an unexpected billing state');
      }
      const originalInvoice = await stripeRequest(`/invoices/${invoice.id}`, 'GET');
      if (originalInvoice.id !== invoice.id || originalInvoice.billing_reason !== 'subscription_create'
        || originalInvoice.subscription !== duplicate.stripe_subscription_id
        || originalInvoice.customer !== duplicate.stripe_customer_id) {
        throw new RecoveryError('Only a verified original tenant purchase invoice can be refunded');
      }
      return {
        tenantOrderId: duplicate.id, subscriptionId: subscription.id, subscriptionStatus: subscription.status!,
        invoiceId: invoice.id, chargeId: charge.id, originalAmount: invoice.amountPaid!,
        alreadyRefunded: charge.amountRefunded!, remainingAmount: invoice.amountPaid! - charge.amountRefunded!,
        ...(charge.refunds.length ? { refundId: charge.refunds[0].id, refundStatus: 'succeeded' } : {}),
      } satisfies DuplicateReceipt;
    }));
    if (new Set([kept.invoice.id, ...plans.map(plan => plan.invoiceId)]).size !== plans.length + 1
      || new Set([kept.charge.id, ...plans.map(plan => plan.chargeId)]).size !== plans.length + 1) {
      throw new RecoveryError('Selected orders must have distinct purchase invoices and charges');
    }
    const originalRefundTotal = plans.reduce((sum, plan) => sum + plan.originalAmount, 0);
    const remainingRefundTotal = plans.reduce((sum, plan) => sum + plan.remainingAmount, 0);
    if (originalRefundTotal !== expectedRefundTotal) throw new RecoveryError('Verified original purchase amounts do not match the authorized refund total');
    const summary = { keepTenantOrderId, originalRefundTotal, remainingRefundTotal, currency: 'usd' };
    if (dryRun) return json({ success: true, dryRun: true, ...summary, duplicates: plans });

    for (const plan of plans) {
      const receipt: DuplicateReceipt = { ...plan };
      receipts.push(receipt);
      if (plan.subscriptionStatus !== 'canceled') {
        const cancelled = await stripeRequest(`/subscriptions/${plan.subscriptionId}`, 'DELETE', new URLSearchParams({ invoice_now: 'false', prorate: 'false' }));
        if (cancelled.id !== plan.subscriptionId || cancelled.status !== 'canceled') {
          throw new RecoveryError('Duplicate subscription cancellation was not confirmed; audit before retrying', 502);
        }
      }
      receipt.cancelled = true;
      if (plan.remainingAmount > 0) {
        const refund = await stripeRequest('/refunds', 'POST', new URLSearchParams({
          charge: plan.chargeId, amount: String(plan.remainingAmount), reason: 'duplicate',
          'metadata[tenant_order_id]': plan.tenantOrderId, 'metadata[keep_tenant_order_id]': keep.id,
        }), `tenant-duplicate-refund:${plan.tenantOrderId}:${plan.invoiceId}`);
        if (typeof refund.id !== 'string' || refund.charge !== plan.chargeId
          || refund.amount !== plan.remainingAmount || refund.currency !== 'usd') {
          throw new RecoveryError('Duplicate refund amount or ownership was not confirmed; audit before retrying', 502);
        }
        receipt.refundId = refund.id;
        receipt.refundStatus = typeof refund.status === 'string' ? refund.status : 'unknown';
        if (refund.status !== 'succeeded') {
          return json({ success: false, dryRun: false, pending: refund.status === 'pending', ...summary,
            error: 'Refund completion is not confirmed. Review the receipt before retrying.', duplicates: receipts }, refund.status === 'pending' ? 202 : 502);
        }
      } else receipt.alreadyCompleted = true;
      const { error: saveError, data: saved } = await supabase.from('tenant_orders')
        .update({ status: 'cancelled' }).eq('id', plan.tenantOrderId)
        .eq('organization_id', keep.organization_id).eq('stripe_subscription_id', plan.subscriptionId)
        .in('status', ['failed', 'cancelled']).is('pax8_order_id', null).is('pax8_subscription_id', null)
        .select('id').single();
      if (saveError || !saved) throw new RecoveryError('Billing recovery completed but the order record needs reconciliation; audit before retrying', 500);
    }
    return json({ success: true, dryRun: false, ...summary, duplicates: receipts });
  } catch (error) {
    const message = error instanceof RecoveryError ? error.message : 'Billing recovery could not be verified; audit before retrying';
    return json({ success: false, error: message, duplicates: receipts }, error instanceof RecoveryError ? error.status : 502);
  }
}

if (import.meta.main) Deno.serve(handleTenantOrderRecoverBilling);
