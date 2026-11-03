/**
 * tenant-order-create-checkout
 *
 * Creates a pending tenant_orders row with the full billing/admin profile
 * required to provision a brand-new Microsoft 365 tenant, then returns a
 * Stripe Checkout URL. Quantity is hard-locked to 1 because each order
 * provisions exactly one isolated tenant.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import Stripe from 'npm:stripe@^17.0.0';
import { findFailedPaidTenantOrder, normalizeUkPostcode } from '../_shared/tenant-order-validation.ts';
import { APP_URL, hostedOnlyResponse } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com',
]);

// ISO-2 country codes allowed for M365 tenant creation (UK only)
const ALLOWED_COUNTRIES = new Set([
  'GB',
]);

const DOMAIN_REGEX = /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/i;
const DIAL_CODE_REGEX = /^\+\d{1,4}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  const hostedOnly = hostedOnlyResponse("Microsoft 365 tenant ordering", corsHeaders);
  if (hostedOnly) return hostedOnly;


  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ success: false, error: 'Unauthorized' }, 401);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return json({ success: false, error: 'Unauthorized' }, 401);

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();
    const organizationId = userData?.active_organization_id || userData?.organization_id;
    if (!organizationId) return json({ success: false, error: 'No organization' }, 400);

    const payload = await req.json();
    const {
      companyName,
      businessDomain,
      contactEmail,
      contactFirstName,
      contactLastName,
      addressLine1,
      addressLine2,
      city,
      stateProvince,
      postalCode,
      countryCode,
      phoneCountryCode,
      phoneNumber,
      termsAccepted,
    } = payload ?? {};

    // Required field check
    const requiredPresent = [
      companyName, businessDomain, contactEmail, contactFirstName, contactLastName,
      addressLine1, city, postalCode, countryCode, phoneCountryCode, phoneNumber,
    ].every((v) => typeof v === 'string' && v.trim().length > 0);
    if (!requiredPresent) {
      return json({ success: false, error: 'Missing required fields' }, 400);
    }
    if (termsAccepted !== true) {
      return json({ success: false, error: 'You must accept the terms to continue' }, 400);
    }

    // Normalize + validate domain
    const domain = String(businessDomain).trim().toLowerCase();
    if (!DOMAIN_REGEX.test(domain)) {
      return json({ success: false, error: 'Invalid business domain' }, 400);
    }
    if (FREE_EMAIL_DOMAINS.has(domain)) {
      return json(
        { success: false, error: 'Please enter your own business domain, not a free email provider' },
        400,
      );
    }

    // Country restriction
    const country = String(countryCode).trim().toUpperCase();
    if (!ALLOWED_COUNTRIES.has(country)) {
      return json(
        { success: false, error: 'This service is currently only available in the United Kingdom' },
        400,
      );
    }

    const normalizedPostalCode = normalizeUkPostcode(String(postalCode));
    if (!normalizedPostalCode) {
      return json(
        { success: false, error: 'Enter a complete UK postcode, including the last three characters (for example, BN2 1AA).' },
        400,
      );
    }

    // Phone sanity
    const dial = String(phoneCountryCode).trim();
    if (!DIAL_CODE_REGEX.test(dial)) {
      return json({ success: false, error: 'Invalid phone country code' }, 400);
    }

    const normalizedEmail = String(contactEmail).trim().toLowerCase();

    const failedPaidOrder = await findFailedPaidTenantOrder(supabase, organizationId, domain, normalizedEmail);
    if (failedPaidOrder) {
      return json({
        success: false,
        error: `You already paid for a tenant order for this domain or contact email. Contact support to complete your existing order (${failedPaidOrder.id}) before purchasing again.`,
      }, 409);
    }

    // Duplicate check: domain or contact email already used by an in-flight or
    // active order. Microsoft enforces global tenant domain uniqueness, so we
    // fail fast before charging.
    const { data: existing, error: dupErr } = await supabase
      .from('tenant_orders')
      .select('id, business_domain, contact_email, status')
      .or(`business_domain.eq.${domain},contact_email.eq.${normalizedEmail}`)
      .not('status', 'in', '(cancelled,failed)')
      .limit(1);

    if (dupErr) {
      console.error('[tenant-order-create-checkout] Duplicate check failed:', dupErr);
      return json({ success: false, error: dupErr.message }, 500);
    }
    if (existing && existing.length > 0) {
      const conflict = existing[0];
      const reason = conflict.business_domain === domain
        ? `A tenant has already been ordered for ${domain}.`
        : `A tenant has already been ordered using ${normalizedEmail} as the contact email.`;
      return json({ success: false, error: reason }, 409);
    }

    const { data: order, error: insertError } = await supabase
      .from('tenant_orders')
      .insert({
        organization_id: organizationId,
        created_by: user.id,
        company_name: String(companyName).trim(),
        business_domain: domain,
        contact_email: normalizedEmail,
        contact_first_name: String(contactFirstName).trim(),
        contact_last_name: String(contactLastName).trim(),
        address_line1: String(addressLine1).trim(),
        address_line2: addressLine2 ? String(addressLine2).trim() : null,
        city: String(city).trim(),
        state_province: stateProvince ? String(stateProvince).trim() : null,
        postal_code: normalizedPostalCode,
        country_code: country,
        phone_country_code: dial,
        phone_number: String(phoneNumber).trim(),
        terms_accepted_at: new Date().toISOString(),
        status: 'pending_payment',
      })
      .select()
      .single();

    if (insertError || !order) {
      console.error('[tenant-order-create-checkout] Insert failed:', insertError);
      if (insertError?.code === '23505') {
        return json({ success: false, error: 'A tenant has already been ordered for this domain or email.' }, 409);
      }
      return json({ success: false, error: insertError?.message ?? 'Failed to create order' }, 500);
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const priceId = Deno.env.get('STRIPE_M365_BB_PRICE_ID')!;
    const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? APP_URL;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
          adjustable_quantity: { enabled: false },
        },
      ],
      customer_email: normalizedEmail,
      client_reference_id: order.id,
      metadata: {
        tenant_order_id: order.id,
        organization_id: organizationId,
      },
      subscription_data: {
        metadata: {
          tenant_order_id: order.id,
          organization_id: organizationId,
        },
      },
      success_url: `${appBaseUrl}/m365-tenants/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/m365-tenants/cancelled`,
    });

    await supabase
      .from('tenant_orders')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', order.id);

    return json({ success: true, checkoutUrl: session.url });
  } catch (error) {
    console.error('[tenant-order-create-checkout] Error:', error);
    return json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    );
  }
});
