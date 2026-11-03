/** The receiving account stays attached to its channel across later graph actions. */
export function campaignEntrySender(lead: { entry_context?: unknown }, channel?: string | null): string | null {
  const entry = lead.entry_context;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const context = entry as Record<string, unknown>;
  return context.native === true && context.channel === channel && typeof context.account_id === 'string' ? context.account_id : null;
}

export function skipEntryConnectionRequest(lead: { entry_context?: unknown; connection_accepted_at?: string | null }, nodeType: string): boolean {
  return nodeType === 'connectionRequest' && !!lead.connection_accepted_at && !!campaignEntrySender(lead, 'linkedin');
}
