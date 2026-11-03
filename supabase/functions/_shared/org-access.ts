/**
 * Authorization for functions deployed with verify_jwt=false that act on an
 * organization's resources with the service-role client.
 *
 * Accepts either:
 *  - an internal call carrying the service-role key, or
 *  - a user JWT / aca_ API token whose caller can access the resource's org
 *    (own org, membership, super-admin impersonation, agency client orgs).
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { authenticateRequest, AuthError } from './cli-auth.ts';

function bearer(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

export function isServiceRoleRequest(req: Request): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return serviceKey.length > 0 && bearer(req) === serviceKey;
}

/** Throws AuthError (401/403) unless the request may act on `organizationId`. */
export async function assertOrgAccess(
  req: Request,
  supabase: SupabaseClient,
  organizationId: string | null | undefined,
): Promise<void> {
  if (isServiceRoleRequest(req)) return;
  if (!organizationId) throw new AuthError('Forbidden', 403);

  const caller = await authenticateRequest(req, supabase);
  if (caller.organization_id === organizationId) return;
  if (caller.auth_method === 'api_token') throw new AuthError('Forbidden', 403);

  const { data: member } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', caller.user_id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (member) return;

  // Impersonation and agency client orgs are resolved by the same SQL function the
  // RLS policies use, evaluated as the calling user.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${bearer(req)}` } } },
  );
  const { data: accessible } = await userClient.rpc('get_accessible_organization_ids');
  const ids = (Array.isArray(accessible) ? accessible : [accessible])
    .map((r: unknown) => (typeof r === 'string' ? r : (r as Record<string, string> | null)?.get_accessible_organization_ids))
    .filter(Boolean);
  if (ids.includes(organizationId)) return;

  throw new AuthError('Forbidden', 403);
}
