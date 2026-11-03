/**
 * tenant-order-cancel
 *
 * Invoked by stripe-webhook when customer.subscription.deleted fires.
 * Looks up the tenant_order by stripe_subscription_id, cancels the Pax8
 * subscription, and marks the row cancelled.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { cancelPax8Subscription } from '../_shared/pax8-client.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';

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

  // Cancels a Pax8 subscription: internal callers only (stripe-webhook, infra-domain-move).
  if (!isServiceRoleRequest(req)) return json({ success: false, error: 'Forbidden' }, 403);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { tenantOrderId, stripeSubscriptionId } = await req.json();

    let query = supabase.from('tenant_orders').select('*').limit(1);
    if (tenantOrderId) {
      query = query.eq('id', tenantOrderId);
    } else if (stripeSubscriptionId) {
      query = query.eq('stripe_subscription_id', stripeSubscriptionId);
    } else {
      return json({ success: false, error: 'tenantOrderId or stripeSubscriptionId required' }, 400);
    }

    const { data: rows, error: loadErr } = await query;
    if (loadErr) return json({ success: false, error: loadErr.message }, 500);
    const order = rows?.[0];
    if (!order) return json({ success: false, error: 'Order not found' }, 404);

    if (order.status === 'cancelled') {
      return json({ success: true, alreadyCancelled: true });
    }

    if (order.pax8_subscription_id) {
      try {
        await cancelPax8Subscription(order.pax8_subscription_id);
      } catch (err) {
        console.error('[tenant-order-cancel] Pax8 cancel failed:', err);
        // Continue - mark cancelled in our DB anyway so Stripe + ACA stay in sync.
        // Ops can manually reconcile Pax8 if needed.
      }
    }

    await supabase
      .from('tenant_orders')
      .update({ status: 'cancelled' })
      .eq('id', order.id);

    return json({ success: true });
  } catch (error) {
    console.error('[tenant-order-cancel] Error:', error);
    return json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    );
  }
});
