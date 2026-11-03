const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveZapmailSyncScope(body: unknown, isService: boolean, callerOrg: string | null):
  { organizationId: string | null; mailboxIds: string[]; limit: number } | { error: string; status: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request body', status: 400 };
  const request = body as Record<string, unknown>;
  const org = request.organization_id ?? null;
  if (org !== null && (typeof org !== 'string' || !UUID.test(org))) return { error: 'Invalid organization_id', status: 400 };
  if (!isService && (!callerOrg || (org && org !== callerOrg))) return { error: 'Forbidden', status: 403 };
  const ids = request.mailbox_ids ?? [];
  if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string' || !UUID.test(id))) {
    return { error: 'mailbox_ids must contain at most 50 UUIDs', status: 400 };
  }
  const limit = request.limit ?? 100;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200) return { error: 'limit must be between 1 and 200', status: 400 };
  return { organizationId: isService ? org : callerOrg, mailboxIds: [...new Set(ids)] as string[], limit };
}

export function isZapmailSyncable(mailbox: {
  status: string;
  connection_type: string | null;
  zapmail_mailbox_id?: string | null;
  zapmail_api_key_id?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  const hasIdentifier = [mailbox.zapmail_mailbox_id, mailbox.zapmail_api_key_id, mailbox.metadata?.zapmail_workspace_id]
    .some(id => typeof id === 'string' && id.trim().length > 0);
  return (mailbox.connection_type === 'zapmail' || (mailbox.connection_type === null && hasIdentifier)) &&
    ['ready', 'warming', 'pending', 'disconnected'].includes(mailbox.status) && !mailbox.metadata?.paused_reason;
}

/** Never use an unscoped list to decide whether a workspace mailbox disappeared. */
export function zapmailWorkspaceIds(metadata: Record<string, unknown> | null, keyWorkspaces: string[]): string[] {
  const saved = metadata?.zapmail_workspace_id;
  if (typeof saved === 'string' && saved) return [saved];
  return [...new Set(keyWorkspaces.filter(id => typeof id === 'string' && !!id))];
}

export async function verifyZapmailRecovery<T>(
  providerStatus: string,
  getCredentials: () => Promise<T | null>,
  testSmtp: (creds: T) => Promise<{ success: boolean; error?: string }>,
  testImap: (creds: T) => Promise<{ success: boolean; error?: string }>,
): Promise<{ success: boolean; smtp_ok: boolean; imap_ok: boolean; error?: string }> {
  if (providerStatus !== 'ACTIVE') {
    return { success: false, smtp_ok: false, imap_ok: false, error: `ZapMail status is ${providerStatus}, not ACTIVE` };
  }
  const creds = await getCredentials();
  if (!creds) return { success: false, smtp_ok: false, imap_ok: false, error: 'No stored SMTP/IMAP credentials' };
  const smtp = await testSmtp(creds);
  if (!smtp.success) return { success: false, smtp_ok: false, imap_ok: false, error: `SMTP: ${smtp.error || 'failed'}` };
  const imap = await testImap(creds);
  return { success: imap.success, smtp_ok: true, imap_ok: imap.success, ...(imap.success ? {} : { error: `IMAP: ${imap.error || 'failed'}` }) };
}
