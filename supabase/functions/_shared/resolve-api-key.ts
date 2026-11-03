import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

interface ResolvedApiKey {
  key_encrypted: string;
  metadata: Record<string, string> | null;
  source_organization_id: string;
}

/**
 * Resolve an API key for an organization, checking inheritance from parent.
 *
 * Multi-tenancy: Agency orgs own API keys. Client orgs (children) inherit
 * from their parent via organization_settings.inherit_api_keys_from_parent.
 *
 * 1. Direct lookup on api_keys for the given org + provider
 * 2. If not found, check if org inherits from parent
 * 3. If inheriting, lookup parent's API key
 */
export async function resolveApiKey(
  supabase: SupabaseClient,
  organizationId: string,
  provider: string,
): Promise<ResolvedApiKey | null> {
  // 1. Direct lookup
  const { data: directKey } = await supabase
    .from('api_keys')
    .select('key_encrypted, metadata')
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .eq('is_valid', true)
    .maybeSingle();

  if (directKey?.key_encrypted) {
    return {
      key_encrypted: directKey.key_encrypted,
      metadata: directKey.metadata as Record<string, string> | null,
      source_organization_id: organizationId,
    };
  }

  // 2. Check if org inherits from parent
  const { data: org } = await supabase
    .from('organizations')
    .select('parent_id')
    .eq('id', organizationId)
    .single();

  if (!org?.parent_id) return null;

  // 3. Lookup parent's API key
  const { data: parentKey } = await supabase
    .from('api_keys')
    .select('key_encrypted, metadata')
    .eq('organization_id', org.parent_id)
    .eq('provider', provider)
    .eq('is_valid', true)
    .maybeSingle();

  if (parentKey?.key_encrypted) {
    return {
      key_encrypted: parentKey.key_encrypted,
      metadata: parentKey.metadata as Record<string, string> | null,
      source_organization_id: org.parent_id,
    };
  }

  return null;
}

/**
 * Resolve the effective organization ID for the current user.
 * Checks impersonation -> active org -> default org, matching AuthContext logic.
 */
export async function resolveEffectiveOrgId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, active_organization_id, impersonating_organization_id')
    .eq('id', userId)
    .single();

  if (!userData) return null;

  return (
    userData.impersonating_organization_id ||
    userData.active_organization_id ||
    userData.organization_id
  );
}
