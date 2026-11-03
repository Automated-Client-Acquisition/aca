/**
 * tenant-order-provision
 *
 * Internal edge function invoked by stripe-webhook after payment succeeds.
 * Creates a Pax8 company, then places a single order that provisions a new
 * Microsoft 365 tenant and attaches one Business Basic (no Teams) seat.
 *
 * Before provider acceptance, errors retain the failed paid order for recovery.
 * Recorded provider orders are reconciled without placing another order.
 */

import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import {
  createPax8Company,
  createPax8Order,
  findPax8CompanyByExternalId,
  getPax8Company,
  getPax8Order,
  getPax8Subscription,
  listPax8Subscriptions,
  tenantOrderCompanyName,
  updatePax8CompanyAddress,
} from '../_shared/pax8-client.ts';
import { auditTenantOrderBilling } from '../_shared/tenant-order-billing.ts';
import { normalizeUkPostcode } from '../_shared/tenant-order-validation.ts';
import { OPS_EMAIL } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Derive a safe xxx.onmicrosoft.com prefix from the business domain */
function tenantPrefixFromDomain(domain: string): string {
  // Buyers routinely type "www.acme.com". Taking the first label verbatim would
  // hand them a permanent wwwXXXXX.onmicrosoft.com tenant, so drop scheme/www.
  const host = domain.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
  const base = host.split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}${suffix}`.slice(0, 27);
}

// deno-lint-ignore no-explicit-any
function extractM365Details(order: any): {
  subscriptionId: string | null;
  tenantDomain: string | null;
  adminEmail: string | null;
} {
  // Pax8 order responses wrap provisioning results in the line item(s).
  // Shape varies slightly by account; be defensive.
  const line = order?.lineItems?.[0] ?? order?.items?.[0];
  const subscriptionId =
    line?.subscriptionId ?? line?.subscription?.id ?? order?.subscriptionId ?? null;

  // Provisioning result keys Pax8 populates after tenant creation
  // deno-lint-ignore no-explicit-any
  const details: any[] = line?.provisioningDetails ?? line?.provisioning_details ?? [];
  const getValue = (key: string): string | null => {
    const row = details.find((d) => d?.key === key);
    if (!row) return null;
    const values = row.values ?? row.value ?? [];
    if (Array.isArray(values)) return values[0] ?? null;
    return typeof values === 'string' ? values : null;
  };

  return {
    subscriptionId,
    tenantDomain: getValue('msDomain'),
    // MCA/contact fields are buyer inputs, never tenant admin credentials.
    adminEmail: getValue('adminEmail') ?? getValue('adminUserName'),
  };
}

function providerTenantState(providerStatus?: string) {
  if (providerStatus === 'Active') return { status: 'active', failure_reason: null };
  if (['Cancelled', 'PendingCancel', 'WaitingForDetails'].includes(providerStatus ?? '')) {
    return { status: 'failed', failure_reason: `Provider subscription is ${providerStatus}. Recover this existing paid order with support; do not purchase again.` };
  }
  return { status: 'provisioning', failure_reason: null };
}

export async function handleTenantOrderProvision(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  // Only the payment webhook / authorized operations can provision a paid order.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let tenantOrderId: string | undefined;
  let dryRun = false;

  try {
    const body = await req.json();
    tenantOrderId = body.tenantOrderId;
    // dryRun: report what Pax8 already holds for this order WITHOUT ordering.
    // Use before any manual retry of a paid order — an order is real money.
    dryRun = body.dryRun === true;
    if (!tenantOrderId) return json({ success: false, error: 'tenantOrderId required' }, 400);

    const { data: order, error: loadErr } = await supabase
      .from('tenant_orders')
      .select('*')
      .eq('id', tenantOrderId)
      .single();

    if (loadErr || !order) {
      return json({ success: false, error: loadErr?.message ?? 'Order not found' }, 404);
    }
    if (!dryRun && (order.status === 'cancelled' || !order.stripe_subscription_id)) {
      return json({ success: false, error: 'Only an existing paid, non-cancelled order can be provisioned' }, 409);
    }

    // A recorded provider order prevents another purchase, but does not prove
    // provisioning completed. Reconcile using the actual subscription status.
    const billing = dryRun && body.includeBilling === true
      ? await auditTenantOrderBilling({ subscriptionIds: [order.stripe_subscription_id].filter(Boolean),
        customerIds: [order.stripe_customer_id].filter(Boolean), customerEmail: order.contact_email,
        organizationId: order.organization_id })
      : undefined;
    if (order.pax8_order_id) {
      const providerOrder = await getPax8Order(order.pax8_order_id);
      const details = extractM365Details(providerOrder);
      const subscriptionId = order.pax8_subscription_id ?? details.subscriptionId;
      const subscription = subscriptionId ? await getPax8Subscription(subscriptionId) : null;
      const state = providerTenantState(subscription?.status);
      const prefix = details.tenantDomain;
      const tenantDomain = prefix
        ? (prefix.endsWith('.onmicrosoft.com') ? prefix : `${prefix}.onmicrosoft.com`)
        : order.m365_tenant_domain;
      if (!dryRun) {
        const { error } = await supabase.from('tenant_orders').update({
          pax8_subscription_id: subscriptionId, ...state,
          ...(tenantDomain ? { m365_tenant_domain: tenantDomain } : {}),
          ...(details.adminEmail ? { m365_admin_email: details.adminEmail } : {}),
        }).eq('id', tenantOrderId);
        if (error) throw new Error(`Failed to save provider status: ${error.message}`);
      }
      return json({ success: true, alreadyOrdered: true, dryRun, ...state,
        providerOrder, subscription, billing, wouldPlaceOrder: false });
    }

    // Validate required fields from the richer schema
    const requiredFields = [
      'company_name', 'business_domain',
      'contact_first_name', 'contact_last_name', 'contact_email',
      'address_line1', 'city', 'postal_code', 'country_code',
      'phone_country_code', 'phone_number',
    ];
    for (const f of requiredFields) {
      if (!order[f]) {
        throw new Error(`Order is missing required field: ${f}`);
      }
    }

    // Pax8 validates phone by country — sending a local number WITHOUT the
    // +XX dial code is what their partner UI and API actually accept.
    const phoneForPax8 = String(order.phone_number).trim();

    // 1. Reconcile against Pax8 before creating anything. A retry of a paid
    // order must never create a second company or a second billable tenant,
    // so we look the company up by externalId (= this order's id) first.
    const existingCompany = order.pax8_company_id
      ? await getPax8Company(order.pax8_company_id)
      : await findPax8CompanyByExternalId(order.id);
    const existingSubs = existingCompany
      ? (await listPax8Subscriptions(existingCompany.id))
        .filter((s) => s.status !== 'Cancelled')
      : [];

    if (dryRun) {
      return json({
        success: true,
        dryRun: true,
        orderStatus: order.status,
        billing,
        pax8CompanyFound: existingCompany
          ? { id: existingCompany.id, name: existingCompany.name, address: existingCompany.address }
          : null,
        subscriptions: existingSubs.map((s) => ({
          id: s.id,
          productName: s.productName,
          status: s.status,
          createdDate: s.createdDate,
        })),
        wouldCreateCompany: !existingCompany,
        wouldPlaceOrder: existingSubs.length === 0,
        addressValid: order.country_code !== 'GB' || !!normalizeUkPostcode(order.postal_code),
      });
    }

    // Already has a live subscription: the tenant exists, only our DB row is
    // out of date. Backfill what we can and stop — do NOT order again.
    if (existingCompany && existingSubs.length > 0) {
      const { error: reconcileErr } = await supabase
        .from('tenant_orders')
        .update({
          pax8_company_id: existingCompany.id,
          pax8_subscription_id: existingSubs[0].id,
          ...providerTenantState(existingSubs[0].status),
        })
        .eq('id', tenantOrderId);
      if (reconcileErr) throw new Error(`Failed to save reconciled tenant: ${reconcileErr.message}`);
      return json({
        success: true,
        reconciled: true,
        pax8CompanyId: existingCompany.id,
        pax8SubscriptionId: existingSubs[0].id,
      });
    }

    if (order.country_code === 'GB' && !normalizeUkPostcode(order.postal_code)) {
      throw new Error('A full UK postcode is required before provisioning. Correct the existing paid order; do not purchase again.');
    }

    // Company exists but never got a subscription (order call failed after the
    // company was created) — reuse it rather than creating a duplicate.
    const company = existingCompany ?? await createPax8Company({
      companyName: tenantOrderCompanyName(order.company_name, order.id),
      addressLine1: order.address_line1,
      addressLine2: order.address_line2,
      city: order.city,
      stateOrProvince: order.state_province,
      postalCode: order.country_code === 'GB' ? normalizeUkPostcode(order.postal_code)! : order.postal_code,
      country: order.country_code,
      phone: phoneForPax8,
      website: order.business_domain,
      contactFirstName: order.contact_first_name,
      contactLastName: order.contact_last_name,
      contactEmail: order.contact_email,
      externalId: order.id,
    });

    // Retain the provider identity even when Microsoft rejects the subsequent
    // order. A retry must reuse this company, including after address correction.
    const { error: companySaveErr } = await supabase.from('tenant_orders')
      .update({ pax8_company_id: company.id }).eq('id', tenantOrderId);
    if (companySaveErr) throw new Error(`Failed to save Pax8 company: ${companySaveErr.message}`);

    if (existingCompany) {
      const address = {
        street: order.address_line1,
        street2: order.address_line2 ?? null,
        city: order.city,
        stateOrProvince: order.state_province ?? null,
        postalCode: order.country_code === 'GB' ? normalizeUkPostcode(order.postal_code)! : order.postal_code,
        country: order.country_code,
      };
      const changed = Object.entries(address).some(([key, value]) =>
        (existingCompany.address?.[key] ?? null) !== value);
      if (changed) await updatePax8CompanyAddress(existingCompany, address);
    }

    // 2. Place the order (provisions tenant + attaches Business Basic seat)
    const productId = Deno.env.get('PAX8_M365_BB_NO_TEAMS_PRODUCT_ID')!;
    const tenantPrefix = tenantPrefixFromDomain(order.business_domain);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const pax8Order = await createPax8Order({
      companyId: company.id,
      productId,
      tenantPrefix,
      adminFirstName: order.contact_first_name,
      adminLastName: order.contact_last_name,
      adminEmail: order.contact_email,
      mcaEffectiveDate: today,
      orderedByEmail: OPS_EMAIL,
    }, body.validateOnly === true);
    if (body.validateOnly === true) return json({ success: true, validatedOnly: true, pax8CompanyId: company.id });

    const details = extractM365Details(pax8Order);
    const prefix = details.tenantDomain ?? tenantPrefix;
    const finalTenantDomain = prefix.endsWith('.onmicrosoft.com')
      ? prefix : `${prefix}.onmicrosoft.com`;

    // Persist acceptance BEFORE reading asynchronous provisioning results.
    // A failed follow-up read must never cause another paid provider order.
    const { error: saveErr } = await supabase.from('tenant_orders').update({
      pax8_company_id: company.id,
      pax8_order_id: pax8Order.id,
      pax8_subscription_id: details.subscriptionId,
      m365_tenant_domain: finalTenantDomain,
      m365_admin_email: details.adminEmail,
      status: 'provisioning', failure_reason: null,
    }).eq('id', tenantOrderId);
    if (saveErr) throw new Error(`Failed to save accepted provider order: ${saveErr.message}`);

    let status = 'provisioning';
    if (details.subscriptionId) {
      try {
        const subscription = await getPax8Subscription(details.subscriptionId);
        const state = providerTenantState(subscription.status);
        if (state.status !== 'provisioning') {
          const { error } = await supabase.from('tenant_orders')
            .update(state).eq('id', tenantOrderId);
          if (error) throw new Error(error.message);
          status = state.status;
        }
      } catch (error) {
        console.warn('[tenant-order-provision] Order accepted; status reconciliation pending:', error);
      }
    }
    return json({ success: true, status, pax8OrderId: pax8Order.id,
      pax8SubscriptionId: details.subscriptionId, tenantDomain: finalTenantDomain });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    console.error('[tenant-order-provision] Error:', reason, 'orderId:', tenantOrderId);

    // Mark the row failed (never hard-delete) so a paid customer's order is
    // always retained for reconciliation. The partial unique indexes on
    // business_domain / contact_email exclude status IN ('cancelled','failed'),
    // so a 'failed' row still frees the domain + email for a retry / new
    // checkout — same effect as the old delete, without the data loss.
    if (tenantOrderId && !dryRun) {
      await supabase
        .from('tenant_orders')
        .update({
          status: 'failed',
          failure_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenantOrderId)
        .is('pax8_order_id', null);
    }

    return json({ success: false, error: reason }, 500);
  }
}

if (import.meta.main) Deno.serve(handleTenantOrderProvision);
