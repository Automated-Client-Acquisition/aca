/**
 * stripe-webhook
 *
 * Public endpoint. Verifies Stripe signature, then reacts to subscription
 * lifecycle events for tenant_orders:
 *   - checkout.session.completed   -> provisioning (invoke provision fn);
 *                                     ACA Network card setup -> default payment method
 *   - invoice.payment_succeeded    -> app billing only (tenant readiness comes from Pax8)
 *   - invoice.payment_failed       -> no-op (Stripe handles dunning)
 *   - customer.subscription.deleted -> cancel Pax8 subscription
 *
 * Deploy without JWT verification:
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import Stripe from 'npm:stripe@^17.0.0';
import { hasTenantOrderForSubscription, isTenantOrderSubscription } from '../_shared/tenant-order-validation.ts';
import { hostedOnlyResponse } from "../_shared/site-config.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

serve(async (req) => {
  const hostedOnly = hostedOnlyResponse("Stripe webhooks", {});
  if (hostedOnly) return hostedOnly;

  // Built per request, after the guard: Stripe throws on a missing key, which at
  // module level would stop the function from booting at all.
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    );
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantOrderId = session.metadata?.tenant_order_id;
        const onboardingOrgId = session.metadata?.organization_id;
        const onboardingSource = session.metadata?.source;

        // ACA Network card (setup mode, nothing charged): make it the default so
        // network usage can be billed off-session, then mark billing ready.
        if (onboardingSource === 'network_billing' && onboardingOrgId) {
          const setupIntentId = session.setup_intent as string | null;
          if (!setupIntentId || !session.customer) {
            console.error('[stripe-webhook] network_billing session without setup_intent/customer', session.id);
            break;
          }
          const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
          const paymentMethodId = setupIntent.payment_method as string | null;
          if (!paymentMethodId) {
            console.error('[stripe-webhook] network_billing setup intent has no payment method', setupIntentId);
            break;
          }
          await stripe.customers.update(session.customer as string, {
            invoice_settings: { default_payment_method: paymentMethodId },
          });
          const { error: readyErr } = await supabase
            .from('organizations')
            .update({ network_billing_ready_at: new Date().toISOString() })
            .eq('id', onboardingOrgId);
          if (readyErr) {
            console.error('[stripe-webhook] failed to mark network billing ready', readyErr);
          }
          break;
        }

        if (tenantOrderId) {
          await supabase
            .from('tenant_orders')
            .update({
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              status: 'provisioning',
            })
            .eq('id', tenantOrderId);

          const { error: provErr } = await supabase.functions.invoke('tenant-order-provision', {
            body: { tenantOrderId },
          });
          if (provErr) {
            console.error('[stripe-webhook] provision invoke failed:', provErr);
            // The invoke never reached the provision function, so nothing will
            // mark this order failed. Leaving it in 'provisioning' meant the
            // next invoice.payment_succeeded quietly flipped it to 'active' and
            // a paying customer never got a tenant. Record the failure here.
            await supabase
              .from('tenant_orders')
              .update({
                status: 'failed',
                failure_reason: `provision invoke failed: ${provErr.message ?? provErr}`,
              })
              .eq('id', tenantOrderId)
              .eq('status', 'provisioning')
              .is('pax8_order_id', null);
          }
          break;
        }

        if (onboardingSource === 'onboarding' && onboardingOrgId) {
          const onboardUpdate: Record<string, unknown> = {
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            subscription_status: 'trialing',
          };
          // Guard (same rationale as subscription.updated): never blank an
          // existing plan_tier when checkout metadata omits it.
          if (session.metadata?.plan_tier) {
            onboardUpdate.plan_tier = session.metadata.plan_tier;
          }
          await supabase
            .from('organizations')
            .update(onboardUpdate)
            .eq('id', onboardingOrgId);
          break;
        }

        console.warn('[stripe-webhook] checkout.session.completed without recognized metadata');
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        // Tenant purchases carry organization_id for ownership, but must never
        // replace the organization's app plan subscription or billing state.
        if (isTenantOrderSubscription(sub.metadata)) break;
        const orgId = sub.metadata?.organization_id;
        if (!orgId) break;
        const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
        const { data: priorOrg } = await supabase
          .from('organizations')
          .select('subscription_status, past_due_since')
          .eq('id', orgId)
          .maybeSingle();
        // Track when past_due first started — clear when it recovers.
        let pastDueSince = priorOrg?.past_due_since ?? null;
        if (sub.status === 'past_due' && !pastDueSince) {
          pastDueSince = new Date().toISOString();
        } else if (sub.status !== 'past_due') {
          pastDueSince = null;
        }
        const orgUpdate: Record<string, unknown> = {
          subscription_status: sub.status,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer as string,
          trial_ends_at: trialEndsAt,
          past_due_since: pastDueSince,
        };
        // Only write plan_tier when the Stripe subscription explicitly carries
        // it in metadata. A subscription that lacks plan_tier metadata (e.g. an
        // M365 / tenant-infra subscription) must NOT blank an org's content
        // plan_tier — that silently downgrades a paying customer to "free" and
        // breaks publishing via the requireFeature gate. Preserve existing tier.
        if (sub.metadata?.plan_tier) {
          orgUpdate.plan_tier = sub.metadata.plan_tier;
        }
        await supabase
          .from('organizations')
          .update(orgUpdate)
          .eq('id', orgId);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription as string | null;
        if (!subId) break;
        const tenantSubscription = await hasTenantOrderForSubscription(supabase, subId);
        // Tenant readiness is reconciled from Pax8; even an accepted order
        // can still be provisioning when its Stripe invoice is paid.
        if (tenantSubscription) break;
        // Payment recovered: clear the past_due_since stamp.
        await supabase
          .from('organizations')
          .update({ subscription_status: 'active', past_due_since: null })
          .eq('stripe_subscription_id', subId);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription as string | null;
        console.warn('[stripe-webhook] payment_failed for sub:', subId);
        if (subId) {
          if (await hasTenantOrderForSubscription(supabase, subId)) break;
          // Only stamp past_due_since the FIRST time it fails. Subsequent
          // retries within the same dunning cycle shouldn't reset the clock.
          const { data: org } = await supabase
            .from('organizations')
            .select('past_due_since')
            .eq('stripe_subscription_id', subId)
            .maybeSingle();
          await supabase
            .from('organizations')
            .update({
              subscription_status: 'past_due',
              past_due_since: org?.past_due_since ?? new Date().toISOString(),
            })
            .eq('stripe_subscription_id', subId);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const tenantSubscription = isTenantOrderSubscription(sub.metadata)
          || await hasTenantOrderForSubscription(supabase, sub.id);
        if (!tenantSubscription) {
          await supabase
            .from('organizations')
            .update({ subscription_status: 'canceled' })
            .eq('stripe_subscription_id', sub.id);
        }
        const { error: cancelErr } = await supabase.functions.invoke('tenant-order-cancel', {
          body: { stripeSubscriptionId: sub.id },
        });
        if (cancelErr) console.error('[stripe-webhook] cancel invoke failed:', cancelErr);
        break;
      }

      default:
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err);
    return new Response('Handler error', { status: 500 });
  }
});
