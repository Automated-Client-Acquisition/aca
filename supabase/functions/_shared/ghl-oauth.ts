export interface GHLOAuthTokenRow {
  id: string;
  organization_id: string;
  location_id: string;
  company_id: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string;
  scopes: string[] | null;
  ghl_user_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * ACA currently stores GHL OAuth tokens with a unique key of
 * (organization_id, location_id). That means an org can end up with multiple
 * token rows, so callers should not assume `.single()` by organization.
 */
export async function getLatestGHLOAuthTokenRow(
  supabase: any,
  organizationId: string,
): Promise<GHLOAuthTokenRow | null> {
  const { data, error } = await supabase
    .from('ghl_oauth_tokens')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as GHLOAuthTokenRow | null;
}
