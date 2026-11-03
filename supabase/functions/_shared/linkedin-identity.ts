/** LinkedIn page identity is scoped to a connected member, never an ACA org ID. */
export class LinkedInIdentityError extends Error {
  constructor(message: string, public readonly status = 403) {
    super(message);
  }
}

export interface LinkedInPage { id: string; name: string }
interface ProfileClient {
  users: { getOwnProfile(accountId: string): Promise<unknown> };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createLinkedInDestination(accountId: string, organizationId?: string): string {
  if (!UUID.test(accountId) || (organizationId !== undefined && !/^\d+$/.test(organizationId))) {
    throw new LinkedInIdentityError('Invalid LinkedIn publishing identity', 400);
  }
  return `unipile:${accountId}:${organizationId ?? 'profile'}`;
}

export function parseLinkedInDestination(id: string): { accountId: string; organizationId?: string } | null {
  if (!id.startsWith('unipile:')) return null;
  const parts = id.split(':');
  if (parts.length !== 3 || !UUID.test(parts[1]) || (parts[2] !== 'profile' && !/^\d+$/.test(parts[2]))) {
    throw new LinkedInIdentityError('Invalid LinkedIn publishing identity', 400);
  }
  return { accountId: parts[1], ...(parts[2] === 'profile' ? {} : { organizationId: parts[2] }) };
}

export async function getLinkedInManagedPages(client: ProfileClient, accountId: string): Promise<LinkedInPage[]> {
  const profile = await client.users.getOwnProfile(accountId) as { provider?: string; organizations?: unknown[] };
  if (profile.provider !== 'LINKEDIN') {
    throw new LinkedInIdentityError('Company pages require a connected LinkedIn account', 400);
  }
  const pages = new Map<string, LinkedInPage>();
  for (const entry of profile.organizations ?? []) {
    const page = entry as { id?: unknown; name?: unknown };
    const id = typeof page.id === 'number' ? String(page.id) : page.id;
    if (typeof id === 'string' && /^\d+$/.test(id) && typeof page.name === 'string') {
      pages.set(id, { id, name: page.name });
    }
  }
  return [...pages.values()];
}

/** Fresh check prevents a cached page selection from acting after access is revoked. */
export async function assertLinkedInPageAccess(client: ProfileClient, accountId: string, organizationId: string): Promise<void> {
  if (typeof organizationId !== 'string' || !/^\d+$/.test(organizationId)) {
    throw new LinkedInIdentityError('Invalid LinkedIn company page ID', 400);
  }
  const pages = await getLinkedInManagedPages(client, accountId);
  if (!pages.some(page => page.id === organizationId)) {
    throw new LinkedInIdentityError('This connected LinkedIn account no longer has access to the selected company page');
  }
}
