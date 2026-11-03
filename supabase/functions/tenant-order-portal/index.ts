/**
 * tenant-order-portal
 *
 * Returns a Stripe Customer Portal URL for a given tenant_order so the buyer
 * can view invoices, update payment method, or cancel the subscription.
 * Access is scoped to the caller's organization.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import Stripe from 'npm:stripe@^17.0.0';
import { APP_URL, hostedOnlyResponse } from "../_shared/site-config.ts";

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  const hostedOnly = hostedOnlyResponse("Microsoft 365 tenant billing", corsHeaders);
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

    const { tenantOrderId } = await req.json();
    if (!tenantOrderId) return json({ success: false, error: 'tenantOrderId required' }, 400);

    const { data: order, error: loadErr } = await supabase
      .from('tenant_orders')
      .select('id, organization_id, stripe_customer_id')
      .eq('id', tenantOrderId)
      .single();

    if (loadErr || !order) return json({ success: false, error: 'Order not found' }, 404);
    if (order.organization_id !== organizationId) {
      return json({ success: false, error: 'Forbidden' }, 403);
    }
    if (!order.stripe_customer_id) {
      return json({ success: false, error: 'Order has no Stripe customer yet' }, 400);
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? APP_URL;
    const session = await stripe.billingPortal.sessions.create({
      customer: order.stripe_customer_id,
      return_url: `${appBaseUrl}/m365-tenants`,
    });

    return json({ success: true, portalUrl: session.url });
  } catch (error) {
    console.error('[tenant-order-portal] Error:', error);
    return json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    );
  }
});
