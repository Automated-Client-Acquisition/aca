// OpenRouter account/key-block detector.
//
// On 402, the org's OpenRouter key is technically valid but the account
// can't cover the requested max_tokens. We mark the api_keys row
// is_valid=false with a human-readable reason in metadata.last_error so
// the UI can surface "OpenRouter account needs credits" instead of a
// green checkmark — and so retries don't keep hammering a known-empty
// account.
//
// Returns the parsed user-facing message (for use in the thrown Error).

export async function handleOpenRouterKeyBlock(
  supabase: any,
  organizationId: string | null | undefined,
  status: number,
  errorBody: string,
): Promise<string | null> {
  const normalizedError = errorBody.toLowerCase();
  const isCreditBlock = status === 402;
  const isKeyLimitBlock = status === 403 && (
    normalizedError.includes('key limit exceeded')
    || normalizedError.includes('total limit')
    || normalizedError.includes('spending limit')
  );
  if (!isCreditBlock && !isKeyLimitBlock) return null;

  let userMessage = isCreditBlock
    ? 'OpenRouter account is out of credits — top up at https://openrouter.ai/settings/credits'
    : 'This OpenRouter key has reached its spending limit — raise the key limit or replace the key.';
  try {
    const parsed = JSON.parse(errorBody);
    const apiMessage = parsed?.error?.message;
    if (typeof apiMessage === 'string' && apiMessage.length > 0) {
      userMessage = apiMessage;
    }
  } catch {
    // errorBody wasn't JSON — keep the default message
  }

  if (organizationId) {
    try {
      // Fetch existing metadata so we don't clobber other fields
      const { data: existing } = await supabase
        .from('api_keys')
        .select('id, metadata')
        .eq('organization_id', organizationId)
        .eq('provider', 'openrouter')
        .maybeSingle();

      const mergedMetadata = {
        ...(existing?.metadata || {}),
        last_error: userMessage,
        last_error_at: new Date().toISOString(),
        last_error_code: status,
        health_status: 'blocked',
        health_reason: isCreditBlock ? 'insufficient_credits' : 'key_spending_limit',
        health_checked_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from('api_keys')
        .update({
          is_valid: false,
          last_validated: new Date().toISOString(),
          metadata: mergedMetadata,
        })
        .eq('organization_id', organizationId)
        .eq('provider', 'openrouter');

      if (updateError) {
        console.error('[openrouter-credits] Failed to flag api_keys row as invalid:', updateError);
      } else {
        console.log(`[openrouter-credits] Flagged OpenRouter key for org ${organizationId} as blocked (HTTP ${status})`);
      }
    } catch (err) {
      console.error('[openrouter-credits] Unexpected error while flagging api_keys row:', err);
    }
  }

  return userMessage;
}

// Backwards-compatible 402-only entry point used by existing generation paths.
export async function handleOpenRouterCreditsError(
  supabase: any,
  organizationId: string | null | undefined,
  status: number,
  errorBody: string,
): Promise<string | null> {
  return status === 402
    ? handleOpenRouterKeyBlock(supabase, organizationId, status, errorBody)
    : null;
}

/** Clear a previous billing/key-limit block after a successful provider call. */
export async function markOpenRouterKeyHealthy(
  supabase: any,
  organizationId: string | null | undefined,
): Promise<void> {
  if (!organizationId) return;
  try {
    const { data: existing } = await supabase
      .from('api_keys')
      .select('id, is_valid, metadata')
      .eq('organization_id', organizationId)
      .eq('provider', 'openrouter')
      .maybeSingle();
    if (!existing) return;

    const metadata = existing.metadata || {};
    if (existing.is_valid !== false && metadata.health_status !== 'blocked') return;

    const { error } = await supabase
      .from('api_keys')
      .update({
        is_valid: true,
        last_validated: new Date().toISOString(),
        metadata: {
          ...metadata,
          health_status: 'healthy',
          health_reason: null,
          health_checked_at: new Date().toISOString(),
          last_error: null,
          last_error_at: null,
          last_error_code: null,
        },
      })
      .eq('id', existing.id);
    if (error) console.error('[openrouter-credits] Failed to clear key health:', error);
  } catch (error) {
    console.error('[openrouter-credits] Unexpected error while clearing key health:', error);
  }
}

/**
 * Convenience: returns true if the response is a 402 credit error, after
 * handling the side effect. Caller should `throw` the returned message.
 */
export async function isOpenRouterCreditsError(
  supabase: any,
  organizationId: string | null | undefined,
  response: Response,
): Promise<{ isCreditError: boolean; message: string | null; errorBody: string }> {
  const errorBody = await response.text();
  const message = await handleOpenRouterCreditsError(supabase, organizationId, response.status, errorBody);
  return {
    isCreditError: response.status === 402,
    message,
    errorBody,
  };
}
