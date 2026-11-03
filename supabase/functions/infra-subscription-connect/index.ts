/**
 * Infrastructure Subscription Connect
 *
 * Manages Azure subscription connections for cold email infrastructure.
 * Actions:
 *   - validate: Test Azure credentials, return subscription info
 *   - connect: Validate + encrypt + store subscription
 *   - disconnect: Mark subscription as disconnected
 *   - refresh: Re-validate existing subscription
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getAzureToken, getSubscription, listLocations, AzureAPIError } from '../_shared/azure-sdk.ts';
import { encryptValue, decryptValue } from '../_shared/encryption.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { action } = body;

    // ── validate ─────────────────────────────────────────────────────
    if (action === 'validate') {
      const { subscription_id, azure_tenant_id } = body;
      // Legacy inline credentials
      const { tenant_id: legacyTenantId, client_id: legacyClientId, client_secret: legacyClientSecret } = body;

      if (!subscription_id) {
        return jsonResponse({ error: 'subscription_id is required' }, 400);
      }

      // Resolve credentials
      let tenantId: string;
      let clientId: string;
      let clientSecret: string;

      if (azure_tenant_id) {
        const { data: tenant, error: tenantErr } = await supabase
          .from('azure_tenants')
          .select('*')
          .eq('id', azure_tenant_id)
          .single();

        if (tenantErr || !tenant) {
          return jsonResponse({ error: 'Azure tenant not found' }, 404);
        }

        // The stored credentials belong to the tenant row's org, so the caller
        // must be able to access it (a valid anon-key JWT alone is not enough).
        try {
          await assertOrgAccess(req, supabase, tenant.organization_id);
        } catch (authErr) {
          return unauthorized(authErr, corsHeaders);
        }

        tenantId = tenant.tenant_id;
        clientId = tenant.client_id;
        clientSecret = await decryptValue(tenant.client_secret_encrypted);
      } else if (legacyTenantId && legacyClientId && legacyClientSecret) {
        // Inline credentials touch no org data, but still require a signed-in caller.
        if (!isServiceRoleRequest(req)) {
          try {
            await authenticateRequest(req, supabase);
          } catch (authErr) {
            return unauthorized(authErr, corsHeaders);
          }
        }
        tenantId = legacyTenantId;
        clientId = legacyClientId;
        clientSecret = legacyClientSecret;
      } else {
        return jsonResponse({ error: 'Provide azure_tenant_id or inline credentials' }, 400);
      }

      console.log(`[Infra] Validating Azure subscription ${subscription_id}`);

      try {
        const token = await getAzureToken(tenantId, clientId, clientSecret);
        const subscription = await getSubscription(token, subscription_id);
        const locations = await listLocations(token, subscription_id);

        // Filter to regions commonly used for email (low latency to major providers)
        const recommendedRegions = locations.filter((l) =>
          ['eastus', 'eastus2', 'westus2', 'westeurope', 'northeurope', 'centralus', 'southcentralus'].includes(l.name)
        );

        return jsonResponse({
          success: true,
          subscription: {
            id: subscription.subscriptionId,
            name: subscription.displayName,
            state: subscription.state,
            tenant_id: subscription.tenantId,
          },
          available_regions: recommendedRegions.length > 0 ? recommendedRegions : locations.slice(0, 20),
        });
      } catch (err) {
        const message = err instanceof AzureAPIError
          ? `Azure API error (${err.code}): ${err.message}`
          : (err instanceof Error ? err.message : 'Unknown error');

        console.error(`[Infra] Validation failed for subscription ${subscription_id}:`, message);
        return jsonResponse({ success: false, error: message }, 400);
      }
    }

    // ── connect ──────────────────────────────────────────────────────
    if (action === 'connect') {
      const { organization_id, subscription_id, azure_tenant_id, region, display_name, resource_group } = body;
      // Legacy support: also accept inline credentials
      const { tenant_id: legacyTenantId, client_id: legacyClientId, client_secret: legacyClientSecret } = body;

      if (!organization_id || !subscription_id) {
        return jsonResponse({ error: 'Missing required fields: organization_id, subscription_id' }, 400);
      }

      // The service-role client acts on whatever org the body names, so the caller
      // must be able to access it (a valid anon-key JWT alone is not enough).
      try {
        await assertOrgAccess(req, supabase, organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      // Resolve credentials: prefer tenant-based, fall back to inline
      let tenantId: string;
      let clientId: string;
      let clientSecret: string;
      let tenantRowId: string | null = null;

      if (azure_tenant_id) {
        // Fetch credentials from azure_tenants
        const { data: tenant, error: tenantErr } = await supabase
          .from('azure_tenants')
          .select('*')
          .eq('id', azure_tenant_id)
          .eq('organization_id', organization_id)
          .single();

        if (tenantErr || !tenant) {
          return jsonResponse({ error: 'Azure tenant not found' }, 404);
        }

        tenantId = tenant.tenant_id;
        clientId = tenant.client_id;
        clientSecret = await decryptValue(tenant.client_secret_encrypted);
        tenantRowId = tenant.id;
      } else if (legacyTenantId && legacyClientId && legacyClientSecret) {
        tenantId = legacyTenantId;
        clientId = legacyClientId;
        clientSecret = legacyClientSecret;
      } else {
        return jsonResponse({ error: 'Provide azure_tenant_id or inline credentials (tenant_id, client_id, client_secret)' }, 400);
      }

      console.log(`[Infra] Connecting Azure subscription ${subscription_id} for org ${organization_id}`);

      // Validate credentials
      try {
        const token = await getAzureToken(tenantId, clientId, clientSecret);
        await getSubscription(token, subscription_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Validation failed';
        return jsonResponse({ success: false, error: `Credential validation failed: ${message}` }, 400);
      }

      // Encrypt client secret for backward-compat storage
      const clientSecretEncrypted = await encryptValue(clientSecret);

      // Upsert subscription
      const { data: sub, error: upsertError } = await supabase
        .from('azure_subscriptions')
        .upsert({
          organization_id,
          subscription_id,
          tenant_id: tenantId,
          client_id: clientId,
          client_secret_encrypted: clientSecretEncrypted,
          azure_tenant_id: tenantRowId,
          resource_group: resource_group || 'aca-email-infra',
          region: region || 'eastus',
          display_name: display_name || null,
          status: 'connected',
          last_validated_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'organization_id,subscription_id',
        })
        .select()
        .single();

      if (upsertError) {
        console.error(`[Infra] Failed to store subscription:`, upsertError.message);
        return jsonResponse({ error: `Failed to store subscription: ${upsertError.message}` }, 500);
      }

      return jsonResponse({
        success: true,
        subscription: {
          id: sub.id,
          subscription_id: sub.subscription_id,
          display_name: sub.display_name,
          region: sub.region,
          status: sub.status,
        },
      });
    }

    // ── disconnect ───────────────────────────────────────────────────
    if (action === 'disconnect') {
      const { id } = body;

      if (!id) {
        return jsonResponse({ error: 'id is required' }, 400);
      }

      // The subscription row's org decides who may delete it.
      const { data: existingSub, error: existingErr } = await supabase
        .from('azure_subscriptions')
        .select('organization_id')
        .eq('id', id)
        .maybeSingle();

      if (existingErr || !existingSub) {
        return jsonResponse({ error: 'Subscription not found' }, 404);
      }

      try {
        await assertOrgAccess(req, supabase, existingSub.organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      console.log(`[Infra] Deleting Azure subscription ${id}`);

      const { error: deleteError } = await supabase
        .from('azure_subscriptions')
        .delete()
        .eq('id', id);

      if (deleteError) {
        return jsonResponse({ error: `Failed to delete subscription: ${deleteError.message}` }, 500);
      }

      return jsonResponse({ success: true });
    }

    // ── refresh ──────────────────────────────────────────────────────
    if (action === 'refresh') {
      const { id } = body;

      if (!id) {
        return jsonResponse({ error: 'id is required' }, 400);
      }

      // Fetch subscription
      const { data: sub, error: fetchError } = await supabase
        .from('azure_subscriptions')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !sub) {
        return jsonResponse({ error: 'Subscription not found' }, 404);
      }

      // The subscription row's org decides who may refresh (and decrypt) it.
      try {
        await assertOrgAccess(req, supabase, sub.organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      console.log(`[Infra] Refreshing Azure subscription ${sub.subscription_id}`);

      // Decrypt client secret
      const clientSecret = await decryptValue(sub.client_secret_encrypted);

      try {
        const token = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
        const subscription = await getSubscription(token, sub.subscription_id);

        await supabase
          .from('azure_subscriptions')
          .update({
            status: 'connected',
            last_validated_at: new Date().toISOString(),
            last_error: null,
            metadata: {
              ...(sub.metadata || {}),
              subscription_state: subscription.state,
              last_refresh: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        return jsonResponse({
          success: true,
          subscription: {
            id: sub.id,
            subscription_id: sub.subscription_id,
            display_name: sub.display_name,
            status: 'connected',
            state: subscription.state,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Refresh failed';
        console.error(`[Infra] Refresh failed for ${sub.subscription_id}:`, message);

        await supabase
          .from('azure_subscriptions')
          .update({
            status: 'error',
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        return jsonResponse({ success: false, error: message });
      }
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (error) {
    console.error('[Infra Subscription Connect] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});
