/**
 * Upsert a LinkedIn engager into crm_contacts (+ identity) and add them to a
 * lead list. Extracted from linkedin-post-import; behavior unchanged except
 * callers can stamp extra keys into lead_list_members.source_data.
 *
 * Dedup: crm_contact_identities (org, linkedin, platform_user_id) →
 * crm_contacts.primary_linkedin_url fallback → lead_list_members
 * select-before-insert (backed by UNIQUE(list_id, contact_id)).
 */

import { splitDisplayName } from './display-name.ts';

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function processUser(
  supabase: SupabaseClient,
  organizationId: string,
  listId: string,
  user: Record<string, unknown>,
  source: string,
  sourceData: Record<string, unknown> = {},
  logPrefix = '[LinkedIn Engagement]',
): Promise<'imported' | 'skipped'> {
  console.log(`${logPrefix} Processing user:`, JSON.stringify(user).substring(0, 500));

  const providerId = (user.provider_id || user.id || user.public_identifier || user.urn) as string;

  if (!providerId) {
    console.log(`${logPrefix} No providerId found, skipping`);
    return 'skipped';
  }

  const providedFirst = (user.first_name || user.firstName) as string | undefined;
  const providedLast = (user.last_name || user.lastName) as string | undefined;
  const displayName = (
    user.name ||
    user.display_name ||
    user.full_name ||
    (providedFirst && providedLast ? `${providedFirst} ${providedLast}` : null) ||
    providedFirst ||
    'Unknown'
  ) as string;

  // Reaction/comment payloads ship a decorated display string and no name pair,
  // which used to leave first_name NULL and break {{first_name}} downstream.
  // Provider-supplied names stay authoritative; the split is only a fallback.
  const derived = splitDisplayName(displayName);
  const firstName = providedFirst || derived.firstName || undefined;
  const lastName = providedLast || derived.lastName || undefined;

  const headline = (user.headline || user.title || user.occupation) as string | undefined;
  const company = (
    user.company ||
    user.company_name ||
    (user.current_company as Record<string, unknown>)?.name
  ) as string | undefined;
  const avatarUrl = (
    user.avatar_url ||
    user.profile_picture_url ||
    user.picture_url ||
    user.image_url
  ) as string | undefined;
  const profileUrl = (
    user.profile_url ||
    user.public_profile_url ||
    user.linkedin_url ||
    (user.public_identifier ? `https://www.linkedin.com/in/${user.public_identifier}` : null)
  ) as string | undefined;

  console.log(`${logPrefix} Extracted: name=${displayName}, headline=${headline}, profileUrl=${profileUrl}`);

  // Check if contact exists - first by identity platform_user_id, then by LinkedIn URL
  let existingContact: { id: string; first_name?: string | null; last_name?: string | null } | null = null;

  const { data: existingIdentity } = await supabase
    .from('crm_contact_identities')
    .select('contact_id')
    .eq('organization_id', organizationId)
    .eq('channel', 'linkedin')
    .eq('platform_user_id', providerId)
    .single();

  if (existingIdentity) {
    const { data: contactById } = await supabase
      .from('crm_contacts')
      .select('id, first_name, last_name')
      .eq('id', existingIdentity.contact_id)
      .single();
    existingContact = contactById || { id: existingIdentity.contact_id };
  } else if (profileUrl) {
    const { data: contactByUrl } = await supabase
      .from('crm_contacts')
      .select('id, first_name, last_name')
      .eq('organization_id', organizationId)
      .eq('primary_linkedin_url', profileUrl)
      .single();
    existingContact = contactByUrl;
  }

  let contactId: string;

  if (existingContact) {
    contactId = existingContact.id;

    // A stored name may have come from enrichment, which is better than a split
    // off a decorated display string — only fill the gap, never overwrite.
    const nameFill: Record<string, string> = {};
    if (firstName && !existingContact.first_name) nameFill.first_name = firstName;
    if (lastName && !existingContact.last_name) nameFill.last_name = lastName;

    await supabase
      .from('crm_contacts')
      .update({
        display_name: displayName,
        ...nameFill,
        job_title: headline,
        company: company,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

  } else {
    const { data: newContact, error: contactError } = await supabase
      .from('crm_contacts')
      .insert({
        organization_id: organizationId,
        display_name: displayName,
        first_name: firstName,
        last_name: lastName,
        job_title: headline,
        company: company,
        avatar_url: avatarUrl,
        primary_linkedin_url: profileUrl,
        source: source,
        status: 'active',
      })
      .select('id')
      .single();

    if (contactError || !newContact) {
      throw new Error(`Failed to create contact: ${contactError?.message}`);
    }

    contactId = newContact.id;

    const { error: identityError } = await supabase.from('crm_contact_identities').insert({
      organization_id: organizationId,
      contact_id: contactId,
      channel: 'linkedin',
      platform_user_id: providerId,
      platform_username: displayName,
      platform_profile_url: profileUrl,
      platform_avatar_url: avatarUrl,
      is_primary: true,
    });

    if (identityError) {
      console.error(`${logPrefix} Failed to create identity for ${providerId}:`, identityError.message);
    }
  }

  // Check if contact is already in this list
  const { data: existingMember } = await supabase
    .from('lead_list_members')
    .select('id')
    .eq('list_id', listId)
    .eq('contact_id', contactId)
    .single();

  if (existingMember) {
    return 'skipped';
  }

  const { error: listError } = await supabase.from('lead_list_members').insert({
    list_id: listId,
    contact_id: contactId,
    source_data: {
      import_type: source,
      imported_at: new Date().toISOString(),
      is_new_contact: !existingContact,
      ...sourceData,
    },
  });

  if (listError) {
    console.error(`${logPrefix} Failed to add to list: ${listError.message}`);
    return 'skipped';
  }

  return 'imported';
}

/**
 * Decrypt an AES-GCM encrypted Unipile access token (hex key, iv-prefixed).
 * Same implementation the importer used inline.
 */
export async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);

  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}
