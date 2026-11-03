import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { DEFAULT_FAST_TEXT_MODEL, DEFAULT_CHATBOT_MODEL } from '../_shared/default-models.ts';
import { sendThreadedReply } from '../_shared/threaded-send.ts';
import { upsertPublicSignal, PushValidationError, type PushSignalInput } from '../_shared/public-signals.ts';
import { selectInChunks } from '../_shared/chunked-query.ts';
import { CONTACT_CHECKS, isContactCheck, ROUTE_CHANNELS, ROUTE_NONE, routeChannels } from '../_shared/contact-checks.ts';
import { findLeadsActiveInOtherSequences, findSuppressedLeadIds } from '../_shared/enrollment-guards.ts';
import { insertContactsBulk, type BulkContactInput } from '../_shared/bulk-contacts.ts';
import { addContactsToList as addContactsToListShared } from '../_shared/list-members.ts';
import { mergeAgentAnalysis, withDraftPoints } from '../_shared/idea-guidelines.ts';
import { calculateNextRun, type AutopilotSchedule, type ScheduleSlot } from '../_shared/autopilot-schedule.ts';
import { poolQueryWorkerUrl } from "../_shared/site-config.ts";

// Carousel themes the template renderer draws (workers/carousel-renderer/src/carousel-themes.ts).
const CAROUSEL_THEMES = ["creator", "editorial", "noir", "halftone", "brutalist", "spotlight"];
// Old template ids: still accepted, the renderer maps each to the nearest theme.
const LEGACY_CAROUSEL_TEMPLATES = [
  "classic", "minimal_grid", "soft_wave", "midnight", "neon_frame", "gradient_orbs", "ink_blot", "duotone",
  "mesh", "geometric", "split_screen", "corner_accent", "magazine", "photo_frame", "poster",
];

// ============================================================================
// Types
// ============================================================================

interface AuthContext {
  organizationId: string;
  effectiveOrgId: string; // The actual org to use (may be switched via session)
  userId: string;
  apiKeyId: string;
  permissions: string[];
  isAgency: boolean;
  targetOrganizationId: string | null;
}

interface McpRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ============================================================================
// CORS Headers
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-target-organization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

// ============================================================================
// Crypto Helpers for AWS Signature V4
// ============================================================================

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
  const signatureBuffer = await hmacSha256(key, data);
  return Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Credential Decryption
// ============================================================================

async function decryptCredentials(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  // Check if it's the legacy hex:colons format (contains exactly 2 colons)
  const parts = encryptedData.split(':');
  if (parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p))) {
    // Legacy format: ivHex:authTagHex:encryptedHex
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const authTag = new Uint8Array(authTagHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const encrypted = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      new Uint8Array([...encrypted, ...authTag])
    );

    return new TextDecoder().decode(decrypted);
  }

  // New format: Base64 encoded (IV + ciphertext combined)
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

// ============================================================================
// Storage Upload Helpers
// ============================================================================

async function uploadToCloudflareR2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  contentType: string
): Promise<string> {
  const accountId = parsedCreds.accountId;
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const accessKeyId = parsedCreds.accessKeyId;
  const secretAccessKey = parsedCreds.secretAccessKey;

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    throw new Error(`Missing R2 credentials`);
  }

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucketName}/${path}`;
  const region = 'auto';
  const service = 's3';
  const method = 'PUT';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const encoder = new TextEncoder();
  const payloadBytes = new Uint8Array(await data.arrayBuffer());
  const payloadHash = await sha256Hex(payloadBytes);

  const canonicalUri = `/${bucketName}/${path}`;
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(encoder.encode(canonicalRequest));
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: data,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`R2 upload failed: ${response.status} - ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

async function uploadToBackblazeB2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  contentType: string
): Promise<string> {
  const keyId = parsedCreds.keyId;
  const applicationKey = parsedCreds.applicationKey;
  const bucketId = parsedCreds.bucketId;

  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      'Authorization': `Basic ${btoa(`${keyId}:${applicationKey}`)}`,
    },
  });
  const authData = await authResponse.json();

  const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      'Authorization': authData.authorizationToken,
    },
    body: JSON.stringify({ bucketId }),
  });
  const uploadUrlData = await uploadUrlResponse.json();

  const uploadResponse = await fetch(uploadUrlData.uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': uploadUrlData.authorizationToken,
      'Content-Type': contentType,
      'X-Bz-File-Name': encodeURIComponent(path),
      'X-Bz-Content-Sha1': 'do_not_verify',
    },
    body: data,
  });

  if (!uploadResponse.ok) {
    throw new Error(`B2 upload failed: ${uploadResponse.statusText}`);
  }

  const uploadData = await uploadResponse.json();
  return credentials.public_url ? `${credentials.public_url}/${path}` : uploadData.fileUrl;
}

async function uploadToAwsS3(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  contentType: string
): Promise<string> {
  const accessKeyId = parsedCreds.accessKeyId;
  const secretAccessKey = parsedCreds.secretAccessKey;
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const region = parsedCreds.region || 'us-east-1';

  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${path}`;
  const service = 's3';
  const method = 'PUT';
  const acl = 'public-read';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const encoder = new TextEncoder();
  const payloadBytes = new Uint8Array(await data.arrayBuffer());
  const payloadHash = await sha256Hex(payloadBytes);

  const canonicalUri = `/${path}`;
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-acl:${acl}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-acl;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(encoder.encode(canonicalRequest));
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-acl': acl,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: data,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`S3 upload failed: ${response.status} - ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

// Upload an image from a URL to organization storage
async function uploadImageToOrgStorage(
  supabase: SupabaseClient,
  organizationId: string,
  imageUrl: string,
  prefix: string = 'character-images'
): Promise<string> {
  // Get organization's storage credentials
  const { data: credentials } = await supabase
    .from('storage_credentials')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .single();

  if (!credentials) {
    console.warn(`[MCP WARNING] No storage credentials for org ${organizationId}, keeping original URL (may expire)`);
    return imageUrl; // Return original URL if no storage configured
  }

  // Decrypt credentials
  let parsedCreds: any;
  try {
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      console.warn('[MCP WARNING] ENCRYPTION_KEY not configured, keeping original URL (may expire)');
      return imageUrl;
    }

    const credValue = credentials.credentials_encrypted;
    if (credValue.includes(':') && !credValue.startsWith('{')) {
      // Legacy format: ivHex:authTagHex:encryptedHex
      const decryptedJson = await decryptCredentials(credValue, encryptionKey);
      parsedCreds = JSON.parse(decryptedJson);
    } else {
      // New format: Base64 encoded
      const decryptedJson = await decryptCredentials(credValue, encryptionKey);
      parsedCreds = JSON.parse(decryptedJson);
    }
  } catch (e) {
    console.error('[MCP] Failed to decrypt storage credentials for org', organizationId);
    return imageUrl;
  }

  // Download the image
  console.log(`[MCP] Downloading image from: ${imageUrl}`);
  const response = await fetch(imageUrl);
  if (!response.ok) {
    console.warn(`[MCP WARNING] Failed to download image from ${imageUrl}: ${response.statusText}, keeping original URL`);
    return imageUrl;
  }
  const fileBlob = await response.blob();
  const contentType = response.headers.get('content-type') || 'image/png';

  // Generate storage path
  const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' :
                   contentType.includes('webp') ? 'webp' : 'png';
  const filename = `${crypto.randomUUID()}.${extension}`;
  const storagePath = `${prefix}/${organizationId}/${filename}`;

  // Upload to appropriate storage provider
  let publicUrl: string;
  try {
    if (credentials.provider === 'cloudflare_r2') {
      publicUrl = await uploadToCloudflareR2(credentials, parsedCreds, storagePath, fileBlob, contentType);
    } else if (credentials.provider === 'backblaze_b2') {
      publicUrl = await uploadToBackblazeB2(credentials, parsedCreds, storagePath, fileBlob, contentType);
    } else if (credentials.provider === 'aws_s3') {
      publicUrl = await uploadToAwsS3(credentials, parsedCreds, storagePath, fileBlob, contentType);
    } else {
      console.warn(`[MCP WARNING] Unsupported storage provider: ${credentials.provider}, keeping original URL`);
      return imageUrl;
    }

    console.log(`[MCP] Uploaded to ${credentials.provider}: ${publicUrl}`);
    return publicUrl;
  } catch (e) {
    console.warn(`[MCP WARNING] Storage upload failed for org ${organizationId}:`, e);
    return imageUrl; // Return original URL on failure
  }
}

// ============================================================================
// Authentication
// ============================================================================

async function validateApiKey(
  supabase: SupabaseClient,
  apiKey: string,
  targetOrgHeader?: string | null
): Promise<AuthContext | null> {
  // 1. Check prefix
  if (!apiKey.startsWith("cf_live_") && !apiKey.startsWith("cf_test_")) {
    console.log("[MCP Auth] Invalid key prefix");
    return null;
  }

  // 2. Hash the key using SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // 3. Look up in database
  const { data: keyRecord, error } = await supabase
    .from("api_access_keys")
    .select(`
      id,
      organization_id,
      user_id,
      permissions,
      is_active,
      expires_at,
      target_organization_id
    `)
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .single();

  if (error || !keyRecord) {
    console.log("[MCP Auth] Key not found or inactive");
    return null;
  }

  // 4. Check expiration
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    console.log("[MCP Auth] Key expired");
    return null;
  }

  // 5. Determine target organization
  // Priority: 1) X-Target-Organization header, 2) key's target_organization_id, 3) key owner's org
  let effectiveOrgId = keyRecord.organization_id;
  let targetOrganizationId: string | null = null;

  // Check if key has a pre-configured target org (agency created for client)
  if (keyRecord.target_organization_id) {
    effectiveOrgId = keyRecord.target_organization_id;
    targetOrganizationId = keyRecord.target_organization_id;
  }

  // Header can override (for agency users with multiple clients)
  if (targetOrgHeader) {
    // Validate that the user has access to this organization
    const hasAccess = await validateOrgAccess(supabase, keyRecord.user_id, targetOrgHeader);
    if (hasAccess) {
      effectiveOrgId = targetOrgHeader;
      targetOrganizationId = targetOrgHeader;
    } else {
      console.log("[MCP Auth] User doesn't have access to target org");
      return null;
    }
  }

  // 6. Check if user is agency (for context)
  const { data: userOrg } = await supabase
    .from("organizations")
    .select("type")
    .eq("id", keyRecord.organization_id)
    .single();

  const isAgency = userOrg?.type === "agency";

  // 7. Check for persisted session override (switch_organization)
  const { data: sessionState } = await supabase
    .from("mcp_session_state")
    .select("active_organization_id")
    .eq("api_key_id", keyRecord.id)
    .single();

  // Re-validate the persisted override on every request: access can be revoked after
  // switch_organization ran, and a stale row must not keep granting that org.
  let sessionOrgId: string | null = sessionState?.active_organization_id || null;
  if (sessionOrgId && sessionOrgId !== keyRecord.organization_id &&
      !(await validateOrgAccess(supabase, keyRecord.user_id, sessionOrgId))) {
    await supabase.from("mcp_session_state").delete().eq("api_key_id", keyRecord.id);
    sessionOrgId = null;
  }

  // Use session override if present, otherwise use the effective org from key/header
  const finalEffectiveOrgId = sessionOrgId || effectiveOrgId;

  // 8. Update last_used_at
  await supabase
    .from("api_access_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRecord.id);

  return {
    organizationId: effectiveOrgId, // Original org (without session override)
    effectiveOrgId: finalEffectiveOrgId, // Actual org to use (with session override)
    userId: keyRecord.user_id,
    apiKeyId: keyRecord.id,
    permissions: keyRecord.permissions || ["admin:*"], // Default to full access
    isAgency,
    targetOrganizationId,
  };
}

async function validateOrgAccess(
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<boolean> {
  // Check if user is a member of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .single();

  if (membership) return true;

  // Check if user's org is the parent (agency -> client relationship)
  const { data: userData } = await supabase
    .from("users")
    .select("organization_id")
    .eq("id", userId)
    .single();

  if (userData?.organization_id) {
    const { data: targetOrg } = await supabase
      .from("organizations")
      .select("parent_id")
      .eq("id", orgId)
      .single();

    if (targetOrg?.parent_id === userData.organization_id) {
      return true;
    }
  }

  // Check can_access_organizations array
  const { data: accessData } = await supabase
    .from("users")
    .select("can_access_organizations")
    .eq("id", userId)
    .single();

  if (accessData?.can_access_organizations?.includes(orgId)) {
    return true;
  }

  return false;
}

// Get all organizations the user can access
async function listAccessibleOrganizations(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const accessibleOrgs: Array<{
    id: string;
    name: string;
    type: string;
    is_current: boolean;
    access_type: string;
  }> = [];

  // 1. Get user's own organization (the API key owner's org)
  const { data: apiKeyData } = await supabase
    .from("api_access_keys")
    .select("organization_id, user_id")
    .eq("id", ctx.apiKeyId)
    .single();

  if (!apiKeyData) {
    return { organizations: [], current_organization_id: ctx.organizationId };
  }

  const ownOrgId = apiKeyData.organization_id;

  // Get the owner org details
  const { data: ownOrg } = await supabase
    .from("organizations")
    .select("id, name, type")
    .eq("id", ownOrgId)
    .single();

  if (ownOrg) {
    accessibleOrgs.push({
      id: ownOrg.id,
      name: ownOrg.name,
      type: ownOrg.type,
      is_current: ownOrg.id === ctx.organizationId,
      access_type: "owner",
    });
  }

  // 2. Get organizations where user is a member (direct membership)
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, organizations(id, name, type)")
    .eq("user_id", apiKeyData.user_id);

  if (memberships) {
    for (const membership of memberships) {
      const org = membership.organizations as { id: string; name: string; type: string } | null;
      if (org && !accessibleOrgs.find(o => o.id === org.id)) {
        accessibleOrgs.push({
          id: org.id,
          name: org.name,
          type: org.type,
          is_current: org.id === ctx.organizationId,
          access_type: "member",
        });
      }
    }
  }

  // 3. Get child organizations (agency -> client relationship)
  const { data: childOrgs } = await supabase
    .from("organizations")
    .select("id, name, type")
    .eq("parent_id", ownOrgId);

  if (childOrgs) {
    for (const org of childOrgs) {
      if (!accessibleOrgs.find(o => o.id === org.id)) {
        accessibleOrgs.push({
          id: org.id,
          name: org.name,
          type: org.type,
          is_current: org.id === ctx.organizationId,
          access_type: "client",
        });
      }
    }
  }

  // 4. Get organizations from can_access_organizations array
  const { data: userData } = await supabase
    .from("users")
    .select("can_access_organizations")
    .eq("id", apiKeyData.user_id)
    .single();

  if (userData?.can_access_organizations?.length > 0) {
    const { data: additionalOrgs } = await supabase
      .from("organizations")
      .select("id, name, type")
      .in("id", userData.can_access_organizations);

    if (additionalOrgs) {
      for (const org of additionalOrgs) {
        if (!accessibleOrgs.find(o => o.id === org.id)) {
          accessibleOrgs.push({
            id: org.id,
            name: org.name,
            type: org.type,
            is_current: org.id === ctx.organizationId,
            access_type: "granted",
          });
        }
      }
    }
  }

  return {
    organizations: accessibleOrgs,
    current_organization_id: getEffectiveOrgId(ctx),
    is_agency: ctx.isAgency,
    note: "Use the switch_organization tool to change context to a different organization. After switching, all subsequent tool calls will operate on the switched organization's data.",
  };
}

async function switchOrganization(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { organization_id } = params;

  if (!organization_id || typeof organization_id !== "string") {
    throw new Error("organization_id is required");
  }

  // Get the list of accessible organizations to validate access
  const accessibleOrgsResult = await listAccessibleOrganizations(supabase, ctx);
  const accessibleOrgs = (accessibleOrgsResult as { organizations: Array<{ id: string; name: string; type: string }> }).organizations;

  const targetOrg = accessibleOrgs.find((org) => org.id === organization_id);

  if (!targetOrg) {
    throw new Error(`Access denied: You don't have access to organization ${organization_id}. Use list_accessible_organizations to see available organizations.`);
  }

  // Persist the session state in the database (upsert)
  const { error: sessionError } = await supabase
    .from("mcp_session_state")
    .upsert({
      api_key_id: ctx.apiKeyId,
      active_organization_id: organization_id,
      switched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "api_key_id",
    });

  if (sessionError) {
    console.error("[MCP] Failed to switch organization:", sessionError.message);
    throw new Error("Failed to switch organization");
  }

  // Update context for current request (important if more tools are called after switch)
  ctx.effectiveOrgId = organization_id;

  return {
    success: true,
    switched_to: {
      id: targetOrg.id,
      name: targetOrg.name,
      type: targetOrg.type,
    },
    message: `Successfully switched to ${targetOrg.name}. All subsequent tool calls will now operate on this organization's data.`,
  };
}

// Helper to get effective organization ID (uses pre-loaded value from context)
function getEffectiveOrgId(ctx: AuthContext): string {
  return ctx.effectiveOrgId;
}

// ============================================================================
// MCP Tool Handlers
// ============================================================================

// Help & Documentation
function getHelp(params: Record<string, unknown>): unknown {
  const topic = (params.topic as string) || "overview";

  const helpTopics: Record<string, string> = {
    overview: `
# ACA MCP - Overview

Welcome! This MCP (Model Context Protocol) server lets you manage your ACA account directly from Claude.

## Quick Start
1. **Check your context**: Use \`list_accessible_organizations\` to see which organizations you can access
2. **Switch organization** (for agencies): Use \`switch_organization\` to work on a client's data
3. **Explore your library**: Use \`list_brand_voices\`, \`list_products\`, \`list_icps\` to see your assets

## Main Capabilities

### 📚 Library Management
- **Brand Voices**: Your brand's tone, style, and visual identity
- **Products**: Products/services you're creating content for
- **ICPs** (Ideal Customer Profiles): Target audience definitions
- **Characters**: AI personas for content creation

### 💡 Ideas Management
- Save and organize content ideas
- Tag and categorize for later use
- Ideas are NOT generated content - they're topics to develop

### 🎬 Content Generation
- **Blueprints**: Templates that define how content is generated
- **Trigger generation**: Start automated content creation pipelines
- Supports: articles, social posts, images, videos, and more

### 🏢 Organization Management (Agencies)
- Switch between your agency and client accounts
- All data is isolated per organization

### 🔍 LinkedIn Lead Import
- Search and import leads from LinkedIn, Sales Navigator, and Recruiter
- Build search URLs or use keyword-based parameter search
- Track import progress and manage import jobs

### 🚀 Outreach Campaigns
- Create multi-channel outreach sequences (LinkedIn, email, WhatsApp, etc.)
- Automated connection requests, messages, follow-ups with branching
- AI-powered message personalization

### 🤖 Content Autopilots
- Automatically generate and publish content on a schedule
- Configure content mix with weighted blueprints and tag-based idea pools
- Publish to GHL social media accounts and WordPress sites
- Evergreen recycling for high-performing content

Use \`get_help\` with topics: "ideas", "library", "content_generation", "blueprints", "organizations", "campaigns", "autopilots", "linkedin_import", or "all"
`,

    ideas: `
# Ideas Management

Ideas are content topics you save for later development. They are NOT generated content.

## Tools

### list_ideas
List your saved content ideas. Returns titles, keywords, and metadata.
- \`search\`: Filter by title text
- \`limit\`: Max results (default 20)
- \`include_analysis\`: Include AI analysis (large response)

### get_idea
Get full details of a single idea, including AI analysis.
- \`idea_id\`: The idea UUID (required)

### create_idea
💡 Save a new content topic/idea. Does NOT generate content!
- \`title\`: Short idea title (required)
- \`keywords\`: Array of keywords/tags
- \`brand_voice_id\`: Link to a brand voice
- \`product_id\`: Link to a product
- \`tag_ids\`: Array of tag UUIDs

### bulk_create_ideas
Save multiple ideas at once (max 100). Each idea can include brand_voice_id, product_id, and rich content details.
- \`ideas\`: Array of {title, keywords, emotional_triggers, content_framework, brand_voice_id, product_id, tag_ids}

### update_idea / delete_ideas
Modify or remove existing ideas.

## Tags
- \`list_tags\`: View all tags
- \`create_tag\`: Create a new tag
- \`assign_tags\`: Assign tags to an idea
`,

    library: `
# Library Assets

Your library contains reusable assets for content creation.

## Brand Voices 🎨
Define your brand's personality, tone, and visual style.

### Tools
- \`list_brand_voices\`: List all brand voices
- \`get_brand_voice\`: Get full details including visual identity
- \`create_brand_voice\`: Create new brand voice
  - \`name\`: Brand voice name (required)
  - \`description\`: What this voice represents
  - \`tone\`: Communication tone (e.g., "professional", "casual")
  - \`style_guidelines\`: Writing style rules
  - \`mood_keywords\`: Array of mood descriptors
- \`update_brand_voice\`: Modify existing voice
- \`delete_brand_voices\`: Remove brand voices

## Products 📦
Products or services you're creating content about.

### Tools
- \`list_products\`: List all products
- \`get_product\`: Get product details
- \`create_product\`: Create new product
  - \`name\`: Product name (required)
  - \`description\`: Product description
  - \`features\`: Array of feature strings
  - \`key_benefits\`: Array of benefits
  - \`category\`: Product category
- \`update_product\` / \`delete_products\`

## ICPs (Ideal Customer Profiles) 👥
Target audience definitions for personalized content.

### Tools
- \`list_icps\`: List all ICPs
- \`create_icp\`: Create new ICP
  - \`name\`: ICP name (required)
  - \`description\`: Who this person is
  - \`pain_points\`: Array of problems they face
  - \`desires\`: Array of goals/wants
  - \`objections\`: Common objections
  - \`language_style\`: How they communicate
- \`update_icp\` / \`delete_icps\`

## Characters 🎭
AI personas that can be used in content generation.

- \`list_characters\`: List all characters
- \`get_character\`: Get character details
- \`create_character\` / \`update_character\` / \`delete_characters\`
`,

    content_generation: `
# Content Generation

Generate actual content using your library assets and blueprints.

## Key Concept
Content generation uses:
1. **Blueprint**: Template defining the content structure and prompts
2. **Brand Voice**: Style and tone settings
3. **Product**: What you're promoting (optional)
4. **ICP**: Target audience (optional)

## Quick Carousel: create_carousel

Generate a carousel from a short idea using an existing blueprint:
- \`idea\`: Short topic (required) — e.g. "5 tips for better sleep"
- \`blueprint_id\`: Carousel blueprint to use (optional, auto-finds one)
- \`brand_voice_id\`: Brand voice for styling/tone
- \`talking_points\`: Key points to cover across slides (string array)
- \`slide_count\`: Number of slides (3-10, defaults to the blueprint's)
- \`template\`: Visual theme override: creator, editorial, noir, halftone, brutalist, spotlight
- \`aspect_ratio\`: portrait (4:5) or square; defaults to the blueprint's shape
- \`custom_instructions\`: Extra prompt guidance
- \`auto_approve\`: Auto-process all stages (default true)
- \`publish_to_ghl\`: GHL account IDs to publish to after generation

## Full Control: trigger_content_generation

Start a content generation job with a blueprint:
- \`blueprint_id\`: Which blueprint to use (required)
- \`pipeline\`: Content type (instagram_carousel, social_media_post, rich_article, etc.)
- \`items\`: Array of content items to generate
- \`library_elements\`: Brand voices, products, ICPs, characters, blocks
- \`output_config\`: Format settings (slide_count, template, custom_palette for carousels)
- \`auto_approve\`: Auto-process stages (default false)

## Monitoring Jobs

### list_generation_jobs
See your generation jobs and their status.
- Status: pending, processing, completed, failed

### get_generation_job
Get full details of a job including output.
- \`job_id\`: The job UUID

## Publishing to Social Media (LeadConnector/GHL)

### list_ghl_accounts
Get connected social media accounts (Facebook, Instagram, LinkedIn, TikTok, YouTube, etc.).
Returns account IDs needed for push_to_ghl.

### push_to_ghl
Publish generated content to social media via LeadConnector.
- \`content_output_id\`: UUID of the content output to publish
- \`account_ids\`: Array of GHL account IDs (from list_ghl_accounts)
- \`schedule_date\`: Optional ISO date for scheduled posting
- \`caption\`: Optional caption override
- \`post_type\`: Optional: feed, reel, story, carousel

## Content Blocks 🧱
Reusable content snippets:
- \`list_blocks\`: List hooks, angles, CTAs, story elements
- \`create_block\`: Save a new block
- \`bulk_create_blocks\`: Create multiple blocks
`,

    blueprints: `
# Blueprints

Blueprints are templates that define how content is generated.

## What's in a Blueprint?
- **Master Prompt**: The main AI prompt for generation
- **Image Prompt**: Prompt for image generation (if applicable)
- **Structure**: Content structure definition
- **Model Config**: AI model settings
- **Pipeline**: Which generation pipeline to use

## Tools

### list_blueprints
List available blueprints.
- \`pipeline\`: Filter by pipeline type
- \`is_active\`: Filter active/inactive

### get_blueprint
Get full blueprint details including prompts and config.
- \`blueprint_id\`: Blueprint UUID (required)

### create_blueprint
Create a new blueprint.
- \`name\`: Blueprint name (required)
- \`master_prompt\`: Main generation prompt (required)
- \`description\`: What this blueprint creates
- \`image_prompt\`: Image generation prompt
- \`structure\`: Content structure JSON
- \`pipeline\`: Pipeline type
- \`tags\`: Array of tags

### update_blueprint / delete_blueprint
Modify or remove blueprints.

## Prompt Templates 📝
Reusable prompt snippets:
- \`list_prompt_templates\`: List all templates
- \`get_prompt_template\`: Get template details
- \`create_prompt_template\` / \`update_prompt_template\` / \`delete_prompt_templates\`
`,

    organizations: `
# Organization Management

For agency accounts managing multiple clients.

## Understanding Context
- Your API key belongs to an organization
- By default, all operations use your organization's data
- Agencies can switch to client organizations

## Tools

### list_accessible_organizations
See all organizations you can access:
- Your own organization (owner)
- Organizations where you're a member
- Client organizations (for agencies)

Returns:
- \`id\`: Organization UUID
- \`name\`: Organization name
- \`type\`: "agency" or "client"
- \`is_current\`: Whether this is your active context
- \`access_type\`: owner, member, or client

### switch_organization
Switch your active context to a different organization.
- \`organization_id\`: UUID of org to switch to (required)

After switching:
- All subsequent tool calls operate on that organization's data
- Use \`list_accessible_organizations\` to see current context
- Switch back to your org anytime

## Security
- You can only switch to organizations you have access to
- Client data is isolated - clients can't access agency data
- Each organization has its own library, ideas, and content
`,

    linkedin_import: `
# LinkedIn Lead Import

Import leads from LinkedIn search results directly into your lead lists.

## Typical Workflow

1. **Look up filter IDs**: Use \`search_linkedin_parameters\` to resolve names to IDs
2. **Start import**: Use \`start_linkedin_import\` with keywords + filter IDs
3. **Check progress**: Use \`get_linkedin_import_job\` to monitor

Example: "Import 200 CEOs in San Francisco tech companies"
1. \`search_linkedin_parameters({ parameter_type: "location", keywords: "San Francisco" })\`
2. \`search_linkedin_parameters({ parameter_type: "industry", keywords: "Technology" })\`
3. \`start_linkedin_import({ list_name: "SF Tech CEOs", keywords: "CEO", location_ids: [...], industry_ids: [...], max_leads: 200 })\`
4. \`get_linkedin_import_job({ job_id: "..." })\`

## Tools

### search_linkedin_parameters
Look up LinkedIn filter IDs by keyword. Supported types: location, industry, company, school, skill, function, seniority.
- \`parameter_type\`: Type to search (required)
- \`keywords\`: Search term (required)
- \`account_id\`: LinkedIn account UUID (optional, auto-selects first active)

### build_linkedin_search_url
Construct a LinkedIn search URL from filters. Useful for preview or URL-mode imports.
- \`keywords\`: Search terms (required)
- \`platform\`: "linkedin", "sales_navigator", or "recruiter" (default: linkedin)
- \`geo_urns\`, \`network\`, \`industry_urns\`, \`company_urns\`: Optional filters

### start_linkedin_import
Start a lead import job. Two modes:
- **URL mode**: Pass \`search_url\` — a LinkedIn/Sales Nav/Recruiter search URL
- **Parameter mode**: Pass \`keywords\` + optional \`location_ids\`, \`industry_ids\`, \`company_ids\`, \`network_distance\`
- \`list_name\`: Name for new lead list (or use \`list_id\` for existing)
- \`max_leads\`: 1-2500 (default 100)

### get_linkedin_import_job
Check import progress: status, progress %, leads found/imported/skipped.
- \`job_id\`: UUID from start_linkedin_import (required)

### list_linkedin_import_jobs
List recent import jobs. Filter by status, limit results.

### cancel_linkedin_import
Cancel a pending or running import job.
- \`job_id\`: UUID to cancel (required)
`,

    apify_leads_import: `
## Apify B2B Lead Finder

Import B2B leads with verified emails using Apify Leads Finder (Apollo alternative).

### Workflow
1. **Start import**: Use \`start_apify_leads_import\` with search filters (job title, industry, location, seniority, company size)
2. **Check progress**: Use \`get_apify_leads_import_job\` to monitor batch progress
3. **Cancel if needed**: Use \`cancel_apify_leads_import\`

### Example
1. \`start_apify_leads_import({ list_name: "Cybersecurity CEOs", contact_job_title: ["CEO", "Founder"], company_industry: ["Information Technology & Services"], contact_location: ["United States"], seniority_level: ["c_suite", "founder"], size: ["11-20", "21-50", "51-100"], email_status: ["validated"], fetch_count: 5000 })\`
2. \`get_apify_leads_import_job({ job_id: "..." })\`

### Tools
- \`start_apify_leads_import\` - Start a B2B lead import
- \`get_apify_leads_import_job\` - Check import progress
- \`list_apify_leads_import_jobs\` - List recent imports
- \`cancel_apify_leads_import\` - Cancel a running import
`,

    campaigns: `
# Outreach Campaign Builder

Create automated multi-channel outreach campaigns that execute sequences of actions (connection requests, messages, emails, etc.) against a lead list.

## Quick Start Workflow
1. \`list_lead_lists\` — find a lead list to target
2. \`list_sender_accounts\` — find sender accounts (LinkedIn, email, etc.)
3. \`create_campaign\` — create the campaign with a sequence of steps
4. Open in the UI to review, then \`update_campaign_status\` to activate

## How create_campaign Works
Pass a \`steps\` array using the high-level DSL below. The server:
1. Compiles steps into React Flow nodes/edges
2. Applies auto-layout for clean tree rendering
3. Validates the sequence
4. Inserts as draft

## Campaign Settings
- \`stop_on_reply\`: Stop sequence for a lead when they reply (default: true)
- \`campaign_type\`: "linkedin_only" | "email_only" | "multi_channel"
- \`primary_channel\`: "linkedin" | "email" | "whatsapp" | "instagram" | "telegram"

---

## STEP TYPES

### Terminal
- **end** — Explicitly ends the sequence branch. Auto-added to dangling branches if omitted.

### Control Steps

- **delay** — Wait before next step
  - \`days\`: number (default: 1)
  - \`hours\`: number (default: 0)
  - \`minutes\`: number (default: 0)

- **switch_channel** — Switch communication channel mid-sequence
  - \`target_channel\`: "linkedin" | "email" | "whatsapp" | "instagram" | "telegram" (required)
  - \`fallback_channel\`: channel to fallback to if target unavailable

- **go_to** — Jump to another node (for loops/merging). Use sparingly.
  - \`target_node_id\`: ID of the node to jump to

### LinkedIn Steps

- **view_profile** — Visit their LinkedIn profile (triggers "viewed your profile" notification). No data fields. Good warm-up before connection request.

- **follow** — Follow them on LinkedIn. No data fields.

- **like_post** — Like their recent LinkedIn posts
  - \`like_count\`: 1-3 (default: 1)

- **warmup_engagement** — React to/comment on their posts before outreach
  - \`engagement_type\`: "reaction" | "comment" | "both" (default: "reaction")
  - \`reaction_type\`: "like" | "celebrate" | "support" | "love" | "insightful" | "funny" (default: "like")
  - \`comment_templates\`: string[] (comment texts, if engagement_type includes comments)
  - \`post_count\`: 1-3 (default: 1)
  - \`prefer_high_engagement\`: boolean (default: true)
  - \`cooldown_days\`: min days between engagements (default: 7)

- **connection_request** — Send LinkedIn connection request. **Max 300 characters!**
  - \`message\`: string (optional — blank = no note, sometimes better acceptance rate)
  - \`message_variations\`: string[] (A/B test variants)
  - \`withdraw_after_days\`: number (auto-withdraw if not accepted, default: 14)
  - \`message_mode\`: "manual" | "prompt" (default: "manual")
  - \`prompt\`: string (AI prompt, when message_mode="prompt")
  - \`prompt_variations\`: string[] (A/B test prompt variants)
  - \`llm_model\`: string (OpenRouter model ID, e.g. "anthropic/claude-sonnet-4.5")
  - \`llm_temperature\`: number (0-1, default: 0.7)
  - Requires: LinkedIn sender account

- **message** — Send LinkedIn DM. **Requires existing connection.** Max 8000 chars.
  - \`message\`: string (required unless prompt mode)
  - \`message_variations\`: string[]
  - \`message_mode\` / \`prompt\` / \`prompt_variations\` / \`llm_model\` / \`llm_temperature\` (same as above)
  - Requires: LinkedIn sender + must be connected

- **inmail** — Send LinkedIn InMail (premium). Max 1900 chars. Does NOT require connection.
  - \`subject\`: string (required)
  - \`message\`: string (required unless prompt mode)
  - \`message_variations\`: {subject, message}[] (for InMail, variations are subject+message pairs)
  - \`message_mode\` / \`prompt\` / \`prompt_variations\` / \`llm_model\` / \`llm_temperature\`
  - Requires: LinkedIn Premium sender

### Email Steps

- **email** — Send email via SMTP mailbox. Max 5000 chars.
  - \`subject\`: string (required)
  - \`body\`: string (required unless prompt mode)
  - \`subject_variations\`: string[]
  - \`body_variations\`: string[]
  - \`track_opens\`: boolean (default: true)
  - \`track_clicks\`: boolean (default: true)
  - \`mailbox_id\`: string (specific mailbox, or auto-rotated)
  - \`message_mode\` / \`prompt\` / \`prompt_variations\` / \`llm_model\` / \`llm_temperature\`
  - Requires: Email sender (SMTP mailbox)

### WhatsApp Steps

- **whatsapp_message** — Send WhatsApp message
  - \`message\`: string (required unless prompt mode)
  - \`message_variations\`: string[]
  - \`include_media\`: boolean
  - \`media_url\`: string (image/video/doc URL)
  - \`media_type\`: "image" | "video" | "document"
  - \`message_mode\` / \`prompt\` / \`prompt_variations\` / \`llm_model\` / \`llm_temperature\`
  - Requires: WhatsApp sender

### SMS and WhatsApp Business Steps (org's Twilio senders, Settings → SMS & WhatsApp)

- **sms** — Send an SMS from the org's Twilio numbers
  - \`message\`: string (required unless prompt mode); \`message_variations\`: string[]
  - \`message_mode\` / \`prompt\` / \`prompt_variations\` / \`llm_model\` / \`llm_temperature\`
  - \`continue_on_failure\`: boolean (default: false). Leads with no mobile number, opted out, or
    no sender for their country are skipped; with true they move to the next step instead.
  - Sends only in the recipient's local sending hours (leads wait); opt-out wording added where required
  - Requires: an active SMS sender (\`list_messaging_senders\`), not a Unipile account

- **whatsapp_template** — Start a WhatsApp Business conversation with a Meta-approved template
  - \`template_id\`: string (required; \`list_whatsapp_templates\`, approved or in review)
  - \`continue_on_failure\`: boolean (default: false). Set true so leads not on WhatsApp continue
  - Marketing templates never go to US numbers (Meta blocks them) and wait for sending hours
  - Requires: an active WhatsApp Business sender (Twilio), not the Unipile WhatsApp

- For a ready-made database reactivation flow use \`create_dbr_campaign\`.

### AI Agent

- **handoff_to_agent** — Turn the AI agent on for the lead's conversation so it answers replies
  - \`agent_profile_id\`: string (default: the campaign's agent)
  - \`exit_after_handoff\`: boolean (default: true; false keeps the sequence going)
  - \`channel\`: "sms" | "whatsapp" | … (only hand over that channel's thread; without it, the lead's
    latest conversation)
  - \`continue_on_failure\`: boolean (default: false)
  - A reply stops the campaign, so place it right after the send whose replies it should answer

### Instagram Steps

- **instagram_dm** — Send Instagram DM
  - \`message\`: string (required unless prompt mode)
  - \`message_variations\`: string[]
  - \`include_media\`: boolean
  - \`media_url\`: string
  - \`message_mode\` / \`prompt\` / \`prompt_variations\` / \`llm_model\` / \`llm_temperature\`
  - Requires: Instagram sender

- **instagram_follow** — Follow on Instagram. No data fields.

- **instagram_like_post** — Like Instagram posts
  - \`like_count\`: 1-3 (default: 1)

### Telegram Steps

- **telegram_message** — Send Telegram message
  - \`message\`: string (required unless prompt mode)
  - \`message_variations\`: string[]
  - \`parse_mode\`: "HTML" | "Markdown" | "MarkdownV2"
  - \`message_mode\` / \`prompt\` / \`prompt_variations\` / \`llm_model\` / \`llm_temperature\`
  - Requires: Telegram sender

### Enrichment Steps

- **find_email** — Find contact's email via enrichment (Apollo/Prospeo)
  - \`provider\`: "auto" | "apollo" | "prospeo" (default: "auto")
  - \`skip_if_has_email\`: boolean (default: true)
  - \`accept_catch_all\`: boolean (default: false)
  - \`validate_email\`: boolean (default: true)
  - \`continue_on_failure\`: boolean (default: true)
  - Requires: LinkedIn identity (to look up email)

- **analyze_contact** — AI-analyze contact for deep personalization. Populates {{ai_*}} variables.
  - \`skip_if_already_enriched\`: boolean (default: true)
  - \`continue_on_failure\`: boolean (default: true)
  - \`model\`: OpenRouter model ID (default: "x-ai/grok-4.1-fast")
  - \`product_id\`: string (product UUID — tailors analysis to your offering)
  - IMPORTANT: Run BEFORE any nodes that use {{ai_*}} template variables

### Calendar Steps

- **schedule_meeting** — Schedule a meeting when lead replies positively
  - \`title_template\`: string (e.g. "Call with {contact_name}")
  - \`duration_minutes\`: 15 | 30 | 45 | 60 (default: 30)
  - \`conference_provider\`: "google_meet" | "zoom" | "teams" | "none"
  - \`body_template\`: string (meeting description)
  - \`trigger_condition\`: "positive_reply" | "any_reply" | "manual"

### Notion Steps

- **create_notion_page** — Generate personalized Notion page for contact
  - \`connection_id\`: string (Notion integration ID, required)
  - \`database_id\`: string (Notion database ID, required)
  - \`product_id\`: string (product context)
  - \`blueprint_ids\`: string[] (content blueprints, required)
  - \`custom_prompt\`: string (custom generation prompt)
  - \`icp_threshold\`: number (min ICP score to generate, 0 = always)
  - \`continue_on_failure\`: boolean (default: true)
  - \`model\`: OpenRouter model ID

### Email Tool Handoff Steps

Push leads to external email tools with personalized content:

- **send_to_smartlead** / **send_to_instantly** / **send_to_lead_connector**
  - \`connection_id\`: string (tool connection ID)
  - \`external_campaign_id\`: string (campaign in the external tool)
  - \`email_subject\`: string (required unless prompt mode)
  - \`email_body\`: string (required unless prompt mode)
  - \`exit_after_handoff\`: boolean (default: true)
  - \`message_mode\` / \`prompt\` / \`llm_model\` / \`llm_temperature\`
  - \`email_count\`: 2-7 (emails in generated sequence, default: 3)
  - \`require_review\`: boolean (save for review before pushing, default: true)

- **send_to_zapmail** — Enroll in internal email sequence
  - Same fields as above, plus:
  - \`enrollment_mode\`: "new" | "existing" (default: "new")
  - \`existing_sequence_id\`: string (when mode="existing")

---

## CONDITION STEPS (Branching)

Condition steps branch the sequence into two paths. Each must have a \`branches\` object with both branch names.

- **if_connected** — Did they accept the connection request?
  - branches: { "accepted": [...steps], "not_accepted": [...steps] }

- **if_reply_received** — Did they reply to any message?
  - \`within_days\`: number (check window, default: 7)
  - branches: { "replied": [...steps], "no_reply": [...steps] }

- **if_email_opened** — Did they open the email?
  - branches: { "opened": [...steps], "not_opened": [...steps] }

- **if_email_clicked** — Did they click a link in the email?
  - branches: { "clicked": [...steps], "not_clicked": [...steps] }

- **if_open_profile** — Is their LinkedIn profile open (allows InMail without premium)?
  - branches: { "open": [...steps], "closed": [...steps] }

- **if_channel_available** — Branch on what we have on the contact, or on a Unipile check.
  - \`check\`: "linkedinUrl" | "email" | "instagram" | "phone" | "telegram" (contact data), or
    "linkedinOnUnipile" (URL resolves to a profile) | "linkedinConnected" (1st-degree connection of the
    LinkedIn sender) | "instagramOnUnipile" | "whatsappRegistered" | "senderConnected" (Unipile, through
    the campaign's sender on that channel), or "enteredViaTrigger" | "enteredOnChannel" (how a campaign
    trigger brought the lead in)
  - \`channel\`: for "senderConnected", the channel whose sender to check ("linkedin" | "instagram" | "whatsapp" | "telegram");
    for "enteredOnChannel", the channel they came in on (also "email")
  - \`trigger_id\`: for "enteredViaTrigger", the campaign entry trigger id (omit for any trigger)
  - branches: { "available": [...steps], "not_available": [...steps] }

- **route_by_channel** — Send each lead down the first channel it can be reached on.
  - \`channels\`: priority order, e.g. ["linkedin", "email", "whatsapp"] (from linkedin, email, instagram, whatsapp, telegram)
  - \`require_sender\` (default true): skip a Unipile channel the campaign has no sender on
  - \`verify_on_unipile\` (default false): confirm LinkedIn / Instagram / WhatsApp on Unipile before routing
  - \`entry_channel_first\` (default false): for leads a trigger brought in, try the channel they reached out on first
  - branches: one per channel in \`channels\`, plus "none" for leads no channel can reach

- **if_enriched** — Does the contact have AI analysis data?
  - branches: { "enriched": [...steps], "not_enriched": [...steps] }

- **if_analyzed** — Did analyze_contact run successfully in this campaign?
  - branches: { "analyzed": [...steps], "not_analyzed": [...steps] }

- **if_whatsapp_number** — Does their phone have WhatsApp?
  - branches: { "has_whatsapp": [...steps], "no_whatsapp": [...steps] }

---

## TEMPLATE VARIABLES

Use \`{{variable_name}}\` in message text. These are replaced per-contact at execution time.

### Contact Variables (always available)
- \`{{first_name}}\` — first name (fallback: "there")
- \`{{last_name}}\` — last name
- \`{{full_name}}\` — full name
- \`{{company}}\` — company name
- \`{{position}}\` — job title
- \`{{location}}\` — location
- \`{{industry}}\` — industry
- \`{{headline}}\` — LinkedIn headline

### Sender Variables
- \`{{sender_name}}\` — sender account display name
- \`{{sender_first_name}}\` — sender first name
- \`{{sender_last_name}}\` — sender last name

### AI Analysis Variables (require analyze_contact to have run first)
- \`{{ai_primary_need}}\` — what they need most
- \`{{ai_primary_need_reason}}\` — reasoning behind the need
- \`{{ai_company_niche}}\` — specific niche (e.g. "AI-powered HR software")
- \`{{ai_company_offering}}\` — what they sell
- \`{{ai_company_target}}\` — who their customers are
- \`{{ai_company_tagline}}\` — their value proposition
- \`{{ai_best_hook}}\` — personalized icebreaker from LinkedIn activity
- \`{{ai_linkedin_topic_1}}\` — topic they post about
- \`{{ai_priority_1}}\` — their top business priority
- \`{{ai_growth_signal_1}}\` — top growth signal
- \`{{ai_latest_funding}}\` — funding round info
- \`{{ai_funding_amount}}\` — dollar amount raised

### Deliverable Variables
- \`{{notion_preview_url}}\` — URL to generated Notion page (requires create_notion_page)

---

## AI PROMPT MODE

Set \`message_mode: "prompt"\` on any message step. Instead of sending static text, the AI generates a personalized message per-contact at execution time using their data.

- \`prompt\`: Instructions for the AI (e.g. "Write a connection request referencing their recent post about {{ai_linkedin_topic_1}}")
- \`prompt_variations\`: A/B test different prompts
- \`llm_model\`: OpenRouter model ID. Recommended: "anthropic/claude-sonnet-4.5", "x-ai/grok-4.1-fast", "openai/gpt-4o"
- \`llm_temperature\`: 0-1 (default: 0.7)

The prompt has access to ALL template variables. The AI output should be the final message (no preamble).

---

## SEQUENCE DESIGN BEST PRACTICES

### Clean Layouts
The auto-layout engine renders sequences as a top-down tree. For the cleanest rendering:
- Keep the **main flow linear** (straight trunk): start → actions → delays → end
- Branch only at **condition nodes** — each condition creates two child branches
- Put the **"continuing" path** (the more common path) in the first branch position
  - For if_connected: "not_accepted" continues (more leads don't accept), "accepted" exits to follow-up
  - For if_reply_received: "no_reply" continues (most don't reply), "replied" exits to end
- End exit branches with **end** nodes to keep the tree clean
- Use **delays between all action nodes** — never two actions in a row

### Typical LinkedIn Campaign Structure
\`\`\`
view_profile → delay(1d) → connection_request →
delay(3-7d) → if_connected:
  accepted → message → delay(5d) → if_reply_received:
    replied → end
    no_reply → message (follow-up) → delay(5d) → if_reply_received:
      replied → end
      no_reply → end
  not_accepted → delay(7d) → inmail (if premium) → end
\`\`\`

### Multi-Channel Structure
\`\`\`
analyze_contact → find_email → delay(1d) → view_profile →
delay(1d) → connection_request →
delay(5d) → if_connected:
  accepted → message → delay(3d) → email (follow-up) → end
  not_accepted → email (cold) → delay(5d) → if_reply_received:
    replied → end
    no_reply → inmail → end
\`\`\`

### Advanced: Enrichment + Personalization
\`\`\`
analyze_contact → if_analyzed:
  analyzed → create_notion_page → connection_request(with {{ai_best_hook}}) → ...
  not_analyzed → connection_request(generic) → ...
\`\`\`

## Tools Reference
- \`list_campaigns\`: List campaigns with status/search filtering
- \`get_campaign\`: Full campaign details + human-readable sequence summary
- \`create_campaign\`: Create with high-level steps DSL
- \`update_campaign\`: Modify draft/paused campaigns
- \`update_campaign_status\`: Start (active), pause, or draft
- \`delete_campaigns\`: Delete draft/paused campaigns
- \`list_sender_accounts\`: List available sender accounts by channel
`,

    autopilots: `
# Content Autopilots

Autopilots automatically generate and publish content on a schedule. They combine blueprints, ideas, and publishing destinations into a fully automated content production pipeline.

## Quick Start Workflow

1. \`list_blueprints\` — find blueprints to use in the content mix
2. \`list_publishing_accounts\` — find where you can publish (GHL social + WordPress)
3. \`list_tags\` — find existing tags for idea filtering
4. \`bulk_create_ideas\` with \`tag_ids\` — create ideas with talking points, tagged for the pool
5. \`create_autopilot\` — create the autopilot with content_mix, frequency, and destinations
6. \`list_pool_entries\` — verify ideas are in the pool
7. \`trigger_autopilot\` — run it immediately (optional, it will also run on schedule)
8. \`get_generation_job\` — track the generation progress

## Key Concepts

### Content Mix
An array of blueprints with **weights** summing to ~100. The autopilot randomly selects a blueprint based on weight. Higher weight = more frequent.

Example: 60% Instagram carousels + 30% social posts + 10% blog articles.

### Ideas Source
- **per_blueprint** (default): Each content_mix item has its own \`idea_tags\`. Ideas are matched to the selected blueprint's tags.
- **shared**: All blueprints draw from \`shared_idea_tags\`.

### Idea Pool
Tracks which ideas are queued for production:
- **available**: Ready to be picked
- **in_progress**: Currently generating
- **produced**: Successfully generated
- **failed**: Generation failed (can be retried)

Pool is auto-synced from tags on create/update. You can also manually add ideas or sync.

### Publishing Destinations
Where content goes after generation. Use \`list_publishing_accounts\` to discover available accounts (GHL social media + WordPress sites).

### Evergreen Recycling
Auto-repost published content after a cooldown. Configure min_age_days, max_reposts, and variation_mode (exact, slight_variation, regenerate).

## Tools Reference

### CRUD
- \`create_autopilot\`: Create with content_mix, frequency, destinations (active by default)
- \`update_autopilot\`: Partial update — only changed fields
- \`delete_autopilot\`: Delete autopilot + pool + logs
- \`toggle_autopilot_status\`: Pause or activate
- \`list_autopilots\`: List all with summary stats
- \`get_autopilot\`: Full details + pool stats + recent logs

### Pool Management
- \`sync_autopilot_pool\`: Sync pool from configured tags
- \`add_ideas_to_pool\`: Manually add specific ideas
- \`list_pool_entries\`: View pool entries with status filter
- \`recycle_autopilot_pool\`: Reset produced/failed ideas to available

### Execution
- \`trigger_autopilot\`: Manually trigger generation NOW

### Discovery
- \`list_blueprints\`: Find blueprint IDs for content_mix
- \`list_publishing_accounts\`: Find account IDs for destinations
- \`list_tags\`: Find tag names for idea filtering
- \`list_ideas\`: Find idea UUIDs for manual pool additions

## Example: Create a Daily Instagram Autopilot

1. list_blueprints() → Find "Instagram Carousel - Marketing" (id: bp-123)
2. list_tags() → Find tag "marketing" (id: tag-456)
3. bulk_create_ideas with tag_ids to create tagged ideas
4. list_publishing_accounts() → Find Instagram account (id: ghl-789, platform: "instagram")
5. create_autopilot with name, content_mix, frequency, destinations
6. trigger_autopilot to run immediately, or wait for scheduled run
`
  };

  if (topic === "all") {
    return {
      documentation: Object.values(helpTopics).join("\n\n---\n\n"),
      available_topics: Object.keys(helpTopics),
    };
  }

  const helpContent = helpTopics[topic];
  if (!helpContent) {
    return {
      error: `Unknown topic: ${topic}`,
      available_topics: Object.keys(helpTopics),
    };
  }

  return {
    topic,
    documentation: helpContent,
    available_topics: Object.keys(helpTopics),
  };
}

// Ideas
async function listIdeas(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  // By default, return compact results (no ai_analysis which can be huge)
  // Use include_analysis=true to get full data (warning: can be very large)
  const includeAnalysis = params.include_analysis === true;

  const selectFields = includeAnalysis
    ? `
      id,
      title,
      keywords,

      emotional_triggers,
      content_framework,
      brand_voice_id,
      product_id,
      content_angle_id,
      ai_analysis,
      created_at,
      updated_at,
      brand_voice:library_brand_voices(id, name),
      product:library_products(id, name),
      idea_tag_assignments(
        idea_tags(id, name)
      )
    `
    : `
      id,
      title,
      keywords,

      emotional_triggers,
      content_framework,
      brand_voice_id,
      product_id,
      content_angle_id,
      created_at,
      updated_at,
      brand_voice:library_brand_voices(id, name),
      product:library_products(id, name),
      idea_tag_assignments(
        idea_tags(id, name)
      )
    `;

  let query = supabase
    .from("content_ideas")
    .select(selectFields)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false });

  // Apply filters
  if (params.search) {
    query = query.ilike("title", `%${params.search}%`);
  }

  // Default limit to 20 for compact responses
  const limit = Number(params.limit) || 20;

  if (params.offset) {
    query = query.range(
      Number(params.offset),
      Number(params.offset) + limit - 1
    );
  } else {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) { console.error("[MCP] Failed to list ideas:", error.message); throw new Error("Failed to list ideas"); }

  // Transform tag assignments to flat array
  const ideas = (data || []).map((idea: Record<string, unknown>) => ({
    ...idea,
    tags: ((idea.idea_tag_assignments as Array<{ idea_tags: { id: string; name: string } }>) || [])
      .map((a) => a.idea_tags)
      .filter(Boolean),
    idea_tag_assignments: undefined,
  }));

  return {
    ideas,
    count: ideas.length,
    note: includeAnalysis ? undefined : "ai_analysis excluded for compact response. Use get_idea for full details or include_analysis=true"
  };
}

async function getIdea(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { idea_id } = params;

  if (!idea_id) throw new Error("idea_id is required");

  const { data: idea, error } = await supabase
    .from("content_ideas")
    .select(`
      id,
      title,
      keywords,

      emotional_triggers,
      content_framework,
      brand_voice_id,
      product_id,
      content_angle_id,
      ai_analysis,
      created_at,
      updated_at,
      brand_voice:library_brand_voices(id, name),
      product:library_products(id, name),
      idea_tag_assignments(
        idea_tags(id, name)
      )
    `)
    .eq("id", idea_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get idea:", error.message); throw new Error("Failed to get idea"); }

  // Transform tag assignments to flat array
  const transformedIdea = {
    ...idea,
    tags: ((idea.idea_tag_assignments as Array<{ idea_tags: { id: string; name: string } }>) || [])
      .map((a: { idea_tags: { id: string; name: string } }) => a.idea_tags)
      .filter(Boolean),
    idea_tag_assignments: undefined,
  };

  return { idea: transformedIdea };
}

async function createIdea(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { title, keywords, emotional_triggers, content_framework, brand_voice_id, product_id, tag_ids, ai_analysis } = params;

  if (!title) throw new Error("title is required");

  const { data: idea, error } = await supabase
    .from("content_ideas")
    .insert({
      title,
      keywords: keywords || null,
      emotional_triggers: emotional_triggers || null,
      content_framework: content_framework || null,
      brand_voice_id: brand_voice_id || null,
      product_id: product_id || null,
      // Agent-written talking points start as drafts a person approves in the app.
      ai_analysis: withDraftPoints(ai_analysis),
      organization_id: getEffectiveOrgId(ctx),
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create idea:", error.message, error.details, error.hint); throw new Error(`Failed to create idea: ${error.message}`); }

  // Assign tags if provided
  if (tag_ids && Array.isArray(tag_ids) && tag_ids.length > 0) {
    const tagAssignments = tag_ids.map((tagId: string) => ({
      idea_id: idea.id,
      tag_id: tagId,
    }));

    await supabase.from("idea_tag_assignments").insert(tagAssignments);
  }

  return { idea };
}

async function bulkCreateIdeas(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { ideas } = params as {
    ideas: Array<{
      title: string;
      keywords?: string[];
      emotional_triggers?: string[];
      content_framework?: string;
      brand_voice_id?: string;
      product_id?: string;
      tag_ids?: string[];
      ai_analysis?: Record<string, unknown>;
    }>
  };

  if (!ideas || !Array.isArray(ideas) || ideas.length === 0) {
    throw new Error("ideas array is required");
  }

  if (ideas.length > 100) {
    throw new Error("Maximum 100 ideas per bulk create");
  }

  const ideasToInsert = ideas.map((idea) => ({
    title: idea.title,
    keywords: idea.keywords || null,
    emotional_triggers: idea.emotional_triggers || null,
    content_framework: idea.content_framework || null,
    brand_voice_id: idea.brand_voice_id || null,
    product_id: idea.product_id || null,
    ai_analysis: withDraftPoints(idea.ai_analysis),
    organization_id: getEffectiveOrgId(ctx),
  }));

  const { data: createdIdeas, error } = await supabase
    .from("content_ideas")
    .insert(ideasToInsert)
    .select();

  if (error) { console.error("[MCP] Failed to create ideas:", error.message, error.details, error.hint); throw new Error(`Failed to create ideas: ${error.message}`); }

  // Assign tags for each idea
  const allTagAssignments: Array<{ idea_id: string; tag_id: string }> = [];
  ideas.forEach((ideaInput, index) => {
    if (ideaInput.tag_ids && ideaInput.tag_ids.length > 0) {
      const createdIdea = createdIdeas[index];
      ideaInput.tag_ids.forEach((tagId) => {
        allTagAssignments.push({
          idea_id: createdIdea.id,
          tag_id: tagId,
        });
      });
    }
  });

  if (allTagAssignments.length > 0) {
    await supabase.from("idea_tag_assignments").insert(allTagAssignments);
  }

  return { ideas: createdIdeas, count: createdIdeas.length };
}

async function updateIdea(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { idea_id, ...updates } = params;

  if (!idea_id) throw new Error("idea_id is required");

  // Remove undefined values and non-updatable fields
  const cleanUpdates: Record<string, unknown> = {};
  const allowedFields = ["title", "keywords", "emotional_triggers", "content_framework", "brand_voice_id", "product_id", "ai_analysis"];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  // Merge ai_analysis instead of replacing it; new or rewritten points become
  // drafts (and reset the idea's approval, see reset_idea_guidelines_approval).
  if (cleanUpdates.ai_analysis && typeof cleanUpdates.ai_analysis === "object" && !Array.isArray(cleanUpdates.ai_analysis)) {
    const { data: current } = await supabase
      .from("content_ideas")
      .select("ai_analysis")
      .eq("id", idea_id)
      .eq("organization_id", getEffectiveOrgId(ctx))
      .maybeSingle();
    cleanUpdates.ai_analysis = mergeAgentAnalysis(current?.ai_analysis, cleanUpdates.ai_analysis as Record<string, any>);
  }

  const { data: idea, error } = await supabase
    .from("content_ideas")
    .update(cleanUpdates)
    .eq("id", idea_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update idea:", error.message); throw new Error("Failed to update idea"); }

  return { idea };
}

async function deleteIdeas(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { idea_ids } = params as { idea_ids: string[] };

  if (!idea_ids || !Array.isArray(idea_ids) || idea_ids.length === 0) {
    throw new Error("idea_ids array is required");
  }

  const { error } = await supabase
    .from("content_ideas")
    .delete()
    .in("id", idea_ids)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete ideas:", error.message); throw new Error("Failed to delete ideas"); }

  return { deleted: idea_ids.length };
}

// Tags
async function listTags(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const { data: tags, error } = await supabase
    .from("idea_tags")
    .select("id, name, created_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("name");

  if (error) { console.error("[MCP] Failed to list tags:", error.message); throw new Error("Failed to list tags"); }

  return { tags };
}

async function createTag(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name } = params;

  if (!name) throw new Error("name is required");

  const { data: tag, error } = await supabase
    .from("idea_tags")
    .insert({
      name,
      organization_id: getEffectiveOrgId(ctx),
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create tag:", error.message); throw new Error("Failed to create tag"); }

  return { tag };
}

async function assignTags(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { idea_id, tag_ids } = params as { idea_id: string; tag_ids: string[] };

  if (!idea_id) throw new Error("idea_id is required");
  if (!tag_ids || !Array.isArray(tag_ids)) throw new Error("tag_ids array is required");

  // Verify idea belongs to org
  const { data: idea } = await supabase
    .from("content_ideas")
    .select("id")
    .eq("id", idea_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (!idea) throw new Error("Idea not found");

  // Diff-based approach: only remove/add what changed to avoid momentary tag loss
  const { data: current } = await supabase
    .from("idea_tag_assignments")
    .select("tag_id")
    .eq("idea_id", idea_id);

  const currentIds = new Set((current || []).map((a: { tag_id: string }) => a.tag_id));
  const newIds = new Set(tag_ids as string[]);

  // Delete removed tags
  const toRemove = [...currentIds].filter(id => !newIds.has(id));
  if (toRemove.length > 0) {
    await supabase
      .from("idea_tag_assignments")
      .delete()
      .eq("idea_id", idea_id)
      .in("tag_id", toRemove);
  }

  // Insert new tags
  const toAdd = [...newIds].filter(id => !currentIds.has(id));
  if (toAdd.length > 0) {
    const assignments = toAdd.map((tagId) => ({ idea_id, tag_id: tagId }));
    const { error } = await supabase.from("idea_tag_assignments").insert(assignments);
    if (error) {
      console.error("[MCP] Failed to assign tags:", error.message);
      throw new Error("Failed to assign tags");
    }
  }

  return { assigned: tag_ids.length };
}

// Brand Voices
async function listBrandVoices(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const { data: brandVoices, error } = await supabase
    .from("library_brand_voices")
    .select("*")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("name");

  if (error) { console.error("[MCP] Failed to list brand voices:", error.message); throw new Error("Failed to list brand voices"); }

  return { brand_voices: brandVoices };
}

async function createBrandVoice(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name, description, tone, style_guidelines, mood_keywords } = params;

  if (!name) throw new Error("name is required");

  const { data: brandVoice, error } = await supabase
    .from("library_brand_voices")
    .insert({
      name,
      description: description || null,
      tone: tone || null,
      style_guidelines: style_guidelines || null,
      mood_keywords: mood_keywords || null,
      organization_id: getEffectiveOrgId(ctx),
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create brand voice:", error.message); throw new Error("Failed to create brand voice"); }

  return { brand_voice: brandVoice };
}

async function getBrandVoice(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { brand_voice_id } = params;

  if (!brand_voice_id) throw new Error("brand_voice_id is required");

  const { data: brandVoice, error } = await supabase
    .from("library_brand_voices")
    .select("*")
    .eq("id", brand_voice_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get brand voice:", error.message); throw new Error("Failed to get brand voice"); }

  return { brand_voice: brandVoice };
}

async function updateBrandVoice(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { brand_voice_id, ...updates } = params;

  if (!brand_voice_id) throw new Error("brand_voice_id is required");

  const allowedFields = [
    "name", "description", "tone", "style_guidelines", "mood_keywords",
    "color_palette", "font_style", "accent_style", "logo", "logos",
    "visual_template", "visual_style_description"
  ];
  const cleanUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  if (Object.keys(cleanUpdates).length === 0) {
    throw new Error("No valid fields to update");
  }

  const { data: brandVoice, error } = await supabase
    .from("library_brand_voices")
    .update(cleanUpdates)
    .eq("id", brand_voice_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update brand voice:", error.message); throw new Error("Failed to update brand voice"); }

  return { brand_voice: brandVoice };
}

async function deleteBrandVoices(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { brand_voice_ids } = params as { brand_voice_ids: string[] };

  if (!brand_voice_ids || !Array.isArray(brand_voice_ids) || brand_voice_ids.length === 0) {
    throw new Error("brand_voice_ids array is required");
  }

  const { error } = await supabase
    .from("library_brand_voices")
    .delete()
    .in("id", brand_voice_ids)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete brand voices:", error.message); throw new Error("Failed to delete brand voices"); }

  return { deleted: brand_voice_ids.length };
}

// Products
async function listProducts(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const { data: products, error } = await supabase
    .from("library_products")
    .select("*")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("name");

  if (error) { console.error("[MCP] Failed to list products:", error.message); throw new Error("Failed to list products"); }

  return { products };
}

async function createProduct(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name, description, features, key_benefits, category } = params;

  if (!name) throw new Error("name is required");

  const { data: product, error } = await supabase
    .from("library_products")
    .insert({
      name,
      description: description || null,
      features: features || null,
      key_benefits: key_benefits || null,
      category: category || null,
      organization_id: getEffectiveOrgId(ctx),
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create product:", error.message); throw new Error("Failed to create product"); }

  return { product };
}

async function getProduct(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { product_id } = params;

  if (!product_id) throw new Error("product_id is required");

  const { data: product, error } = await supabase
    .from("library_products")
    .select("*")
    .eq("id", product_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get product:", error.message); throw new Error("Failed to get product"); }

  return { product };
}

async function updateProduct(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { product_id, ...updates } = params;

  if (!product_id) throw new Error("product_id is required");

  const allowedFields = [
    "name", "description", "category", "brand", "logo", "sku", "price", "currency",
    "features", "key_benefits", "tags", "images", "videos", "specifications", "affiliate_links"
  ];
  const cleanUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  if (Object.keys(cleanUpdates).length === 0) {
    throw new Error("No valid fields to update");
  }

  const { data: product, error } = await supabase
    .from("library_products")
    .update(cleanUpdates)
    .eq("id", product_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update product:", error.message); throw new Error("Failed to update product"); }

  return { product };
}

async function deleteProducts(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { product_ids } = params as { product_ids: string[] };

  if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
    throw new Error("product_ids array is required");
  }

  const { error } = await supabase
    .from("library_products")
    .delete()
    .in("id", product_ids)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete products:", error.message); throw new Error("Failed to delete products"); }

  return { deleted: product_ids.length };
}

// ICPs
async function listICPs(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const { data: icps, error } = await supabase
    .from("library_icps")
    .select("*")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("name");

  if (error) { console.error("[MCP] Failed to list ICPs:", error.message); throw new Error("Failed to list ICPs"); }

  return { icps };
}

async function createICP(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name, description, summary, pain_points, desires, objections, language_style, tags, target_locations } = params;

  if (!name) throw new Error("name is required");

  const { data: icp, error } = await supabase
    .from("library_icps")
    .insert({
      name,
      description: description || null,
      summary: summary || null,
      pain_points: pain_points || null,
      desires: desires || null,
      objections: objections || null,
      language_style: language_style || null,
      tags: tags || null,
      target_locations: target_locations || null,
      organization_id: getEffectiveOrgId(ctx),
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create ICP:", error.message); throw new Error("Failed to create ICP"); }

  return { icp };
}

async function updateICP(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { icp_id, ...updates } = params;

  if (!icp_id) throw new Error("icp_id is required");

  const allowedFields = ["name", "description", "summary", "pain_points", "desires", "objections", "language_style", "tags", "target_locations"];
  const cleanUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  const { data: icp, error } = await supabase
    .from("library_icps")
    .update(cleanUpdates)
    .eq("id", icp_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update ICP:", error.message); throw new Error("Failed to update ICP"); }

  return { icp };
}

async function deleteICPs(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { icp_ids } = params as { icp_ids: string[] };

  if (!icp_ids || !Array.isArray(icp_ids) || icp_ids.length === 0) {
    throw new Error("icp_ids array is required");
  }

  const { error } = await supabase
    .from("library_icps")
    .delete()
    .in("id", icp_ids)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete ICPs:", error.message); throw new Error("Failed to delete ICPs"); }

  return { deleted: icp_ids.length };
}

// Blueprints
async function listBlueprints(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  let query = supabase
    .from("blueprints")
    .select("id, name, description, pipeline, tags, is_active, created_at, updated_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("name");

  if (params.pipeline) {
    query = query.eq("pipeline", params.pipeline);
  }

  if (params.is_active !== undefined) {
    query = query.eq("is_active", params.is_active);
  }

  const { data: blueprints, error } = await query;

  if (error) { console.error("[MCP] Failed to list blueprints:", error.message); throw new Error("Failed to list blueprints"); }

  return { blueprints };
}

async function getBlueprint(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { blueprint_id } = params;

  if (!blueprint_id) throw new Error("blueprint_id is required");

  const { data: blueprint, error } = await supabase
    .from("blueprints")
    .select("*")
    .eq("id", blueprint_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get blueprint:", error.message); throw new Error("Failed to get blueprint"); }

  return { blueprint };
}

async function createBlueprint(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const {
    name, description, master_prompt, image_prompt,
    structure, model_config, pipeline, tags,
    reference_image_libraries, is_active, is_public
  } = params;

  if (!name) throw new Error("name is required");
  if (!master_prompt) throw new Error("master_prompt is required");

  const { data: blueprint, error } = await supabase
    .from("blueprints")
    .insert({
      name,
      description: description || null,
      master_prompt,
      image_prompt: image_prompt || null,
      structure: structure || { slots: [] },
      model_config: model_config || {},
      pipeline: pipeline || null,
      tags: tags || null,
      reference_image_libraries: reference_image_libraries || null,
      is_active: is_active !== false,
      is_public: is_public === true,
      organization_id: getEffectiveOrgId(ctx),
    })
    .select("id, name, description, pipeline, tags, is_active, created_at")
    .single();

  if (error) { console.error("[MCP] Failed to create blueprint:", error.message); throw new Error("Failed to create blueprint"); }

  return { blueprint };
}

async function updateBlueprint(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { blueprint_id, ...updates } = params;

  if (!blueprint_id) throw new Error("blueprint_id is required");

  const allowedFields = [
    "name", "description", "master_prompt", "image_prompt",
    "structure", "model_config", "pipeline", "tags",
    "reference_image_libraries", "is_active", "is_public"
  ];
  const cleanUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  const { data: blueprint, error } = await supabase
    .from("blueprints")
    .update(cleanUpdates)
    .eq("id", blueprint_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .select("id, name, description, pipeline, tags, is_active, updated_at")
    .single();

  if (error) { console.error("[MCP] Failed to update blueprint:", error.message); throw new Error("Failed to update blueprint"); }

  return { blueprint };
}

async function deleteBlueprint(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { blueprint_id } = params;

  if (!blueprint_id) throw new Error("blueprint_id is required");

  const { error } = await supabase
    .from("blueprints")
    .delete()
    .eq("id", blueprint_id)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete blueprint:", error.message); throw new Error("Failed to delete blueprint"); }

  return { deleted: true };
}

// Blocks
async function listBlocks(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  let query = supabase
    .from("library_blocks")
    .select("id, block_type, name, content, tags, usage_count, created_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false });

  if (params.block_type) {
    query = query.eq("block_type", params.block_type);
  }

  const limit = Number(params.limit) || 50;
  query = query.limit(limit);

  const { data: blocks, error } = await query;

  if (error) { console.error("[MCP] Failed to list blocks:", error.message); throw new Error("Failed to list blocks"); }

  return { blocks, count: blocks.length };
}

async function createBlock(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { block_type, name, content, tags } = params;

  if (!block_type) throw new Error("block_type is required");
  if (!content) throw new Error("content is required");

  const validTypes = ['hook', 'angle', 'cta', 'story_element'];
  if (!validTypes.includes(block_type as string)) {
    throw new Error(`block_type must be one of: ${validTypes.join(', ')}`);
  }

  const { data: block, error } = await supabase
    .from("library_blocks")
    .insert({
      block_type,
      name: name || null,
      content,
      tags: tags || null,
      organization_id: getEffectiveOrgId(ctx),
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create block:", error.message); throw new Error("Failed to create block"); }

  return { block };
}

async function bulkCreateBlocks(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { blocks } = params as { blocks: Array<{ block_type: string; content: string; name?: string; tags?: string[] }> };

  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
    throw new Error("blocks array is required");
  }

  if (blocks.length > 100) {
    throw new Error("Maximum 100 blocks per bulk create");
  }

  const validTypes = ['hook', 'angle', 'cta', 'story_element'];

  const blocksToInsert = blocks.map((block, index) => {
    if (!block.block_type) throw new Error(`Block at index ${index} missing block_type`);
    if (!block.content) throw new Error(`Block at index ${index} missing content`);
    if (!validTypes.includes(block.block_type)) {
      throw new Error(`Block at index ${index} has invalid block_type. Must be: ${validTypes.join(', ')}`);
    }

    return {
      block_type: block.block_type,
      name: block.name || null,
      content: block.content,
      tags: block.tags || null,
      organization_id: getEffectiveOrgId(ctx),
    };
  });

  const { data: createdBlocks, error } = await supabase
    .from("library_blocks")
    .insert(blocksToInsert)
    .select();

  if (error) { console.error("[MCP] Failed to create blocks:", error.message); throw new Error("Failed to create blocks"); }

  return { blocks: createdBlocks, count: createdBlocks.length };
}

async function deleteBlocks(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { block_ids } = params as { block_ids: string[] };

  if (!block_ids || !Array.isArray(block_ids) || block_ids.length === 0) {
    throw new Error("block_ids array is required");
  }

  const { error } = await supabase
    .from("library_blocks")
    .delete()
    .in("id", block_ids)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete blocks:", error.message); throw new Error("Failed to delete blocks"); }

  return { deleted: block_ids.length };
}

// Strategy Documents
async function listStrategyDocuments(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  let query = supabase
    .from("library_strategy_documents")
    .select("id, name, description, document_type, tags, is_active, created_at, updated_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false });

  if (params.document_type) {
    query = query.eq("document_type", params.document_type);
  }

  if (params.is_active !== undefined) {
    query = query.eq("is_active", params.is_active);
  }

  const limit = Number(params.limit) || 20;
  query = query.limit(limit);

  const { data: documents, error } = await query;

  if (error) { console.error("[MCP] Failed to list strategy documents:", error.message); throw new Error("Failed to list strategy documents"); }

  return {
    documents,
    count: documents.length,
    note: "Content excluded for compact response. Use get_strategy_document for full content."
  };
}

async function getStrategyDocument(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { document_id } = params;

  if (!document_id) throw new Error("document_id is required");

  const { data: document, error } = await supabase
    .from("library_strategy_documents")
    .select("*")
    .eq("id", document_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get strategy document:", error.message); throw new Error("Failed to get strategy document"); }

  return { document };
}

async function createStrategyDocument(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name, description, document_type, content, file_url, file_name, file_type, tags, related_product_ids, related_icp_ids, is_active } = params;

  if (!name) throw new Error("name is required");
  if (!document_type) throw new Error("document_type is required");
  if (!content && !file_url) throw new Error("Either content or file_url is required");

  const validTypes = ['lead_magnet', 'sales_strategy', 'content_calendar', 'funnel', 'email_sequence', 'landing_page', 'ad_copy', 'other'];
  if (!validTypes.includes(document_type as string)) {
    throw new Error(`document_type must be one of: ${validTypes.join(', ')}`);
  }

  const { data: document, error } = await supabase
    .from("library_strategy_documents")
    .insert({
      name,
      description: description || null,
      document_type,
      content: content || null,
      file_url: file_url || null,
      file_name: file_name || null,
      file_type: file_type || null,
      tags: tags || null,
      related_product_ids: related_product_ids || null,
      related_icp_ids: related_icp_ids || null,
      is_active: is_active !== false,
      organization_id: getEffectiveOrgId(ctx),
    })
    .select("id, name, description, document_type, file_url, file_name, file_type, tags, is_active, created_at")
    .single();

  if (error) { console.error("[MCP] Failed to create strategy document:", error.message); throw new Error("Failed to create strategy document"); }

  return { document };
}

async function updateStrategyDocument(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { document_id, ...updates } = params;

  if (!document_id) throw new Error("document_id is required");

  const allowedFields = ["name", "description", "document_type", "content", "file_url", "file_name", "file_type", "tags", "related_product_ids", "related_icp_ids", "is_active"];
  const cleanUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  const { data: document, error } = await supabase
    .from("library_strategy_documents")
    .update(cleanUpdates)
    .eq("id", document_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .select("id, name, description, document_type, file_url, file_name, file_type, tags, is_active, updated_at")
    .single();

  if (error) { console.error("[MCP] Failed to update strategy document:", error.message); throw new Error("Failed to update strategy document"); }

  return { document };
}

async function deleteStrategyDocuments(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { document_ids } = params as { document_ids: string[] };

  if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
    throw new Error("document_ids array is required");
  }

  const { error } = await supabase
    .from("library_strategy_documents")
    .delete()
    .in("id", document_ids)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete strategy documents:", error.message); throw new Error("Failed to delete strategy documents"); }

  return { deleted: document_ids.length };
}

// Content Generation
async function triggerContentGeneration(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { blueprint_id, pipeline, items, library_elements, output_config, auto_approve } = params as {
    blueprint_id: string;
    pipeline: string;
    items: Array<{
      idea_id?: string;
      idea_title?: string;
      slot_values?: Record<string, string>;
    }>;
    library_elements?: Record<string, {
      element_ids: string[];
      combination_mode?: "combine" | "separate";
    }>;
    output_config?: {
      aspect_ratio?: string;
      video_duration?: number;
      slide_count?: number;
      template?: string;
      custom_palette?: { primary?: string; secondary?: string; background?: string; text?: string; accent?: string };
      background_image_url?: string;
    };
    auto_approve?: boolean;
  };

  if (!blueprint_id) throw new Error("blueprint_id is required");
  if (!pipeline) throw new Error("pipeline is required");
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("items array is required and must not be empty");
  }

  // Validate pipeline
  const validPipelines = [
    "rich_article", "social_media_post", "instagram_carousel", "image_only",
    "ugc_video", "generative_video_oneshot", "video_script", "storyboard_video_longform"
  ];
  if (!validPipelines.includes(pipeline)) {
    throw new Error(`Invalid pipeline. Must be one of: ${validPipelines.join(", ")}`);
  }

  // Fetch blueprint to verify it exists and get config
  const { data: blueprint, error: blueprintError } = await supabase
    .from("blueprints")
    .select("*")
    .eq("id", blueprint_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (blueprintError || !blueprint) {
    throw new Error(`Blueprint not found: ${blueprint_id}`);
  }

  // Fetch library elements if provided
  const fetchedElements: Record<string, Array<Record<string, unknown>>> = {};

  if (library_elements) {
    for (const [tableName, config] of Object.entries(library_elements)) {
      if (!config.element_ids || config.element_ids.length === 0) continue;

      const validTables = ["library_brand_voices", "library_products", "library_icps", "library_characters", "library_blocks"];
      if (!validTables.includes(tableName)) {
        throw new Error(`Invalid library table: ${tableName}. Must be one of: ${validTables.join(", ")}`);
      }

      const { data: elements, error } = await supabase
        .from(tableName)
        .select("*")
        .in("id", config.element_ids)
        .eq("organization_id", getEffectiveOrgId(ctx));

      if (error) { console.error(`[MCP] Failed to fetch ${tableName}:`, error.message); throw new Error(`Failed to fetch ${tableName}`); }
      fetchedElements[tableName] = elements || [];
    }
  }

  // Content explosion: expand items based on library elements with "separate" mode
  const expandedItems: Array<{
    idea_id?: string;
    idea_title?: string;
    slot_values: Record<string, string>;
    library_elements: Record<string, Array<Record<string, unknown>>>;
  }> = [];

  // For each input item, create variations based on "separate" mode elements
  for (const item of items) {
    // Build base item
    const baseItem = {
      idea_id: item.idea_id,
      idea_title: item.idea_title,
      slot_values: item.slot_values || {},
      library_elements: {} as Record<string, Array<Record<string, unknown>>>,
    };

    // Determine which elements to combine and which to separate
    const combinedElements: Record<string, Array<Record<string, unknown>>> = {};
    const separateElements: Array<{ tableName: string; elements: Array<Record<string, unknown>> }> = [];

    if (library_elements) {
      for (const [tableName, config] of Object.entries(library_elements)) {
        const elements = fetchedElements[tableName] || [];
        if (elements.length === 0) continue;

        if (config.combination_mode === "separate") {
          separateElements.push({ tableName, elements });
        } else {
          // Default is "combine"
          combinedElements[tableName] = elements;
        }
      }
    }

    // If no separate elements, just add the base item with combined elements
    if (separateElements.length === 0) {
      expandedItems.push({
        ...baseItem,
        library_elements: combinedElements,
      });
    } else {
      // Create cartesian product of separate elements
      const expandSeparate = (
        currentIndex: number,
        currentCombination: Record<string, Array<Record<string, unknown>>>
      ): void => {
        if (currentIndex >= separateElements.length) {
          expandedItems.push({
            ...baseItem,
            library_elements: { ...combinedElements, ...currentCombination },
          });
          return;
        }

        const { tableName, elements } = separateElements[currentIndex];
        for (const element of elements) {
          expandSeparate(currentIndex + 1, {
            ...currentCombination,
            [tableName]: [element],
          });
        }
      };

      expandSeparate(0, {});
    }
  }

  // Build video config if needed
  let videoConfig = null;
  if (["ugc_video", "generative_video_oneshot", "storyboard_video_longform"].includes(pipeline)) {
    videoConfig = {
      duration: output_config?.video_duration || 30,
      aspect_ratio: output_config?.aspect_ratio || "portrait",
    };
  }

  // Build output config for non-video pipelines
  let outputConf: Record<string, unknown> | null = null;
  if (!videoConfig) {
    if (pipeline === "instagram_carousel") {
      // Carousel pipeline: translate snake_case API params to camelCase internal keys.
      // Unset fields fall back to the blueprint's Look settings at dispatch.
      outputConf = {};
      if (output_config?.aspect_ratio) {
        outputConf.aspectRatio = output_config.aspect_ratio;
      }
      if (output_config?.slide_count) {
        outputConf.slideCount = Math.max(3, Math.min(10, output_config.slide_count));
      }
      if (output_config?.template) {
        outputConf.carouselTemplate = output_config.template;
      }
      if (output_config?.custom_palette) {
        outputConf.customPalette = output_config.custom_palette;
      }
      if (output_config?.background_image_url) {
        outputConf.backgroundImageUrl = output_config.background_image_url;
      }
    } else if (output_config?.aspect_ratio) {
      outputConf = {
        aspectRatio: output_config.aspect_ratio,
      };
    }
  }

  // Prepare generation items in the format expected by the job
  const generationItems = expandedItems.map((item, index) => ({
    id: `item_${index}`,
    idea_id: item.idea_id || null,
    idea_title: item.idea_title || `Content ${index + 1}`,
    slot_values: item.slot_values,
    library_elements: item.library_elements,
    status: "pending",
    outputs: null,
  }));

  // Create the generation job
  const { data: job, error: jobError } = await supabase
    .from("content_generation_jobs")
    .insert({
      organization_id: getEffectiveOrgId(ctx),
      user_id: ctx.userId,
      blueprint_id,
      pipeline,
      status: "queued",
      items: generationItems,
      configuration: {
        blueprint_name: blueprint.name,
        pipeline,
        model_config: blueprint.model_config || {},
        video_config: videoConfig,
        output_config: outputConf,
        auto_approve_all: auto_approve ?? true,
      },
      progress: {
        total: generationItems.length,
        completed: 0,
        failed: 0,
      },
      cost: {
        estimated: generationItems.length * 0.05,
        current: 0,
      },
    })
    .select()
    .single();

  if (jobError) { console.error("[MCP] Failed to create generation job:", jobError.message); throw new Error("Failed to create generation job"); }

  // Dispatch the job for processing (non-blocking)
  supabase.functions.invoke("dispatch-generation-job", {
    body: { job_id: job.id },
  }).then(({ error: dispatchError }: { error: Error | null }) => {
    if (dispatchError) {
      console.error("[MCP] Failed to dispatch job:", dispatchError);
    }
  });

  return {
    job_id: job.id,
    status: "queued",
    items_count: generationItems.length,
    message: `Generation job created with ${generationItems.length} items. Job is now processing.`,
  };
}

async function createCarousel(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const {
    idea,
    topic, // legacy alias
    blueprint_id,
    brand_voice_id,
    talking_points,
    slide_count,
    template,
    custom_palette,
    aspect_ratio,
    custom_instructions,
    auto_approve,
    publish_to_ghl,
  } = params as {
    idea?: string;
    topic?: string;
    blueprint_id?: string;
    brand_voice_id?: string;
    talking_points?: string[];
    slide_count?: number;
    template?: string;
    custom_palette?: { primary?: string; secondary?: string; background?: string; text?: string; accent?: string };
    aspect_ratio?: string;
    custom_instructions?: string;
    auto_approve?: boolean;
    publish_to_ghl?: string[];
  };

  const ideaText = idea || topic;
  if (!ideaText) throw new Error("idea is required — a short topic for the carousel (e.g. '5 tips for better sleep')");

  // Validate slide_count (cover + at least 1 value slide + CTA); unset = the blueprint's
  const slideCount = slide_count ? Math.max(3, Math.min(10, slide_count)) : undefined;

  // Validate template: the current themes, plus old template ids, which still resolve
  if (template && !CAROUSEL_THEMES.includes(template) && !LEGACY_CAROUSEL_TEMPLATES.includes(template)) {
    throw new Error(`Invalid template. Must be one of: ${CAROUSEL_THEMES.join(", ")}`);
  }

  // Validate aspect_ratio: feed carousels are 4:5 or 1:1
  const validAspectRatios = ["square", "portrait"];
  if (aspect_ratio && !validAspectRatios.includes(aspect_ratio)) {
    throw new Error(`Invalid aspect_ratio. Must be one of: ${validAspectRatios.join(", ")}`);
  }

  const orgId = getEffectiveOrgId(ctx);

  // Resolve blueprint: explicit > find existing carousel blueprint for this org
  let blueprintId: string;
  let blueprintName: string;
  if (blueprint_id) {
    const { data: bp, error } = await supabase
      .from("blueprints")
      .select("id, name, pipeline")
      .eq("id", blueprint_id)
      .eq("organization_id", orgId)
      .single();
    if (error || !bp) throw new Error(`Blueprint not found: ${blueprint_id}`);
    if (bp.pipeline !== "instagram_carousel") throw new Error(`Blueprint ${bp.name} is not a carousel blueprint (pipeline: ${bp.pipeline})`);
    blueprintId = bp.id;
    blueprintName = bp.name;
  } else {
    // Find the most recent active carousel blueprint
    const { data: existingBlueprint } = await supabase
      .from("blueprints")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("pipeline", "instagram_carousel")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingBlueprint) {
      blueprintId = existingBlueprint.id;
      blueprintName = existingBlueprint.name;
    } else {
      // Create a minimal default carousel blueprint
      const { data: newBlueprint, error: bpError } = await supabase
        .from("blueprints")
        .insert({
          name: "Quick Carousel",
          description: "Default carousel blueprint",
          // The prompt writes the post; the slides are cut from that post.
          master_prompt: `Write the Instagram post that goes with a carousel about: {{idea}}\n\n{{custom_instructions}}\n\nOpen with one hook line that makes people swipe. Then give the key points in order, one short paragraph each, specific and useful. End with one clear call to action. Plain text, short lines, no markdown.`,
          pipeline: "instagram_carousel",
          model_config: {},
          structure: { slots: [{ key: "idea", label: "Topic", type: "text" }] },
          is_active: true,
          organization_id: orgId,
        })
        .select("id, name")
        .single();

      if (bpError || !newBlueprint) throw new Error("Failed to create default carousel blueprint");
      blueprintId = newBlueprint.id;
      blueprintName = newBlueprint.name;
    }
  }

  // Fetch brand voice if provided
  let brandVoice: Record<string, unknown> | null = null;
  if (brand_voice_id) {
    const { data, error } = await supabase
      .from("library_brand_voices")
      .select("*")
      .eq("id", brand_voice_id)
      .eq("organization_id", orgId)
      .single();
    if (error || !data) throw new Error(`Brand voice not found: ${brand_voice_id}`);
    brandVoice = data;
  }

  // Build output_config
  // Unset fields fall back to the blueprint's Look settings at dispatch.
  const outputConf: Record<string, unknown> = {};
  if (slideCount) outputConf.slideCount = slideCount;
  if (aspect_ratio) outputConf.aspectRatio = aspect_ratio;
  if (template) outputConf.carouselTemplate = template;
  if (custom_palette) outputConf.customPalette = custom_palette;

  // Build slot values — just the idea, not the full prompt
  const slotValues: Record<string, string> = {
    idea: ideaText,
    topic: ideaText,
    title: ideaText,
    context: ideaText,
    custom_instructions: custom_instructions || "",
  };

  // Build generation item with short idea_title
  const generationItems = [{
    id: "item_0",
    idea_id: null,
    idea_title: ideaText,
    slot_values: slotValues,
    library_elements: brandVoice ? { brand: [brandVoice] } : {},
    // Pass talking points as AI insights for the pipeline
    selected_ai_insights: talking_points?.length ? { talking_points } : undefined,
    status: "pending",
    outputs: null,
  }];

  const shouldAutoApprove = auto_approve !== false;

  // Create the generation job
  const { data: job, error: jobError } = await supabase
    .from("content_generation_jobs")
    .insert({
      organization_id: orgId,
      user_id: ctx.userId,
      blueprint_id: blueprintId,
      pipeline: "instagram_carousel",
      status: "queued",
      items: generationItems,
      configuration: {
        blueprint_name: blueprintName,
        pipeline: "instagram_carousel",
        model_config: {},
        output_config: outputConf,
        auto_approve_all: shouldAutoApprove,
      },
      progress: { total: 1, completed: 0, failed: 0 },
      cost: { estimated: 0.01, current: 0 },
    })
    .select()
    .single();

  if (jobError) {
    console.error("[MCP] Failed to create carousel generation job:", jobError.message);
    throw new Error("Failed to create carousel generation job");
  }

  // Dispatch the job
  const { error: dispatchError } = await supabase.functions.invoke("dispatch-generation-job", {
    body: { job_id: job.id },
  });
  if (dispatchError) {
    console.error("[MCP] Failed to dispatch carousel job:", dispatchError);
  }

  // If publish_to_ghl is set, schedule GHL publish after generation completes
  // The caller should use push_to_ghl separately after the job completes,
  // or we return the info they need to do so.
  const result: Record<string, unknown> = {
    job_id: job.id,
    status: "queued",
    pipeline: "instagram_carousel",
    blueprint: blueprintName,
    slide_count: slideCount ?? "blueprint default",
    auto_approve: shouldAutoApprove,
    message: `Carousel generation started for "${ideaText}" using blueprint "${blueprintName}". Use get_generation_job with job_id to check progress.${publish_to_ghl?.length ? ' Once complete, use push_to_ghl with the output ID to publish.' : ''}`,
  };

  if (publish_to_ghl?.length) {
    result.publish_to_ghl_accounts = publish_to_ghl;
    result.publish_hint = "After the job completes (status=completed), call push_to_ghl with the content_output_id from get_generation_job and these account_ids.";
  }

  return result;
}

async function listGenerationJobs(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { status, limit } = params as { status?: string; limit?: number };

  let query = supabase
    .from("content_generation_jobs")
    .select(`
      id,
      blueprint_id,
      pipeline,
      status,
      progress,
      cost,
      error,
      created_at,
      started_at,
      completed_at,
      blueprints:blueprint_id(name)
    `)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const resultLimit = limit || 20;
  query = query.limit(resultLimit);

  const { data: jobs, error } = await query;

  if (error) { console.error("[MCP] Failed to list generation jobs:", error.message); throw new Error("Failed to list generation jobs"); }

  // Transform to include blueprint name
  const transformedJobs = (jobs || []).map((job: Record<string, unknown>) => ({
    id: job.id,
    blueprint_id: job.blueprint_id,
    blueprint_name: (job.blueprints as { name: string } | null)?.name || "Unknown",
    pipeline: job.pipeline,
    status: job.status,
    progress: job.progress,
    cost: job.cost,
    error: job.error,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  }));

  return {
    jobs: transformedJobs,
    count: transformedJobs.length,
  };
}

async function getGenerationJob(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { job_id } = params as { job_id: string };

  if (!job_id) throw new Error("job_id is required");

  const { data: job, error } = await supabase
    .from("content_generation_jobs")
    .select(`
      *,
      blueprints:blueprint_id(id, name)
    `)
    .eq("id", job_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get generation job:", error.message); throw new Error("Failed to get generation job"); }

  return {
    job: {
      ...job,
      blueprint_name: (job.blueprints as { id: string; name: string } | null)?.name || "Unknown",
      blueprints: undefined,
    },
  };
}

// ============================================================================
// Autopilots
// ============================================================================

async function listAutopilots(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const { status } = params as { status?: string };

  let query = supabase
    .from("autopilots")
    .select("id, name, status, content_mix, ideas_source, frequency, scheduling_mode, destinations, last_run_at, next_run_at, total_generated, total_published, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data: autopilots, error } = await query;

  if (error) throw new Error(`Failed to list autopilots: ${error.message}`);

  return {
    autopilots: (autopilots || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      blueprint_count: a.content_mix?.length || 0,
      ideas_source: a.ideas_source,
      frequency: a.frequency,
      scheduling_mode: a.scheduling_mode,
      destination_count: a.destinations?.filter((d: any) => d.enabled).length || 0,
      last_run_at: a.last_run_at,
      next_run_at: a.next_run_at,
      total_generated: a.total_generated,
      total_published: a.total_published,
    })),
    total: autopilots?.length || 0,
  };
}

async function getAutopilot(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const { autopilot_id } = params as { autopilot_id: string };

  if (!autopilot_id) throw new Error("autopilot_id is required");

  const { data: autopilot, error } = await supabase
    .from("autopilots")
    .select("*")
    .eq("id", autopilot_id)
    .eq("organization_id", orgId)
    .single();

  if (error) throw new Error(`Failed to get autopilot: ${error.message}`);

  // Get pool stats
  const { data: poolStats } = await supabase
    .from("autopilot_idea_pools")
    .select("status")
    .eq("autopilot_id", autopilot_id);

  const stats = {
    total: poolStats?.length || 0,
    available: poolStats?.filter((p: any) => p.status === "available").length || 0,
    in_progress: poolStats?.filter((p: any) => p.status === "in_progress").length || 0,
    produced: poolStats?.filter((p: any) => p.status === "produced").length || 0,
    failed: poolStats?.filter((p: any) => p.status === "failed").length || 0,
  };

  // Get recent logs
  const { data: recentLogs } = await supabase
    .from("automation_logs")
    .select("event_type, details, created_at")
    .eq("autopilot_id", autopilot_id)
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    autopilot,
    pool_stats: stats,
    recent_logs: recentLogs || [],
  };
}

async function triggerAutopilot(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { autopilot_id } = params as { autopilot_id: string };

  if (!autopilot_id) throw new Error("autopilot_id is required");

  // Verify ownership
  const orgId = getEffectiveOrgId(ctx);
  const { data: autopilot, error: fetchError } = await supabase
    .from("autopilots")
    .select("id, organization_id")
    .eq("id", autopilot_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !autopilot) throw new Error("Autopilot not found or access denied");

  // Invoke trigger-autopilot edge function
  const { data, error } = await supabase.functions.invoke("trigger-autopilot", {
    body: { autopilot_id },
  });

  if (error) throw new Error(`Failed to trigger autopilot: ${error.message}`);

  return {
    success: data?.success || false,
    job_id: data?.job_id || null,
    details: data?.details || null,
    error: data?.error || null,
    message: data?.success
      ? `Autopilot triggered! Job ${data.job_id} created. Use get_generation_job to track progress.`
      : `Autopilot trigger failed: ${data?.error || "Unknown error"}`,
  };
}

// ============================================================================
// Autopilot CRUD & Pool Management
// ============================================================================

function calculateNextRunAtMCP(frequency: { amount: number; unit: string }): string {
  const now = new Date();
  const { amount, unit } = frequency;
  switch (unit) {
    case "hour":
      now.setTime(now.getTime() + amount * 60 * 60 * 1000);
      break;
    case "day":
      now.setTime(now.getTime() + amount * 24 * 60 * 60 * 1000);
      break;
    case "week":
      now.setTime(now.getTime() + amount * 7 * 24 * 60 * 60 * 1000);
      break;
    default:
      now.setTime(now.getTime() + 24 * 60 * 60 * 1000);
  }
  return now.toISOString();
}

/** First run: the first weekly slot (an hour early) on a schedule, else one interval from now. */
function firstRunAtMCP(schedule: AutopilotSchedule): string {
  if (schedule.scheduling_mode === "scheduled" && (schedule.schedule_slots?.length || schedule.scheduled_times?.length)) {
    return calculateNextRun(schedule).toISOString();
  }
  return calculateNextRunAtMCP(schedule.frequency);
}

/** Validate "plan each day" slots; pinned blueprints must be in the mix. */
function normalizeScheduleSlotsMCP(raw: unknown, mixBlueprintIds: Set<string>): ScheduleSlot[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) throw new Error("schedule_slots must be an array of {day, time, blueprint_id?}");
  return raw.map((slot: any, i: number) => {
    const day = Number(slot?.day);
    const time = String(slot?.time ?? "");
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error(`schedule_slots[${i}].day must be 0 (Sunday) to 6 (Saturday)`);
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`schedule_slots[${i}].time must be HH:MM`);
    const blueprintId = slot?.blueprint_id ? String(slot.blueprint_id) : null;
    if (blueprintId && !mixBlueprintIds.has(blueprintId)) {
      throw new Error(`schedule_slots[${i}].blueprint_id ${blueprintId} is not in content_mix`);
    }
    return { day, time: time.padStart(5, "0"), blueprint_id: blueprintId };
  });
}

async function createAutopilot(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const {
    name,
    content_mix,
    ideas_source,
    shared_idea_tags,
    frequency,
    scheduling_mode,
    timezone,
    scheduled_times,
    scheduled_days,
    schedule_slots,
    destinations,
    evergreen,
    auto_reload_pool,
  } = params as {
    name: string;
    content_mix: Array<{
      blueprint_id: string;
      weight: number;
      enabled?: boolean;
      idea_tags?: string[];
      library_elements?: Record<string, unknown>;
      video_config?: Record<string, unknown>;
      output_config?: Record<string, unknown>;
      media_source?: string;
    }>;
    ideas_source?: string;
    shared_idea_tags?: string[];
    frequency: { amount: number; unit: string };
    scheduling_mode?: string;
    timezone?: string;
    scheduled_times?: string[];
    scheduled_days?: number[];
    schedule_slots?: unknown;
    destinations: Array<{
      account_id: string;
      platform: string;
      enabled?: boolean;
      post_type?: string;
    }>;
    evergreen?: {
      enabled: boolean;
      min_age_days: number;
      max_reposts: number;
      variation_mode: string;
    };
    auto_reload_pool?: boolean;
  };

  // Validation
  if (!name || name.length < 2) throw new Error("name is required (min 2 characters)");
  if (!content_mix || !Array.isArray(content_mix) || content_mix.length === 0) {
    throw new Error(
      "content_mix is required and must contain at least one blueprint. Use list_blueprints to find blueprint IDs."
    );
  }
  if (!frequency || !frequency.amount || !frequency.unit) {
    throw new Error("frequency is required with amount and unit ('hour' | 'day' | 'week')");
  }
  if (!["hour", "day", "week"].includes(frequency.unit)) {
    throw new Error("frequency.unit must be 'hour', 'day', or 'week'");
  }
  if (!destinations || !Array.isArray(destinations) || destinations.length === 0) {
    throw new Error(
      "destinations is required with at least one publish destination. Use list_publishing_accounts to find account IDs."
    );
  }

  // Validate blueprint IDs exist in the org
  const blueprintIds = content_mix.map((item) => item.blueprint_id);
  const { data: blueprints, error: bpError } = await supabase
    .from("blueprints")
    .select("id, name")
    .in("id", blueprintIds)
    .eq("organization_id", orgId);

  if (bpError) throw new Error(`Failed to validate blueprints: ${bpError.message}`);
  const foundIds = new Set((blueprints || []).map((b: any) => b.id));
  const missingIds = blueprintIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Blueprint(s) not found: ${missingIds.join(", ")}. Use list_blueprints to find valid IDs.`
    );
  }

  // Normalize content_mix items (ensure enabled defaults to true)
  const normalizedMix = content_mix.map((item) => ({
    ...item,
    enabled: item.enabled !== false,
  }));

  const slots = normalizeScheduleSlotsMCP(schedule_slots, new Set(blueprintIds));
  const mode = (scheduling_mode || "optimal") as AutopilotSchedule["scheduling_mode"];
  const tz = timezone || "America/New_York";
  const nextRunAt = firstRunAtMCP({
    frequency: frequency as AutopilotSchedule["frequency"],
    scheduling_mode: mode,
    timezone: tz,
    scheduled_times: scheduled_times || null,
    scheduled_days: scheduled_days || null,
    schedule_slots: slots,
  });

  const insertData = {
    name,
    organization_id: orgId,
    created_by: ctx.userId,
    status: "active",
    content_mix: normalizedMix,
    ideas_source: ideas_source || "per_blueprint",
    shared_idea_tags: shared_idea_tags || null,
    frequency,
    scheduling_mode: mode,
    timezone: tz,
    scheduled_times: scheduled_times || (slots?.length ? [...new Set(slots.map((x) => x.time))].sort() : null),
    scheduled_days: scheduled_days || (slots?.length ? [...new Set(slots.map((x) => x.day))].sort() : null),
    schedule_slots: slots,
    destinations: destinations.map((d) => ({ ...d, enabled: d.enabled !== false })),
    evergreen: evergreen || null,
    auto_reload_pool: auto_reload_pool ?? false,
    next_run_at: nextRunAt,
    total_generated: 0,
    total_published: 0,
  };

  const { data: autopilot, error } = await supabase
    .from("autopilots")
    .insert(insertData)
    .select()
    .single();

  if (error) throw new Error(`Failed to create autopilot: ${error.message}`);

  // Auto-sync pool from tags
  let poolSyncResult = null;
  try {
    const { data: syncData } = await supabase.rpc("sync_autopilot_pool_from_tags", {
      p_autopilot_id: autopilot.id,
    });
    poolSyncResult = syncData;
  } catch (syncErr) {
    console.error("[MCP] Pool sync after create failed:", syncErr);
  }

  const blueprintNameMap = Object.fromEntries(
    (blueprints || []).map((b: any) => [b.id, b.name])
  );

  return {
    autopilot: {
      id: autopilot.id,
      name: autopilot.name,
      status: autopilot.status,
      next_run_at: autopilot.next_run_at,
    },
    content_mix_summary: normalizedMix.map((item) => ({
      blueprint: blueprintNameMap[item.blueprint_id] || item.blueprint_id,
      weight: item.weight,
      enabled: item.enabled,
      idea_tags: item.idea_tags || [],
    })),
    frequency: autopilot.frequency,
    scheduling_mode: autopilot.scheduling_mode,
    destination_count: destinations.filter((d) => d.enabled !== false).length,
    pool_sync:
      poolSyncResult && poolSyncResult.added > 0
        ? `Synced ${poolSyncResult.added} ideas to pool`
        : "No ideas matched tags (add ideas with matching tags, or use add_ideas_to_pool)",
    message: `Autopilot "${name}" created and activated! It will run every ${frequency.amount} ${frequency.unit}(s). Next run: ${nextRunAt}. Use trigger_autopilot to run immediately.`,
  };
}

async function updateAutopilot(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const autopilot_id = params.autopilot_id as string;
  if (!autopilot_id) throw new Error("autopilot_id is required");

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from("autopilots")
    .select("id, name, frequency, ideas_source, shared_idea_tags, content_mix, scheduling_mode, timezone, scheduled_times, scheduled_days, schedule_slots")
    .eq("id", autopilot_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !existing) throw new Error("Autopilot not found or access denied");

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  let tagsChanged = false;

  if (params.name !== undefined) updateData.name = params.name;
  if (params.status !== undefined) updateData.status = params.status;
  if (params.content_mix !== undefined) {
    updateData.content_mix = params.content_mix;
    tagsChanged = true;
  }
  if (params.ideas_source !== undefined) {
    updateData.ideas_source = params.ideas_source;
    tagsChanged = true;
  }
  if (params.shared_idea_tags !== undefined) {
    updateData.shared_idea_tags = params.shared_idea_tags;
    tagsChanged = true;
  }
  if (params.frequency !== undefined) {
    const freq = params.frequency as { amount: number; unit: string };
    if (!freq.amount || !freq.unit || !["hour", "day", "week"].includes(freq.unit)) {
      throw new Error("frequency must have amount and unit ('hour' | 'day' | 'week')");
    }
    updateData.frequency = freq;
    updateData.next_run_at = calculateNextRunAtMCP(freq);
  }
  if (params.scheduling_mode !== undefined) updateData.scheduling_mode = params.scheduling_mode;
  if (params.timezone !== undefined) updateData.timezone = params.timezone;
  if (params.scheduled_times !== undefined) updateData.scheduled_times = params.scheduled_times;
  if (params.scheduled_days !== undefined) updateData.scheduled_days = params.scheduled_days;
  if (params.schedule_slots !== undefined) {
    const mix = (params.content_mix ?? existing.content_mix ?? []) as Array<{ blueprint_id: string }>;
    const slots = normalizeScheduleSlotsMCP(params.schedule_slots, new Set(mix.map((m) => m.blueprint_id)));
    updateData.schedule_slots = slots;
    if (slots?.length) {
      if (params.scheduled_times === undefined) updateData.scheduled_times = [...new Set(slots.map((x) => x.time))].sort();
      if (params.scheduled_days === undefined) updateData.scheduled_days = [...new Set(slots.map((x) => x.day))].sort();
    }
  }
  // A changed weekly schedule starts from its next slot.
  const scheduleKeys = ["scheduling_mode", "timezone", "scheduled_times", "scheduled_days", "schedule_slots"];
  if (scheduleKeys.some((k) => updateData[k] !== undefined)) {
    const merged = { ...existing, ...updateData } as any;
    if (merged.scheduling_mode === "scheduled") {
      updateData.next_run_at = firstRunAtMCP({
        frequency: merged.frequency,
        scheduling_mode: "scheduled",
        timezone: merged.timezone || "UTC",
        scheduled_times: merged.scheduled_times,
        scheduled_days: merged.scheduled_days,
        schedule_slots: merged.schedule_slots,
      });
    }
  }
  if (params.destinations !== undefined) updateData.destinations = params.destinations;
  if (params.evergreen !== undefined) updateData.evergreen = params.evergreen;
  if (params.auto_reload_pool !== undefined) updateData.auto_reload_pool = params.auto_reload_pool;

  const { data: updated, error } = await supabase
    .from("autopilots")
    .update(updateData)
    .eq("id", autopilot_id)
    .select("id, name, status, frequency, next_run_at")
    .single();

  if (error) throw new Error(`Failed to update autopilot: ${error.message}`);

  // Re-sync pool if tag configuration changed
  let poolSyncResult = null;
  if (tagsChanged) {
    try {
      const { data: syncData } = await supabase.rpc("sync_autopilot_pool_from_tags", {
        p_autopilot_id: autopilot_id,
      });
      poolSyncResult = syncData;
    } catch (syncErr) {
      console.error("[MCP] Pool re-sync after update failed:", syncErr);
    }
  }

  return {
    autopilot: updated,
    fields_updated: Object.keys(updateData).filter((k) => k !== "updated_at"),
    pool_sync: poolSyncResult
      ? `Re-synced: ${poolSyncResult.added || 0} new ideas added to pool`
      : tagsChanged
        ? "Pool sync attempted but no new ideas matched"
        : "No tag changes, pool unchanged",
    message: `Autopilot "${updated.name}" updated successfully.`,
  };
}

async function deleteAutopilot(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const autopilot_id = params.autopilot_id as string;
  if (!autopilot_id) throw new Error("autopilot_id is required");

  const { data: existing, error: fetchError } = await supabase
    .from("autopilots")
    .select("id, name, status")
    .eq("id", autopilot_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !existing) throw new Error("Autopilot not found or access denied");

  const { error } = await supabase.from("autopilots").delete().eq("id", autopilot_id);

  if (error) throw new Error(`Failed to delete autopilot: ${error.message}`);

  return {
    deleted: true,
    autopilot_id,
    name: existing.name,
    message: `Autopilot "${existing.name}" deleted. All pool entries and automation logs have been removed.`,
  };
}

async function toggleAutopilotStatus(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const autopilot_id = params.autopilot_id as string;
  const status = params.status as string;

  if (!autopilot_id) throw new Error("autopilot_id is required");
  if (!status || !["active", "paused"].includes(status)) {
    throw new Error("status is required and must be 'active' or 'paused'");
  }

  const { data: existing, error: fetchError } = await supabase
    .from("autopilots")
    .select("id, name, frequency")
    .eq("id", autopilot_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !existing) throw new Error("Autopilot not found or access denied");

  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === "active" && existing.frequency) {
    updateData.next_run_at = calculateNextRunAtMCP(existing.frequency as any);
  }

  const { data: updated, error } = await supabase
    .from("autopilots")
    .update(updateData)
    .eq("id", autopilot_id)
    .select("id, name, status, next_run_at")
    .single();

  if (error) throw new Error(`Failed to update autopilot status: ${error.message}`);

  return {
    autopilot: updated,
    message:
      status === "active"
        ? `Autopilot "${existing.name}" activated! Next run at ${updated.next_run_at}.`
        : `Autopilot "${existing.name}" paused. No scheduled runs will occur until reactivated.`,
  };
}

async function listPublishingAccounts(
  supabase: SupabaseClient,
  ctx: AuthContext,
  _params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const allAccounts: Array<{
    account_id: string;
    platform: string;
    name: string;
    type: string;
    is_active: boolean;
    username?: string;
    avatar_url?: string;
  }> = [];
  const errors: Array<{ source: string; code: string; message: string }> = [];
  let ghlStatus: "ok" | "needs_oauth" | "needs_reconnect" | "fetch_failed" = "ok";

  // 1. Fetch GHL social media accounts
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const response = await fetch(`${supabaseUrl}/functions/v1/fetch-ghl-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ organizationId: orgId }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.success && Array.isArray(data.accounts)) {
        for (const acc of data.accounts) {
          allAccounts.push({
            account_id: acc.id,
            platform: acc.type || acc.platform || "unknown",
            name: acc.name || acc.displayName || "GHL Account",
            type: "ghl",
            is_active: acc.isActive !== false,
            username: acc.username,
            avatar_url: acc.profileImage,
          });
        }
      } else if (data?.needsOAuth) {
        ghlStatus = "needs_oauth";
        errors.push({
          source: "ghl",
          code: "needs_oauth",
          message: data.error || "LeadConnector OAuth not connected. Connect via Settings → Integrations.",
        });
      } else if (data?.needsReconnect) {
        ghlStatus = "needs_reconnect";
        errors.push({
          source: "ghl",
          code: "needs_reconnect",
          message: data.error || "LeadConnector token refresh failed — reconnect via Settings → Integrations.",
        });
      } else if (data?.error) {
        ghlStatus = "fetch_failed";
        errors.push({ source: "ghl", code: "error", message: String(data.error) });
      }
    } else {
      ghlStatus = "fetch_failed";
      const body = await response.text().catch(() => "");
      errors.push({
        source: "ghl",
        code: `http_${response.status}`,
        message: `fetch-ghl-accounts returned ${response.status}: ${body.slice(0, 200)}`,
      });
      console.error("[MCP] fetch-ghl-accounts non-ok:", response.status, body);
    }
  } catch (err) {
    ghlStatus = "fetch_failed";
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ source: "ghl", code: "exception", message });
    console.error("[MCP] Failed to fetch GHL accounts:", err);
  }

  // 2. Fetch WordPress sites
  const { data: wpSites } = await supabase
    .from("wordpress_sites")
    .select("id, name, site_url, is_active, is_valid")
    .eq("organization_id", orgId)
    .eq("is_active", true);

  for (const site of wpSites || []) {
    allAccounts.push({
      account_id: site.id,
      platform: "wordpress",
      name: site.name,
      type: "wordpress",
      is_active: site.is_active && site.is_valid,
    });
  }

  // Pick a message that reflects what actually happened, not just the empty
  // count — silent zero-count responses are how we ended up debugging from
  // customer screenshots.
  let message: string;
  if (allAccounts.length > 0) {
    message = `Found ${allAccounts.length} publishing account(s). Use account_id and platform values when setting autopilot destinations.`;
  } else if (ghlStatus === "needs_oauth") {
    message = "0 accounts. LeadConnector OAuth not connected — connect via Settings → Integrations.";
  } else if (ghlStatus === "needs_reconnect") {
    message = "0 accounts. LeadConnector token expired and refresh failed — reconnect via Settings → Integrations.";
  } else if (ghlStatus === "fetch_failed") {
    message = "0 accounts. Failed to query LeadConnector (see errors[]).";
  } else {
    message = "0 accounts. LeadConnector is connected but no social accounts are linked to this location, and no WordPress sites are configured.";
  }

  return {
    accounts: allAccounts,
    total: allAccounts.length,
    by_platform: allAccounts.reduce((acc: Record<string, number>, a) => {
      acc[a.platform] = (acc[a.platform] || 0) + 1;
      return acc;
    }, {}),
    errors,
    ghl_status: ghlStatus,
    message,
  };
}

async function syncAutopilotPool(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const autopilot_id = params.autopilot_id as string;
  if (!autopilot_id) throw new Error("autopilot_id is required");

  const { data: existing, error: fetchError } = await supabase
    .from("autopilots")
    .select("id, name")
    .eq("id", autopilot_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !existing) throw new Error("Autopilot not found or access denied");

  const { data: syncResult, error: syncError } = await supabase.rpc(
    "sync_autopilot_pool_from_tags",
    { p_autopilot_id: autopilot_id }
  );

  if (syncError) throw new Error(`Failed to sync pool: ${syncError.message}`);

  return {
    success: true,
    added: syncResult?.added || 0,
    message:
      syncResult?.added > 0
        ? `Added ${syncResult.added} new ideas to the pool for "${existing.name}".`
        : `Pool is already up to date for "${existing.name}". No new matching ideas found.`,
  };
}

async function addIdeasToPool(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const autopilot_id = params.autopilot_id as string;
  const idea_ids = params.idea_ids as string[];

  if (!autopilot_id) throw new Error("autopilot_id is required");
  if (!idea_ids || !Array.isArray(idea_ids) || idea_ids.length === 0) {
    throw new Error("idea_ids is required and must be a non-empty array of idea UUIDs");
  }

  const { data: existing, error: fetchError } = await supabase
    .from("autopilots")
    .select("id, name")
    .eq("id", autopilot_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !existing) throw new Error("Autopilot not found or access denied");

  // Verify ideas belong to same org
  const { data: ideas, error: ideasError } = await supabase
    .from("content_ideas")
    .select("id, title")
    .in("id", idea_ids)
    .eq("organization_id", orgId);

  if (ideasError) throw new Error(`Failed to validate ideas: ${ideasError.message}`);
  const foundIdeaIds = new Set((ideas || []).map((i: any) => i.id));
  const missingIds = idea_ids.filter((id) => !foundIdeaIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Idea(s) not found in your organization: ${missingIds.join(", ")}. Use list_ideas to find valid IDs.`
    );
  }

  const entries = idea_ids.map((ideaId) => ({
    autopilot_id,
    idea_id: ideaId,
    organization_id: orgId,
    status: "available",
    added_by: "api",
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("autopilot_idea_pools")
    .upsert(entries, {
      onConflict: "autopilot_id,idea_id",
      ignoreDuplicates: true,
    })
    .select("id, idea_id, status");

  if (insertError) throw new Error(`Failed to add ideas to pool: ${insertError.message}`);

  return {
    added: inserted?.length || 0,
    total_requested: idea_ids.length,
    duplicates_skipped: idea_ids.length - (inserted?.length || 0),
    message: `Added ${inserted?.length || 0} ideas to the pool for "${existing.name}".${
      idea_ids.length > (inserted?.length || 0)
        ? ` ${idea_ids.length - (inserted?.length || 0)} were already in the pool.`
        : ""
    }`,
  };
}

async function listPoolEntries(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const autopilot_id = params.autopilot_id as string;
  const status = params.status as string | undefined;
  const limit = Math.min(Number(params.limit) || 50, 200);

  if (!autopilot_id) throw new Error("autopilot_id is required");

  const { data: existing, error: fetchError } = await supabase
    .from("autopilots")
    .select("id, name")
    .eq("id", autopilot_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !existing) throw new Error("Autopilot not found or access denied");

  let query = supabase
    .from("autopilot_idea_pools")
    .select(
      `id, autopilot_id, idea_id, status, priority,
      produced_at, attempt_count, error_message,
      can_recycle, recycle_count, added_by, created_at,
      content_ideas:idea_id (id, title, content_framework, ai_analysis)`
    )
    .eq("autopilot_id", autopilot_id)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (status) {
    if (!["available", "in_progress", "produced", "failed", "skipped"].includes(status)) {
      throw new Error(
        "status must be one of: available, in_progress, produced, failed, skipped"
      );
    }
    query = query.eq("status", status);
  }

  const { data: entries, error } = await query;
  if (error) throw new Error(`Failed to list pool entries: ${error.message}`);

  // Get pool stats
  const { data: allStatuses } = await supabase
    .from("autopilot_idea_pools")
    .select("status")
    .eq("autopilot_id", autopilot_id);

  const stats = {
    total: allStatuses?.length || 0,
    available: allStatuses?.filter((p: any) => p.status === "available").length || 0,
    in_progress: allStatuses?.filter((p: any) => p.status === "in_progress").length || 0,
    produced: allStatuses?.filter((p: any) => p.status === "produced").length || 0,
    failed: allStatuses?.filter((p: any) => p.status === "failed").length || 0,
    skipped: allStatuses?.filter((p: any) => p.status === "skipped").length || 0,
  };

  const formattedEntries = (entries || []).map((entry: any) => ({
    id: entry.id,
    idea_id: entry.idea_id,
    idea_title: entry.content_ideas?.title || "Unknown",
    idea_talking_points: entry.content_ideas?.ai_analysis?.talking_points || [],
    status: entry.status,
    priority: entry.priority,
    attempt_count: entry.attempt_count,
    can_recycle: entry.can_recycle,
    recycle_count: entry.recycle_count,
    added_by: entry.added_by,
    error_message: entry.error_message,
    produced_at: entry.produced_at,
  }));

  return {
    autopilot_name: existing.name,
    pool_stats: stats,
    entries: formattedEntries,
    showing: formattedEntries.length,
    filter: status || "all",
  };
}

async function recycleAutopilotPool(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const autopilot_id = params.autopilot_id as string;
  const include_failed = params.include_failed === true;

  if (!autopilot_id) throw new Error("autopilot_id is required");

  const { data: existing, error: fetchError } = await supabase
    .from("autopilots")
    .select("id, name")
    .eq("id", autopilot_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !existing) throw new Error("Autopilot not found or access denied");

  const { data: recycleResult, error: recycleError } = await supabase.rpc(
    "recycle_autopilot_pool",
    {
      p_autopilot_id: autopilot_id,
      p_include_failed: include_failed,
    }
  );

  if (recycleError) throw new Error(`Failed to recycle pool: ${recycleError.message}`);

  return {
    success: true,
    recycled: recycleResult?.recycled || 0,
    include_failed,
    message:
      recycleResult?.recycled > 0
        ? `Recycled ${recycleResult.recycled} ${include_failed ? "(produced + failed)" : "produced"} ideas back to available for "${existing.name}".`
        : `No recyclable ideas found for "${existing.name}".`,
  };
}

// GHL (LeadConnector) Publishing
async function listGHLAccounts(
  supabase: SupabaseClient,
  ctx: AuthContext,
  _params: Record<string, unknown>
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);

  // Delegate to the existing fetch-ghl-accounts edge function
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const response = await fetch(`${supabaseUrl}/functions/v1/fetch-ghl-accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ organizationId: orgId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GHL accounts: ${response.status}`);
  }

  const data = await response.json();

  if (!data.success) {
    if (data.needsOAuth) {
      return {
        connected: false,
        error: "LeadConnector is not connected. The user needs to connect their GHL account via Settings → Integrations → LeadConnector.",
        accounts: [],
      };
    }
    if (data.needsReconnect) {
      return {
        connected: false,
        error: "LeadConnector OAuth token is expired. The user needs to reconnect via Settings → Integrations.",
        accounts: [],
      };
    }
    throw new Error(data.error || "Failed to fetch GHL accounts");
  }

  return {
    connected: true,
    location_id: data.locationId,
    ghl_user_id: data.ghlUserId,
    accounts: data.accounts,
    account_count: data.accounts.length,
  };
}

async function pushToGHL(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const {
    content_output_id,
    content_output_ids,
    account_ids,
    schedule_date,
    caption,
    post_type,
  } = params as {
    content_output_id?: string;
    content_output_ids?: string[];
    account_ids: string[];
    schedule_date?: string;
    caption?: string;
    post_type?: string;
  };

  // Validate: need at least one output ID
  const outputIds = content_output_ids || (content_output_id ? [content_output_id] : []);
  if (outputIds.length === 0) {
    throw new Error("content_output_id or content_output_ids is required");
  }
  if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
    throw new Error("account_ids is required (array of GHL social account IDs from list_ghl_accounts)");
  }

  const orgId = getEffectiveOrgId(ctx);
  // push-to-ghl reads outputs by id with the service key: they must belong to this org.
  await assertOwned(supabase, orgId, "content_outputs", outputIds, "Content output");

  // Build baseContent override if caption or post_type provided
  let baseContent: Record<string, unknown> | undefined;
  if (caption || post_type) {
    baseContent = {};
    if (caption) baseContent.caption = caption;
    if (post_type) baseContent.postType = post_type;
  }

  // Delegate to the existing push-to-ghl edge function
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const body: Record<string, unknown> = {
    contentOutputIds: outputIds,
    platforms: account_ids,
    organizationId: orgId,
  };
  if (schedule_date) body.scheduleDate = schedule_date;
  if (baseContent) body.baseContent = baseContent;

  const response = await fetch(`${supabaseUrl}/functions/v1/push-to-ghl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[MCP] push-to-ghl failed:", response.status, errorText);
    throw new Error(`Failed to push to GHL: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to push to GHL");
  }

  return {
    success: true,
    results: data.results,
    message: `Successfully published ${outputIds.length} output(s) to ${account_ids.length} account(s) via LeadConnector.`,
  };
}

// Fit Scoring
async function setProductICPFit(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { product_id, icp_id, fit_score, notes } = params;

  if (!product_id) throw new Error("product_id is required");
  if (!icp_id) throw new Error("icp_id is required");
  {
    const orgId = getEffectiveOrgId(ctx);
    await assertOwned(supabase, orgId, "library_products", [product_id as string], "Product");
    await assertOwned(supabase, orgId, "library_icps", [icp_id as string], "ICP");
  }

  const score = Number(fit_score) || 5;
  if (score < 1 || score > 10) {
    throw new Error("fit_score must be between 1 and 10");
  }

  const { data, error } = await supabase
    .from("product_icp_fit")
    .upsert({
      product_id,
      icp_id,
      fit_score: score,
      notes: notes || null,
    }, { onConflict: 'product_id,icp_id' })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to set product-ICP fit:", error.message); throw new Error("Failed to set product-ICP fit"); }

  return { fit: data };
}

async function getSuggestedICPs(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { product_ids } = params as { product_ids: string[] };

  if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
    throw new Error("product_ids array is required");
  }

  const { data, error } = await supabase.rpc('get_suggested_icps', {
    p_organization_id: getEffectiveOrgId(ctx),
    p_product_ids: product_ids,
  });

  if (error) { console.error("[MCP] Failed to get suggested ICPs:", error.message); throw new Error("Failed to get suggested ICPs"); }

  return { suggestions: data };
}

// Per-contact, per-product ICP scores. Distinct from product_icp_fit above (which
// scores a product against an ICP *definition*) — this is what analyze-company
// writes per contact and what campaign-processor's ICP gate actually reads.
async function listContactProductScores(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { contact_id, product_id, min_icp_score, limit: limitParam, offset: offsetParam } = params;

  if (!contact_id && !product_id) throw new Error("contact_id or product_id is required");

  const orgId = getEffectiveOrgId(ctx);
  const lim = typeof limitParam === "number" ? Math.min(limitParam, 500) : 50;
  const off = typeof offsetParam === "number" ? offsetParam : 0;

  const columns = "id, contact_id, product_id, icp_score, icp_score_reasoning, primary_need, primary_need_reasoning, selected_outcome, decision_maker_score, decision_maker_reasoning, decision_maker_source, analyzed_at, model, updated_at";

  let query = supabase
    .from("contact_product_scores")
    .select(columns)
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .range(off, off + lim - 1);
  let countQuery = supabase
    .from("contact_product_scores")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId);

  if (contact_id) { query = query.eq("contact_id", contact_id); countQuery = countQuery.eq("contact_id", contact_id); }
  if (product_id) { query = query.eq("product_id", product_id); countQuery = countQuery.eq("product_id", product_id); }
  if (typeof min_icp_score === "number") { query = query.gte("icp_score", min_icp_score); countQuery = countQuery.gte("icp_score", min_icp_score); }

  const [{ data: scores, error }, { count: total }] = await Promise.all([query, countQuery]);

  if (error) { console.error("[MCP] Failed to list contact product scores:", error.message); throw new Error("Failed to list contact product scores"); }

  return { scores: scores || [], total: total || 0, limit: lim, offset: off };
}

async function setContactProductScore(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const {
    contact_id, product_id, icp_score, icp_score_reasoning,
    primary_need, primary_need_reasoning, selected_outcome,
    decision_maker_score, decision_maker_reasoning, decision_maker_source, model,
  } = params;

  if (!contact_id) throw new Error("contact_id is required");
  if (!product_id) throw new Error("product_id is required");

  if (icp_score !== undefined && icp_score !== null) {
    const s = Number(icp_score);
    if (!Number.isFinite(s) || s < 0 || s > 100) throw new Error("icp_score must be between 0 and 100");
  }
  if (decision_maker_score !== undefined && decision_maker_score !== null) {
    const s = Number(decision_maker_score);
    if (!Number.isFinite(s) || s < 0 || s > 100) throw new Error("decision_maker_score must be between 0 and 100");
  }

  const orgId = getEffectiveOrgId(ctx);

  // organization_id on the row always comes from ctx, never the caller — but a
  // cross-org contact_id/product_id would still link two orgs' data together, so
  // verify both belong to this org before upserting.
  const [{ data: contact, error: contactError }, { data: product, error: productError }] = await Promise.all([
    supabase.from("crm_contacts").select("id").eq("id", contact_id).eq("organization_id", orgId).single(),
    supabase.from("library_products").select("id").eq("id", product_id).eq("organization_id", orgId).single(),
  ]);
  if (contactError || !contact) throw new Error("Contact not found");
  if (productError || !product) throw new Error("Product not found");

  const now = new Date().toISOString();
  const upsertData: Record<string, unknown> = {
    contact_id, product_id,
    organization_id: orgId,
    updated_at: now,
  };
  if (icp_score !== undefined) upsertData.icp_score = icp_score;
  if (icp_score_reasoning !== undefined) upsertData.icp_score_reasoning = icp_score_reasoning;
  if (primary_need !== undefined) upsertData.primary_need = primary_need;
  if (primary_need_reasoning !== undefined) upsertData.primary_need_reasoning = primary_need_reasoning;
  if (selected_outcome !== undefined) upsertData.selected_outcome = selected_outcome;
  if (decision_maker_score !== undefined) upsertData.decision_maker_score = decision_maker_score;
  if (decision_maker_reasoning !== undefined) upsertData.decision_maker_reasoning = decision_maker_reasoning;
  if (decision_maker_source !== undefined) upsertData.decision_maker_source = decision_maker_source;
  if (model !== undefined) upsertData.model = model;
  if (icp_score !== undefined || decision_maker_score !== undefined) upsertData.analyzed_at = now;

  const { data, error } = await supabase
    .from("contact_product_scores")
    .upsert(upsertData, { onConflict: "contact_id,product_id" })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to set contact product score:", error.message); throw new Error("Failed to set contact product score"); }

  return { score: data };
}

// Characters
async function listCharacters(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const { data: characters, error } = await supabase
    .from("library_characters")
    .select("*")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("name");

  if (error) { console.error("[MCP] Failed to list characters:", error.message); throw new Error("Failed to list characters"); }

  return { characters };
}

async function createCharacter(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const {
    name, description, visual_style, gender, age_range, build, ethnicity,
    hair_description, typical_clothing, personality, personality_traits,
    speaking_style, overall_tone, voice_selection, reference_image_urls,
    reference_image_data, tags, reference_images
  } = params;

  if (!name) throw new Error("name is required");

  const orgId = getEffectiveOrgId(ctx);

  // Handle reference images - support both URL array and base64 data
  let finalReferenceImages: string[] = [];

  // Add any direct URLs provided - upload to org storage if they're temporary URLs (e.g., from Replicate)
  if (reference_image_urls && Array.isArray(reference_image_urls)) {
    for (const url of reference_image_urls as string[]) {
      // Check if it's a temporary URL that needs to be uploaded to permanent storage
      if (url.includes('replicate.delivery') || url.includes('replicate.com')) {
        console.log(`[MCP] Uploading Replicate URL to org storage: ${url}`);
        const permanentUrl = await uploadImageToOrgStorage(supabase, orgId, url, 'character-images');
        finalReferenceImages.push(permanentUrl);
      } else {
        finalReferenceImages.push(url);
      }
    }
  }
  // Legacy support for reference_images field
  if (reference_images && Array.isArray(reference_images)) {
    for (const url of reference_images as string[]) {
      if (url.includes('replicate.delivery') || url.includes('replicate.com')) {
        console.log(`[MCP] Uploading Replicate URL to org storage: ${url}`);
        const permanentUrl = await uploadImageToOrgStorage(supabase, orgId, url, 'character-images');
        finalReferenceImages.push(permanentUrl);
      } else {
        finalReferenceImages.push(url);
      }
    }
  }

  // Handle base64 image uploads
  if (reference_image_data && Array.isArray(reference_image_data)) {
    for (const base64Data of reference_image_data) {
      try {
        // Parse base64 data URL or raw base64
        let base64Content = base64Data as string;
        let mimeType = 'image/png';

        if (base64Content.startsWith('data:')) {
          const matches = base64Content.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            mimeType = matches[1];
            base64Content = matches[2];
          }
        }

        // Convert base64 to Uint8Array
        const binaryStr = atob(base64Content);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        // Generate unique filename
        const ext = mimeType.split('/')[1] || 'png';
        const fileName = `${ctx.userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('character-images')
          .upload(fileName, bytes, { contentType: mimeType });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('character-images')
            .getPublicUrl(fileName);
          finalReferenceImages.push(urlData.publicUrl);
        }
      } catch (e) {
        console.error('Failed to upload image:', e);
      }
    }
  }

  const { data: character, error } = await supabase
    .from("library_characters")
    .insert({
      name,
      description: description || null,
      visual_style: visual_style || null,
      gender: gender || null,
      age_range: age_range || null,
      build: build || null,
      ethnicity: ethnicity || null,
      hair_description: hair_description || null,
      typical_clothing: typical_clothing || null,
      personality: personality || null,
      personality_traits: personality_traits || null,
      speaking_style: speaking_style || null,
      overall_tone: overall_tone || null,
      voice_selection: voice_selection || null,
      reference_images: finalReferenceImages.length > 0 ? finalReferenceImages : null,
      tags: tags || null,
      organization_id: getEffectiveOrgId(ctx),
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create character:", error.message); throw new Error("Failed to create character"); }

  return { character };
}

async function getCharacter(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { character_id } = params;

  if (!character_id) throw new Error("character_id is required");

  const { data: character, error } = await supabase
    .from("library_characters")
    .select("*")
    .eq("id", character_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get character:", error.message); throw new Error("Failed to get character"); }

  return { character };
}

async function updateCharacter(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { character_id, add_reference_image_urls, add_reference_image_data, remove_reference_image_urls, ...updates } = params;

  if (!character_id) throw new Error("character_id is required");

  const orgId = getEffectiveOrgId(ctx);

  const allowedFields = [
    "name", "description", "visual_style", "gender", "age_range", "build",
    "ethnicity", "hair_description", "typical_clothing", "personality",
    "personality_traits", "speaking_style", "overall_tone", "voice_selection",
    "reference_images", "reference_videos", "tags", "background"
  ];
  const cleanUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  // Handle image modifications
  if (add_reference_image_urls || add_reference_image_data || remove_reference_image_urls) {
    // Get current character to modify images
    const { data: current } = await supabase
      .from("library_characters")
      .select("reference_images")
      .eq("id", character_id)
      .eq("organization_id", orgId)
      .single();

    let currentImages: string[] = (current?.reference_images as string[]) || [];

    // Remove specified URLs
    if (remove_reference_image_urls && Array.isArray(remove_reference_image_urls)) {
      currentImages = currentImages.filter(url => !(remove_reference_image_urls as string[]).includes(url));
    }

    // Add new URLs - upload to org storage if they're temporary URLs (e.g., from Replicate)
    if (add_reference_image_urls && Array.isArray(add_reference_image_urls)) {
      for (const url of add_reference_image_urls as string[]) {
        if (url.includes('replicate.delivery') || url.includes('replicate.com')) {
          console.log(`[MCP] Uploading Replicate URL to org storage: ${url}`);
          const permanentUrl = await uploadImageToOrgStorage(supabase, orgId, url, 'character-images');
          currentImages.push(permanentUrl);
        } else {
          currentImages.push(url);
        }
      }
    }

    // Handle base64 uploads
    if (add_reference_image_data && Array.isArray(add_reference_image_data)) {
      for (const base64Data of add_reference_image_data) {
        try {
          let base64Content = base64Data as string;
          let mimeType = 'image/png';

          if (base64Content.startsWith('data:')) {
            const matches = base64Content.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              mimeType = matches[1];
              base64Content = matches[2];
            }
          }

          const binaryStr = atob(base64Content);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }

          const ext = mimeType.split('/')[1] || 'png';
          const fileName = `${ctx.userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from('character-images')
            .upload(fileName, bytes, { contentType: mimeType });

          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from('character-images')
              .getPublicUrl(fileName);
            currentImages.push(urlData.publicUrl);
          }
        } catch (e) {
          console.error('Failed to upload image:', e);
        }
      }
    }

    cleanUpdates.reference_images = currentImages.length > 0 ? currentImages : null;
  }

  if (Object.keys(cleanUpdates).length === 0) {
    throw new Error("No valid fields to update");
  }

  const { data: character, error } = await supabase
    .from("library_characters")
    .update(cleanUpdates)
    .eq("id", character_id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update character:", error.message); throw new Error("Failed to update character"); }

  return { character };
}

async function deleteCharacters(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { character_ids } = params as { character_ids: string[] };

  if (!character_ids || !Array.isArray(character_ids) || character_ids.length === 0) {
    throw new Error("character_ids array is required");
  }

  const { error } = await supabase
    .from("library_characters")
    .delete()
    .in("id", character_ids)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete characters:", error.message); throw new Error("Failed to delete characters"); }

  return { deleted: character_ids.length };
}

// Pipelines & Models (read-only reference data)
function listPipelines(): unknown {
  // Return available pipelines with their requirements
  const pipelines = [
    {
      id: "rich_article",
      name: "Rich Article",
      description: "Blogs, Newsletters, X Threads - Long-form text with optional images",
      required_models: ["text_llm"],
      optional_models: ["image_generator"],
      status: "available",
    },
    {
      id: "social_media_post",
      name: "Social Media Post",
      description: "Instagram, LinkedIn, X - Visual package with caption and hashtags",
      required_models: ["text_llm", "image_generator"],
      optional_models: [],
      status: "available",
    },
    {
      id: "image_only",
      name: "Image Only",
      description: "Generate images directly from a prompt template - No text generation, just visual output",
      required_models: ["image_generator"],
      optional_models: [],
      status: "available",
    },
    {
      id: "generative_video_oneshot",
      name: "Generative Video: One-Shot",
      description: "High-end World Simulation (Sora 2 / Veo) - Video, audio, physics in one pass",
      required_models: ["text_llm", "world_simulator"],
      optional_models: [],
      status: "available",
    },
    {
      id: "video_script",
      name: "Video Script",
      description: "Pre-Production - Formatted text for human production teams",
      required_models: ["text_llm"],
      optional_models: [],
      status: "available",
    },
    {
      id: "storyboard_video_longform",
      name: "Long-Form Storyboard Video",
      description: "Extended videos (5-10 min) with structured scenes, per-scene narration, and cinematic I2V motion",
      required_models: ["text_llm", "image_generator", "image_to_video", "tts"],
      optional_models: [],
      status: "available",
    },
    {
      id: "instagram_carousel",
      name: "Instagram Carousel",
      description: "Multi-slide carousel with consistent style - Perfect for educational content, tips, or storytelling",
      required_models: ["text_llm", "image_generator"],
      optional_models: [],
      status: "coming_soon",
    },
    {
      id: "ugc_video",
      name: "UGC Video",
      description: "Ads & Testimonials - Realistic videos/images with character and product references",
      required_models: ["text_llm", "tts"],
      optional_models: ["video_generator", "character_image_generator"],
      status: "coming_soon",
    },
  ];

  return {
    pipelines,
    note: "Use 'required_models' to know which model types must be configured in model_config when creating a blueprint",
  };
}

async function listVoices(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  // Fetch ElevenLabs voices from cache
  const { data: voices, error } = await supabase
    .from("elevenlabs_voices")
    .select("voice_id, name, category, labels, preview_url")
    .order("name");

  if (error) {
    // Return default voices if cache is empty
    return {
      voices: [
        { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade", labels: { accent: "american", gender: "female" } },
        { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", category: "premade", labels: { accent: "american", gender: "male" } },
        { voice_id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", category: "premade", labels: { accent: "american", gender: "female" } },
        { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", category: "premade", labels: { accent: "american", gender: "female" } },
        { voice_id: "ErXwobaYiN019PkySvjV", name: "Antoni", category: "premade", labels: { accent: "american", gender: "male" } },
        { voice_id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", category: "premade", labels: { accent: "american", gender: "female" } },
        { voice_id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", category: "premade", labels: { accent: "american", gender: "male" } },
        { voice_id: "VR6AewLTigWG4xSOukaG", name: "Arnold", category: "premade", labels: { accent: "american", gender: "male" } },
      ],
      note: "These are default voices. Configure ElevenLabs API key to see all available voices.",
    };
  }

  return {
    voices: voices || [],
    note: "Use voice_id in model_config.tts.parameters.voice_id when creating blueprints",
  };
}

async function listAvailableModels(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { model_type } = params as { model_type?: string };

  // Define model categories
  const modelCategories: Record<string, { provider: string; models: Array<{ id: string; name: string; recommended?: boolean }> }> = {
    text_llm: {
      provider: "openrouter",
      models: [
        { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", recommended: true },
        { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
        { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
        { id: "openai/gpt-4o", name: "GPT-4o" },
        { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
        { id: "anthropic/claude-3-haiku", name: "Claude 3 Haiku (fast)" },
      ],
    },
    image_generator: {
      provider: "openrouter",
      models: [
        { id: "google/gemini-3-pro-image-preview", name: "Nano Banana Pro (Gemini 3 Pro Image)", recommended: true },
        { id: "openai/gpt-5-image", name: "GPT-5 Image (best text rendering)", recommended: true },
        { id: "google/gemini-3.1-flash-image-preview", name: "Nano Banana 2 (Gemini 3.1 Flash Image)" },
        { id: "google/gemini-2.5-flash-image", name: "Nano Banana (Gemini 2.5 Flash Image)" },
        { id: "black-forest-labs/flux.2-pro", name: "FLUX.2 Pro" },
        { id: "openai/gpt-5-image-mini", name: "GPT-5 Image Mini" },
        { id: "bytedance-seed/seedream-4.5", name: "Seedream 4.5" },
      ],
    },
    tts: {
      provider: "elevenlabs",
      models: [
        { id: "eleven_alpha_3", name: "Eleven Alpha 3", recommended: true },
        { id: "eleven_multilingual_v2", name: "Eleven Multilingual v2" },
        { id: "eleven_turbo_v2_5", name: "Eleven Turbo v2.5" },
        { id: "eleven_turbo_v2", name: "Eleven Turbo v2" },
      ],
    },
    image_to_video: {
      provider: "replicate",
      models: [
        { id: "kwaivgi/kling-v2.5-turbo-pro", name: "Kling v2.5 Turbo Pro", recommended: true },
        { id: "bytedance/seedance-1-pro-fast", name: "Seedance 1 Pro Fast" },
        { id: "wan-video/wan-2.5-i2v", name: "Wan 2.5 I2V" },
        { id: "bytedance/seedance-1-lite", name: "Seedance 1 Lite" },
      ],
    },
    world_simulator: {
      provider: "replicate",
      models: [
        { id: "google/veo-3.1", name: "Veo 3.1", recommended: true },
        { id: "openai/sora", name: "Sora" },
        { id: "google/veo-2", name: "Veo 2" },
      ],
    },
    face_swap: {
      provider: "replicate",
      models: [
        { id: "deepfacelab/faceswap", name: "DeepFaceLab" },
      ],
    },
  };

  // image_generator: keep static OpenRouter list (replicate_models DB has Replicate IDs;
  // serving those here re-introduces the bug where MCP callers create blueprints with
  // provider="replicate" + model_id="google/nano-banana-pro" — an OpenRouter model name
  // that doesn't exist on Replicate and silently bills the wrong provider.

  if (model_type === "image_to_video" || !model_type) {
    const { data: dbI2VModels } = await supabase
      .from("replicate_models")
      .select("model_id, display_name, description")
      .eq("category", "image-to-video")
      .eq("is_enabled", true)
      .order("display_name");

    if (dbI2VModels && dbI2VModels.length > 0) {
      modelCategories.image_to_video.models = dbI2VModels.map((m: { model_id: string; display_name: string }) => ({
        id: m.model_id,
        name: m.display_name,
        recommended: m.model_id.includes("wan-2.5"),
      }));
    }
  }

  if (model_type === "world_simulator" || !model_type) {
    const { data: dbT2VModels } = await supabase
      .from("replicate_models")
      .select("model_id, display_name, description")
      .eq("category", "text-to-video")
      .eq("is_enabled", true)
      .order("display_name");

    if (dbT2VModels && dbT2VModels.length > 0) {
      modelCategories.world_simulator.models = dbT2VModels.map((m: { model_id: string; display_name: string }) => ({
        id: m.model_id,
        name: m.display_name,
        recommended: m.model_id.includes("veo-3"),
      }));
    }
  }

  // Filter by model_type if specified
  if (model_type) {
    if (!modelCategories[model_type]) {
      throw new Error(`Unknown model_type: ${model_type}. Valid types: ${Object.keys(modelCategories).join(", ")}`);
    }
    return {
      model_type,
      ...modelCategories[model_type],
    };
  }

  return {
    model_types: modelCategories,
    note: "Use these models in the model_config when creating blueprints. Set provider and model_id for each required model type.",
  };
}

function getBlueprintSchema(): unknown {
  return {
    description: "Complete schema for creating blueprints with prompts, variables, and model configuration",
    blueprint_structure: {
      name: "string (required) - Human-readable name for the blueprint",
      description: "string (optional) - Description of what this blueprint does",
      pipeline: "string (required) - One of: rich_article, social_media_post, image_only, generative_video_oneshot, video_script, storyboard_video_longform",
      master_prompt: "string (required for most pipelines) - The main prompt template with {{variables}}",
      image_prompt: "string (required for image_only, optional for others) - Prompt template for image generation",
      structure: {
        slots: "Array of slot definitions extracted from prompts. Usually auto-generated from {{variable}} patterns.",
      },
      model_config: "Object mapping model types to their configuration. Keys are model types (text_llm, image_generator, etc.)",
      tags: "string[] (optional) - Tags for organization",
      reference_image_libraries: "string[] (optional) - Library types for reference images: library_products, library_characters, library_brand_voices",
      is_active: "boolean (default: true) - Whether blueprint is active",
    },
    prompt_variables: {
      description: "Variables in prompts use {{variable_name}} syntax",
      types: {
        text_slots: "Simple text values: {{topic}}, {{title}}, {{description}}, {{context}}",
        library_element_fields: "Reference library data: {{product.name}}, {{brand.tone}}, {{character.speaking_style}}, {{icp.pain_points}}",
        ai_insights: "AI-generated insights: {{ai_hooks}}, {{ai_talking_points}}, {{ai_ctas}}, {{ai_script_structure}}",
        idea_data: "From content ideas: {{idea}}, {{keywords}}, {{emotional_triggers}}",
        optional: "Use {{?variable}} for optional variables that won't error if missing",
        video_context: "Video-specific: {{scene_count}}, {{video_duration}}, {{video_duration_minutes}}, {{scene_duration}}",
        output_config: "Output settings: {{outputConfig.slideCount}}, {{outputConfig.aspectRatio}}",
      },
      library_prefixes: {
        "product": "library_products - Product name, description, features, key_benefits, images",
        "brand": "library_brand_voices - Brand name, tone, style_guidelines, mood_keywords",
        "character": "library_characters - Character name, personality, speaking_style, reference_images",
        "icp": "library_icps - ICP name, pain_points, desires, objections, language_style",
        "block": "library_blocks - Reusable content blocks (hooks, angles, CTAs)",
      },
    },
    model_config_structure: {
      description: "Configure AI models for each stage of the pipeline",
      example: {
        text_llm: {
          provider: "openrouter",
          model_id: "anthropic/claude-sonnet-4.5",
          parameters: { temperature: 0.7, max_tokens: 2000 },
        },
        image_generator: {
          provider: "openrouter",
          model_id: "google/gemini-3-pro-image-preview",
          parameters: { aspect_ratio: "16:9" },
        },
        tts: {
          provider: "elevenlabs",
          model_id: "eleven_multilingual_v2",
          parameters: { voice_id: "21m00Tcm4TlvDq8ikWAM", stability: 0.5, similarity_boost: 0.75 },
        },
        image_to_video: {
          provider: "replicate",
          model_id: "kwaivgi/kling-v2.5-turbo-pro",
          parameters: {},
        },
      },
      model_types: {
        text_llm: "For text generation (articles, scripts, captions)",
        image_generator: "For creating images from prompts",
        tts: "Text-to-speech for voiceovers",
        image_to_video: "I2V models for animating images",
        world_simulator: "T2V models for generating video from text",
        face_swap: "For face replacement in videos",
      },
    },
    generation_parameters: {
      description: "Parameters passed when triggering content generation (not in blueprint, but in trigger_content_generation)",
      video_config: {
        totalDuration: "number - Total video duration in seconds (30, 60, 90, 120, 180, 300, 420, 600)",
        aspectRatio: "string - 'landscape' (16:9), 'portrait' (9:16), or 'square' (1:1)",
        sceneDuration: "number - Duration per scene: 4, 6, 8, or 12 seconds",
        note: "sceneCount is auto-calculated as totalDuration / sceneDuration",
      },
      output_config: {
        aspectRatio: "string - 'landscape', 'portrait', or 'square'",
        slideCount: "number - For carousels: 3-10 slides",
      },
      model_parameters: {
        text_llm: {
          temperature: "number (0.0-2.0) - Creativity level. 0.7 default for creative content",
          max_tokens: "number - Maximum output tokens (1000-4000 typical)",
          top_p: "number (0.0-1.0) - Nucleus sampling threshold",
        },
        image_generator: {
          aspect_ratio: "string - '1:1', '16:9', '9:16', '4:5', '3:2', '21:9', etc.",
          resolution_tier: "string - 'SD' (512px), 'HD' (1024px), 'FHD' (1920px), 'UHD' (2560px)",
          steps: "number - Inference steps (more = higher quality, slower)",
          guidance: "number - Prompt adherence (1-20, typically 7-8)",
          seed: "number - For reproducible results",
          negative_prompt: "string - What to exclude from image",
        },
        tts: {
          voice_id: "string - ElevenLabs voice UUID",
          stability: "number (0.0-1.0) - Voice consistency",
          similarity_boost: "number (0.0-1.0) - How closely to match selected voice",
          style: "number - Voice style variation",
          use_speaker_boost: "boolean - Enhanced speaker clarity",
        },
      },
    },
    aspect_ratios: {
      description: "Available aspect ratios for images and videos",
      options: {
        "1:1": "Square (1024x1024 at HD)",
        "16:9": "Landscape/Widescreen (1920x1080 at FHD)",
        "9:16": "Portrait/Vertical (1080x1920 at FHD) - Instagram Reels, TikTok",
        "4:5": "Instagram Feed portrait",
        "4:3": "Standard landscape",
        "3:2": "Classic photo ratio",
        "21:9": "Ultra-wide cinematic",
      },
    },
    video_duration_presets: {
      short_form: [30, 60, 90, 120],
      long_form: [180, 300, 420, 600],
      scene_durations: [4, 6, 8, 12],
      note: "For storyboard_video_longform, scenes are ~5s each by default (auto-calculated from voiceover duration)",
    },
    example_blueprints: [
      {
        name: "LinkedIn Post Generator",
        description: "Generate engaging LinkedIn posts with images",
        pipeline: "social_media_post",
        master_prompt: "Write a compelling LinkedIn post about {{topic}}.\n\nBrand voice: {{brand.tone}}\nTarget audience: {{icp.pain_points}}\n\nKey points to cover:\n- {{ai_talking_points}}\n\nInclude a strong {{ai_hooks}} at the beginning and end with a clear {{ai_ctas}}.",
        image_prompt: "Professional, clean image representing {{topic}}. Style: {{brand.style_guidelines}}. Modern business aesthetic.",
        model_config: {
          text_llm: { provider: "openrouter", model_id: "anthropic/claude-sonnet-4.5", parameters: { temperature: 0.7 } },
          image_generator: { provider: "openrouter", model_id: "google/gemini-3.1-flash-image-preview", parameters: { aspect_ratio: "1:1" } },
        },
      },
      {
        name: "Long-Form Video Blueprint",
        description: "Generate 2-minute storyboard videos with voiceover",
        pipeline: "storyboard_video_longform",
        master_prompt: "Create a {{scene_count}}-scene video about {{topic}}.\n\nTotal duration: {{video_duration}} seconds.\nEach scene: {{scene_duration}} seconds.\n\nBrand: {{brand.tone}}\nStyle: {{brand.style_guidelines}}",
        image_prompt: "Cinematic scene for {{topic}}. Style: {{brand.style_guidelines}}. High quality, professional.",
        model_config: {
          text_llm: { provider: "openrouter", model_id: "anthropic/claude-sonnet-4.5", parameters: { temperature: 0.7, max_tokens: 3000 } },
          image_generator: { provider: "openrouter", model_id: "google/gemini-3.1-flash-image-preview", parameters: { aspect_ratio: "16:9" } },
          tts: { provider: "elevenlabs", model_id: "eleven_multilingual_v2", parameters: { voice_id: "21m00Tcm4TlvDq8ikWAM" } },
          image_to_video: { provider: "replicate", model_id: "kwaivgi/kling-v2.5-turbo-pro", parameters: {} },
        },
        note: "When triggering, pass video_config: { totalDuration: 120, aspectRatio: 'landscape' }",
      },
      {
        name: "Product Showcase Image",
        description: "Generate product images with brand styling",
        pipeline: "image_only",
        image_prompt: "{{product.name}} product photography. {{product.description}}. Style: {{brand.style_guidelines}}. Professional, high-quality product shot.",
        model_config: {
          image_generator: { provider: "openrouter", model_id: "google/gemini-3.1-flash-image-preview", parameters: { aspect_ratio: "4:5" } },
        },
      },
    ],
  };
}

// Prompt Templates
async function listPromptTemplates(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  let query = supabase
    .from("prompt_library")
    .select("id, name, description, prompt_type, pipeline_type, category, created_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("name");

  if (params.prompt_type) {
    query = query.eq("prompt_type", params.prompt_type);
  }

  if (params.pipeline_type) {
    query = query.eq("pipeline_type", params.pipeline_type);
  }

  const { data: templates, error } = await query;

  if (error) { console.error("[MCP] Failed to list prompt templates:", error.message); throw new Error("Failed to list prompt templates"); }

  return { templates };
}

async function createPromptTemplate(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name, prompt_content, prompt_type, description, category, pipeline_type } = params;

  if (!name) throw new Error("name is required");
  if (!prompt_content) throw new Error("prompt_content is required");

  const { data: template, error } = await supabase
    .from("prompt_library")
    .insert({
      name,
      prompt_content,
      prompt_type: prompt_type || "text",
      description: description || null,
      category: category || null,
      pipeline_type: pipeline_type || null,
      organization_id: getEffectiveOrgId(ctx),
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create prompt template:", error.message); throw new Error("Failed to create prompt template"); }

  return { template };
}

async function getPromptTemplate(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { template_id } = params;

  if (!template_id) throw new Error("template_id is required");

  const { data: template, error } = await supabase
    .from("prompt_library")
    .select("*")
    .eq("id", template_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get prompt template:", error.message); throw new Error("Failed to get prompt template"); }

  return { template };
}

// ============================================================================
// AI Agent Profile Handlers
// ============================================================================

async function listAgentProfiles(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const { data: profiles, error } = await supabase
    .from("ai_agent_profiles")
    .select("id, name, description, config, is_default, created_by, created_at, updated_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("is_default", { ascending: false })
    .order("name");

  if (error) { console.error("[MCP] Failed to list agent profiles:", error.message); throw new Error("Failed to list agent profiles"); }

  return { agent_profiles: profiles };
}

async function getAgentProfile(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { profile_id } = params;

  if (!profile_id) throw new Error("profile_id is required");

  const { data: profile, error } = await supabase
    .from("ai_agent_profiles")
    .select("*")
    .eq("id", profile_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get agent profile:", error.message); throw new Error("Failed to get agent profile"); }

  return { agent_profile: profile };
}

async function createAgentProfile(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name, description, config, is_default } = params;

  if (!name) throw new Error("name is required");

  const orgId = getEffectiveOrgId(ctx);

  // Sensible defaults matching frontend DEFAULT_CONFIG
  const defaultConfig = {
    enabled: true,
    rules: [
      { intent: "interested", action: "auto_reply" },
      { intent: "neutral", action: "auto_reply" },
      { intent: "out_of_office", action: "auto_followup_after_return" },
      { intent: "not_interested", action: "auto_reply" },
    ],
    require_approval: true,
    max_auto_replies: 10,
    max_conversation_turns: 10,
  };

  const mergedConfig = config
    ? { ...defaultConfig, ...(config as Record<string, unknown>) }
    : defaultConfig;

  // If setting as default, clear existing default first
  if (is_default) {
    await supabase
      .from("ai_agent_profiles")
      .update({ is_default: false })
      .eq("organization_id", orgId)
      .eq("is_default", true);
  }

  const { data: profile, error } = await supabase
    .from("ai_agent_profiles")
    .insert({
      organization_id: orgId,
      name,
      description: description || null,
      config: mergedConfig,
      is_default: is_default || false,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create agent profile:", error.message); throw new Error("Failed to create agent profile"); }

  return { agent_profile: profile };
}

async function updateAgentProfile(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { profile_id, ...updates } = params;

  if (!profile_id) throw new Error("profile_id is required");

  const allowedFields = ["name", "description", "config"];
  const cleanUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  if (Object.keys(cleanUpdates).length === 0) {
    throw new Error("No valid fields to update. Allowed: name, description, config");
  }

  const { data: profile, error } = await supabase
    .from("ai_agent_profiles")
    .update(cleanUpdates)
    .eq("id", profile_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update agent profile:", error.message); throw new Error("Failed to update agent profile"); }

  return { agent_profile: profile };
}

async function deleteAgentProfiles(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { profile_ids } = params as { profile_ids: string[] };

  if (!profile_ids || !Array.isArray(profile_ids) || profile_ids.length === 0) {
    throw new Error("profile_ids array is required");
  }

  const { error } = await supabase
    .from("ai_agent_profiles")
    .delete()
    .in("id", profile_ids)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete agent profiles:", error.message); throw new Error("Failed to delete agent profiles"); }

  return { deleted: profile_ids.length };
}

async function setDefaultAgentProfile(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { profile_id } = params;

  if (!profile_id) throw new Error("profile_id is required");

  const orgId = getEffectiveOrgId(ctx);

  // Clear existing default
  await supabase
    .from("ai_agent_profiles")
    .update({ is_default: false })
    .eq("organization_id", orgId)
    .eq("is_default", true);

  // Set new default
  const { data: profile, error } = await supabase
    .from("ai_agent_profiles")
    .update({ is_default: true })
    .eq("id", profile_id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to set default profile:", error.message); throw new Error("Failed to set default profile"); }

  return { agent_profile: profile };
}

// ============================================================================
// Knowledge Base Document Handlers
// ============================================================================

async function listKnowledgeDocuments(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { status } = params;

  let query = supabase
    .from("knowledge_base_documents")
    .select("id, name, description, file_type, file_size_bytes, status, processing_error, chunk_count, created_at, updated_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false });

  if (status && typeof status === "string") {
    query = query.eq("status", status);
  }

  const { data: documents, error } = await query;

  if (error) { console.error("[MCP] Failed to list knowledge documents:", error.message); throw new Error("Failed to list knowledge documents"); }

  return { knowledge_documents: documents };
}

async function getKnowledgeDocument(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { document_id } = params;

  if (!document_id) throw new Error("document_id is required");

  const { data: document, error } = await supabase
    .from("knowledge_base_documents")
    .select("id, name, description, file_type, file_size_bytes, status, processing_error, chunk_count, created_at, updated_at")
    .eq("id", document_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get knowledge document:", error.message); throw new Error("Failed to get knowledge document"); }

  return { knowledge_document: document };
}

async function createKnowledgeDocument(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name, description, content } = params;

  if (!name) throw new Error("name is required");
  if (!content) throw new Error("content is required (text content for the document)");
  if (typeof content !== "string") throw new Error("content must be a string");

  const orgId = getEffectiveOrgId(ctx);
  const contentBytes = new TextEncoder().encode(content as string);

  // Storage path: org_id/timestamp_sanitized_name.txt
  const timestamp = Date.now();
  const safeName = (name as string).replace(/[^a-zA-Z0-9.\-]/g, "_").slice(0, 50);
  const filePath = `${orgId}/${timestamp}_${safeName}.txt`;

  // Upload .txt file to knowledge-base storage bucket
  const { error: uploadError } = await supabase.storage
    .from("knowledge-base")
    .upload(filePath, contentBytes, {
      contentType: "text/plain",
      upsert: false,
    });

  if (uploadError) {
    console.error("[MCP] Failed to upload document:", uploadError.message);
    throw new Error("Failed to upload document");
  }

  // Create document record
  const { data: document, error: insertError } = await supabase
    .from("knowledge_base_documents")
    .insert({
      organization_id: orgId,
      name,
      description: description || null,
      file_path: filePath,
      file_type: "txt",
      file_size_bytes: contentBytes.length,
      status: "pending",
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (insertError) {
    // Clean up uploaded file on insert failure
    await supabase.storage.from("knowledge-base").remove([filePath]);
    console.error("[MCP] Failed to create document record:", insertError.message);
    throw new Error("Failed to create document record");
  }

  // Trigger processing (fire-and-forget)
  supabase.functions.invoke("process-knowledge-document", {
    body: { documentId: document.id },
  }).catch((err: Error) => {
    console.error(`[MCP] Knowledge document processing trigger failed for ${document.id}:`, err);
  });

  return {
    knowledge_document: {
      id: document.id,
      name: document.name,
      description: document.description,
      file_type: document.file_type,
      file_size_bytes: document.file_size_bytes,
      status: document.status,
      chunk_count: document.chunk_count,
      created_at: document.created_at,
    },
    message: "Document created and processing started. Use get_knowledge_document to check processing status.",
  };
}

async function deleteKnowledgeDocuments(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { document_ids } = params as { document_ids: string[] };

  if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
    throw new Error("document_ids array is required");
  }

  const orgId = getEffectiveOrgId(ctx);

  // Get file paths for storage cleanup
  const { data: documents } = await supabase
    .from("knowledge_base_documents")
    .select("id, file_path")
    .in("id", document_ids)
    .eq("organization_id", orgId);

  // Delete document records (chunks deleted via CASCADE)
  const { error } = await supabase
    .from("knowledge_base_documents")
    .delete()
    .in("id", document_ids)
    .eq("organization_id", orgId);

  if (error) { console.error("[MCP] Failed to delete knowledge documents:", error.message); throw new Error("Failed to delete knowledge documents"); }

  // Clean up storage files (best effort)
  if (documents && documents.length > 0) {
    const filePaths = documents
      .map((d: { file_path: string | null }) => d.file_path)
      .filter(Boolean) as string[];

    if (filePaths.length > 0) {
      supabase.storage.from("knowledge-base").remove(filePaths).catch((err: Error) => {
        console.error("[MCP] Failed to clean up knowledge base files:", err);
      });
    }
  }

  return { deleted: document_ids.length };
}

// ============================================================================
// Lead Magnet Campaign Handlers
// ============================================================================

async function enrichCampaignWithStats(
  supabase: SupabaseClient,
  campaign: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const campaignId = campaign.id as string;

  const [totalLeads, dmSent, dmPending, monitoredPosts, autoAccounts, knowledgeDocs] = await Promise.all([
    supabase.from("unipile_leads").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId),
    supabase.from("unipile_leads").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "dm_sent"),
    supabase.from("unipile_leads").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "pending"),
    supabase.from("unipile_monitored_posts").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("is_active", true),
    supabase.from("unipile_campaign_auto_accounts").select("account_id").eq("campaign_id", campaignId),
    supabase.from("campaign_knowledge_documents").select("document_id").eq("campaign_id", campaignId),
  ]);

  return {
    ...campaign,
    auto_add_posts_account_ids: (autoAccounts.data || []).map((a: { account_id: string }) => a.account_id),
    knowledge_document_ids: (knowledgeDocs.data || []).map((d: { document_id: string }) => d.document_id),
    stats: {
      total_leads: totalLeads.count || 0,
      dm_sent: dmSent.count || 0,
      dm_pending: dmPending.count || 0,
      monitored_posts: monitoredPosts.count || 0,
    },
  };
}

async function listLeadMagnetCampaigns(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const { data: campaigns, error } = await supabase
    .from("unipile_campaigns")
    .select(`*, account:unipile_accounts(id, provider, display_name, username, status)`)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false });

  if (error) { console.error("[MCP] Failed to list campaigns:", error.message); throw new Error("Failed to list campaigns"); }

  const enriched = await Promise.all(
    (campaigns || []).map((c: Record<string, unknown>) => enrichCampaignWithStats(supabase, c))
  );

  return { lead_magnet_campaigns: enriched };
}

async function getLeadMagnetCampaign(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { campaign_id } = params;

  if (!campaign_id) throw new Error("campaign_id is required");

  const { data: campaign, error } = await supabase
    .from("unipile_campaigns")
    .select(`*, account:unipile_accounts(id, provider, display_name, username, status)`)
    .eq("id", campaign_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get campaign:", error.message); throw new Error("Failed to get campaign"); }

  const enriched = await enrichCampaignWithStats(supabase, campaign);

  return { lead_magnet_campaign: enriched };
}

async function createLeadMagnetCampaign(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const {
    account_id, name, trigger_keywords, dm_template,
    // ICP
    icp_id, icp_threshold,
    // AI chatbot
    ai_chatbot_enabled, ai_chatbot_instructions, ai_chatbot_brand_voice_id,
    ai_chatbot_model, ai_chatbot_max_turns, ai_chatbot_handoff_keywords,
    // Auto-add posts
    auto_add_posts, auto_add_posts_account_ids,
    // Knowledge docs
    knowledge_document_ids,
    // Agent profile
    agent_profile_id,
    // Limits
    dm_delay_seconds, max_dms_per_hour, max_dms_per_day, user_cooldown_hours,
    // Other
    auto_accept_connections, webhook_url,
    // Lead magnet delivery
    lead_magnet_url, lead_magnet_title, require_connection_for_linkedin, comment_link_mode,
    comment_reply_templates, ai_mode,
  } = params;

  if (!account_id) throw new Error("account_id is required");
  if (!name) throw new Error("name is required");
  if (!trigger_keywords) throw new Error("trigger_keywords is required");

  const orgId = getEffectiveOrgId(ctx);

  // DM queue and comment poller join the account by id only: it must be this org's account.
  await assertOwned(supabase, orgId, "unipile_accounts",
    [account_id as string, ...(Array.isArray(auto_add_posts_account_ids) ? auto_add_posts_account_ids as string[] : [])],
    "LinkedIn account");

  const { data: campaign, error } = await supabase
    .from("unipile_campaigns")
    .insert({
      organization_id: orgId,
      account_id,
      name,
      trigger_keywords,
      dm_template: dm_template || "",
      dm_delay_seconds: dm_delay_seconds ?? 30,
      max_dms_per_hour: max_dms_per_hour ?? 10,
      max_dms_per_day: max_dms_per_day ?? 50,
      user_cooldown_hours: user_cooldown_hours ?? 24,
      webhook_url: webhook_url || null,
      auto_accept_connections: auto_accept_connections ?? true,
      // Lead magnet delivery
      lead_magnet_url: lead_magnet_url || null,
      lead_magnet_title: lead_magnet_title || null,
      require_connection_for_linkedin: require_connection_for_linkedin ?? true,
      comment_link_mode: comment_link_mode || "gated",
      // Leave the column default (LinkedIn connect replies) unless the caller set them.
      ...(Array.isArray(comment_reply_templates) && comment_reply_templates.length > 0 ? { comment_reply_templates } : {}),
      ai_mode: ai_mode || "chatbot_only",
      is_active: true,
      // ICP
      icp_id: icp_id || null,
      icp_threshold: icp_threshold ?? 0,
      // AI chatbot
      ai_chatbot_enabled: ai_chatbot_enabled ?? false,
      ai_chatbot_instructions: ai_chatbot_instructions || null,
      ai_chatbot_brand_voice_id: ai_chatbot_brand_voice_id || null,
      ai_chatbot_model: ai_chatbot_model || DEFAULT_CHATBOT_MODEL,
      ai_chatbot_max_turns: ai_chatbot_max_turns ?? 10,
      ai_chatbot_handoff_keywords: ai_chatbot_handoff_keywords || [],
      // Auto-add posts
      auto_add_posts: auto_add_posts ?? false,
      // Agent profile
      agent_profile_id: agent_profile_id || null,
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create campaign:", error.message); throw new Error("Failed to create campaign"); }

  // Manage auto-add accounts junction table
  if (auto_add_posts && Array.isArray(auto_add_posts_account_ids) && (auto_add_posts_account_ids as string[]).length > 0) {
    const rows = (auto_add_posts_account_ids as string[]).map(accountId => ({
      campaign_id: campaign.id,
      account_id: accountId,
    }));
    await supabase.from("unipile_campaign_auto_accounts").insert(rows);
  }

  // Manage knowledge documents junction table
  if (Array.isArray(knowledge_document_ids) && (knowledge_document_ids as string[]).length > 0) {
    const rows = (knowledge_document_ids as string[]).map(documentId => ({
      campaign_id: campaign.id,
      document_id: documentId,
    }));
    await supabase.from("campaign_knowledge_documents").insert(rows);
  }

  return { lead_magnet_campaign: campaign };
}

async function updateLeadMagnetCampaign(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { campaign_id, auto_add_posts_account_ids, knowledge_document_ids, ...updates } = params;

  if (!campaign_id) throw new Error("campaign_id is required");

  const allowedFields = [
    "name", "trigger_keywords", "dm_template",
    "dm_delay_seconds", "max_dms_per_hour", "max_dms_per_day", "user_cooldown_hours",
    "webhook_url", "auto_accept_connections",
    "lead_magnet_url", "lead_magnet_title", "require_connection_for_linkedin", "comment_link_mode",
    "icp_id", "icp_threshold",
    "ai_chatbot_enabled", "ai_chatbot_instructions", "ai_chatbot_brand_voice_id",
    "ai_chatbot_model", "ai_chatbot_max_turns", "ai_chatbot_handoff_keywords",
    "auto_add_posts", "agent_profile_id",
    "comment_reply_templates", "ai_mode",
  ];

  const cleanUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  const orgId = getEffectiveOrgId(ctx);

  if (Array.isArray(auto_add_posts_account_ids)) {
    await assertOwned(supabase, orgId, "unipile_accounts", auto_add_posts_account_ids as string[], "LinkedIn account");
  }

  const { data: campaign, error } = await supabase
    .from("unipile_campaigns")
    .update(cleanUpdates)
    .eq("id", campaign_id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update campaign:", error.message); throw new Error("Failed to update campaign"); }

  // Sync auto-add accounts junction table
  if (auto_add_posts_account_ids !== undefined) {
    await supabase.from("unipile_campaign_auto_accounts").delete().eq("campaign_id", campaign_id);

    if (Array.isArray(auto_add_posts_account_ids) && (auto_add_posts_account_ids as string[]).length > 0) {
      const rows = (auto_add_posts_account_ids as string[]).map(accountId => ({
        campaign_id: campaign.id,
        account_id: accountId,
      }));
      await supabase.from("unipile_campaign_auto_accounts").insert(rows);
    }
  }

  // Sync knowledge documents junction table
  if (knowledge_document_ids !== undefined) {
    await supabase.from("campaign_knowledge_documents").delete().eq("campaign_id", campaign_id);

    if (Array.isArray(knowledge_document_ids) && (knowledge_document_ids as string[]).length > 0) {
      const rows = (knowledge_document_ids as string[]).map(documentId => ({
        campaign_id: campaign.id,
        document_id: documentId,
      }));
      await supabase.from("campaign_knowledge_documents").insert(rows);
    }
  }

  return { lead_magnet_campaign: campaign };
}

async function deleteLeadMagnetCampaign(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { campaign_id } = params;

  if (!campaign_id) throw new Error("campaign_id is required");

  const { error } = await supabase
    .from("unipile_campaigns")
    .delete()
    .eq("id", campaign_id)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete campaign:", error.message); throw new Error("Failed to delete campaign"); }

  return { deleted: true };
}

async function toggleLeadMagnetCampaign(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { campaign_id, is_active } = params;

  if (!campaign_id) throw new Error("campaign_id is required");
  if (is_active === undefined) throw new Error("is_active is required");

  const { data: campaign, error } = await supabase
    .from("unipile_campaigns")
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq("id", campaign_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to toggle campaign:", error.message); throw new Error("Failed to toggle campaign"); }

  return { lead_magnet_campaign: campaign };
}

async function listCampaignLeads(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { campaign_id, status, limit: limitParam, offset: offsetParam } = params;

  if (!campaign_id) throw new Error("campaign_id is required");

  // Verify campaign belongs to org
  const { error: campaignError } = await supabase
    .from("unipile_campaigns")
    .select("id")
    .eq("id", campaign_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (campaignError) { console.error("[MCP] Campaign not found:", campaignError.message); throw new Error("Campaign not found"); }

  let query = supabase
    .from("unipile_leads")
    .select("id, campaign_id, commenter_id, commenter_name, commenter_profile_url, comment_text, matched_keyword, status, dm_sent_at, captured_at, icp_score, icp_score_reasoning, ai_conversation_active, ai_conversation_turn_count, ai_handoff_requested")
    .eq("campaign_id", campaign_id)
    .order("captured_at", { ascending: false });

  if (status && typeof status === "string") {
    query = query.eq("status", status);
  }

  const lim = typeof limitParam === "number" ? Math.min(limitParam, 10000) : 50;
  const off = typeof offsetParam === "number" ? offsetParam : 0;

  let countQuery = supabase
    .from("unipile_leads")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign_id);
  if (status && typeof status === "string") countQuery = countQuery.eq("status", status);

  query = query.range(off, off + lim - 1);

  const [{ data: leads, error }, { count: total }] = await Promise.all([query, countQuery]);

  if (error) { console.error("[MCP] Failed to list campaign leads:", error.message); throw new Error("Failed to list campaign leads"); }

  return { leads, total: total || 0, limit: lim, offset: off };
}

// ============================================================================
// Email Sequence Handlers
// ============================================================================

const DEFAULT_SEQUENCE_SETTINGS = {
  mailbox_ids: [],
  stop_on_reply: true,
  stop_on_auto_reply: true,
  stop_company_on_reply: false,
  open_tracking: false,
  click_tracking: true,
  custom_tracking_domain: null,
  daily_limit: 30,
  max_new_leads_per_day: null,
  min_time_gap_minutes: 9,
  random_additional_minutes: 5,
  prioritize_new_leads: false,
  send_window: { start: "08:00", end: "18:00" },
  timezone: "America/New_York",
  skip_weekends: true,
  provider_matching: false,
  esp_routing_rules: [],
  auto_optimize_ab: false,
  ab_winning_metric: "reply_rate",
  ab_sample_size: 100,
  ai_filter_unlikely_reply: "send",
  ai_filter_hostile: "send",
  first_email_text_only: false,
  sisr_enabled: false,
  hypersend_mode: false,
  limit_per_company_domain: null,
  unsubscribe_header: true,
  allow_risky_emails: false,
  cc: [],
  bcc: [],
  owner_id: null,
  tags: [],
};

// Keep pool lookups beneath the PostgREST URL limit. Large mailbox pools are
// normal for agency accounts, and a failed/oversized `.in()` request must never
// silently turn a configured sender pool into null enrollment assignments.
const MAILBOX_POOL_QUERY_CHUNK = 150;

async function getReadyMailboxIds(
  supabase: SupabaseClient,
  organizationId: string,
  configuredMailboxIds?: string[],
): Promise<string[]> {
  const fetchChunk = async (mailboxIds?: string[]) => {
    let query = supabase
      .from("email_mailboxes")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status", "ready")
      .eq("imap_connected", true);
    if (mailboxIds?.length) query = query.in("id", mailboxIds);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to resolve sequence mailboxes: ${error.message}`);
    return (data || []).map((mailbox: { id: string }) => mailbox.id);
  };

  if (!configuredMailboxIds?.length) return fetchChunk();

  const mailboxIds: string[] = [];
  for (let i = 0; i < configuredMailboxIds.length; i += MAILBOX_POOL_QUERY_CHUNK) {
    mailboxIds.push(...await fetchChunk(configuredMailboxIds.slice(i, i + MAILBOX_POOL_QUERY_CHUNK)));
  }
  return mailboxIds;
}

async function listEmailSequences(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const { data: sequences, error } = await supabase
    .from("email_sequences")
    .select("id, name, status, source_type, steps, settings, created_at, updated_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false });

  if (error) { console.error("[MCP] Failed to list email sequences:", error.message); throw new Error("Failed to list email sequences"); }

  const compact = (sequences || []).map((s: Record<string, unknown>) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    source_type: s.source_type,
    step_count: Array.isArray(s.steps) ? (s.steps as unknown[]).length : 0,
    mailbox_count: Array.isArray((s.settings as Record<string, unknown>)?.mailbox_ids) ? ((s.settings as Record<string, unknown>).mailbox_ids as unknown[]).length : 0,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));

  return { email_sequences: compact };
}

async function getEmailSequence(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { sequence_id } = params;

  if (!sequence_id) throw new Error("sequence_id is required");

  const { data: sequence, error } = await supabase
    .from("email_sequences")
    .select("*")
    .eq("id", sequence_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error) { console.error("[MCP] Failed to get email sequence:", error.message); throw new Error("Failed to get email sequence"); }

  return { email_sequence: sequence };
}

async function createEmailSequence(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name, steps, settings, campaign_id } = params;

  if (!name) throw new Error("name is required");

  // tracking_domain_id and lead_list_id are real columns on email_sequences,
  // not settings JSON fields — accept them either top-level or nested in
  // `settings` (callers commonly nest them, mirroring the object the UI
  // settings panel edits) but always persist to the column. Leaving them
  // buried in settings.* is a silent no-op: the sender/processor only ever
  // reads sequence.tracking_domain_id / sequence.lead_list_id directly.
  const rawSettings = settings ? { ...(settings as Record<string, unknown>) } : {};
  const trackingDomainId = (params.tracking_domain_id ?? rawSettings.tracking_domain_id ?? null) as string | null;
  const leadListId = (params.lead_list_id ?? rawSettings.lead_list_id ?? null) as string | null;
  // auto_enroll_new_members is ALSO a real column — the every-15-min
  // discovery-auto-enroll-sequences cron filters on
  // `es.auto_enroll_new_members = TRUE`, never on settings JSON. Leaving it
  // in settings is a silent no-op that makes list-attached sequences enroll
  // nobody.
  const autoEnrollNewMembers = (params.auto_enroll_new_members ?? rawSettings.auto_enroll_new_members ?? false) as boolean;
  delete rawSettings.tracking_domain_id;
  delete rawSettings.lead_list_id;
  delete rawSettings.auto_enroll_new_members;

  const mergedSettings = { ...DEFAULT_SEQUENCE_SETTINGS, ...rawSettings };

  const { data: sequence, error } = await supabase
    .from("email_sequences")
    .insert({
      organization_id: getEffectiveOrgId(ctx),
      name,
      steps: steps || [],
      settings: mergedSettings,
      status: "draft",
      source_type: "manual",
      campaign_id: campaign_id || null,
      tracking_domain_id: trackingDomainId,
      lead_list_id: leadListId,
      auto_enroll_new_members: autoEnrollNewMembers === true,
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create email sequence:", error.message); throw new Error("Failed to create email sequence"); }

  return { email_sequence: sequence };
}

async function updateEmailSequence(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { sequence_id, name, steps, status, settings, autopilot_config } = params;

  if (!sequence_id) throw new Error("sequence_id is required");

  const orgId = getEffectiveOrgId(ctx);
  const updateData: Record<string, unknown> = {};

  if (name !== undefined) updateData.name = name;
  if (steps !== undefined) updateData.steps = steps;
  if (status !== undefined) updateData.status = status;
  if (autopilot_config !== undefined) updateData.autopilot_config = autopilot_config;

  // tracking_domain_id / lead_list_id are real columns, not settings JSON
  // fields — accept top-level or nested in settings, always write to the
  // column (see createEmailSequence for why settings.* is a dead end here).
  if (params.tracking_domain_id !== undefined) updateData.tracking_domain_id = params.tracking_domain_id;
  if (params.lead_list_id !== undefined) updateData.lead_list_id = params.lead_list_id;
  // Real column, read by the auto-enroll cron — see createEmailSequence.
  if (params.auto_enroll_new_members !== undefined) updateData.auto_enroll_new_members = params.auto_enroll_new_members === true;

  // Merge settings with existing (partial update)
  if (settings !== undefined) {
    const rawSettings = { ...(settings as Record<string, unknown>) };
    if (rawSettings.tracking_domain_id !== undefined) {
      updateData.tracking_domain_id = rawSettings.tracking_domain_id;
      delete rawSettings.tracking_domain_id;
    }
    if (rawSettings.lead_list_id !== undefined) {
      updateData.lead_list_id = rawSettings.lead_list_id;
      delete rawSettings.lead_list_id;
    }
    if (rawSettings.auto_enroll_new_members !== undefined) {
      updateData.auto_enroll_new_members = rawSettings.auto_enroll_new_members === true;
      delete rawSettings.auto_enroll_new_members;
    }

    const { data: existing } = await supabase
      .from("email_sequences")
      .select("settings")
      .eq("id", sequence_id)
      .eq("organization_id", orgId)
      .single();

    const existingSettings = { ...((existing?.settings as Record<string, unknown>) || DEFAULT_SEQUENCE_SETTINGS) };
    // Scrub column-backed keys a prior (pre-fix) update may have buried in
    // settings JSON, so stored settings can't disagree with the columns.
    delete existingSettings.tracking_domain_id;
    delete existingSettings.lead_list_id;
    delete existingSettings.auto_enroll_new_members;
    updateData.settings = { ...existingSettings, ...rawSettings };
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error("No valid fields to update");
  }

  const { data: sequence, error } = await supabase
    .from("email_sequences")
    .update(updateData)
    .eq("id", sequence_id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update email sequence:", error.message); throw new Error("Failed to update email sequence"); }

  return { email_sequence: sequence };
}

async function deleteEmailSequence(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { sequence_id } = params;

  if (!sequence_id) throw new Error("sequence_id is required");

  const { error } = await supabase
    .from("email_sequences")
    .delete()
    .eq("id", sequence_id)
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete email sequence:", error.message); throw new Error("Failed to delete email sequence"); }

  return { deleted: true };
}

/**
 * Duplicate a sequence, optionally with its audience.
 *
 * Delegates to the duplicate-email-sequence edge function rather than
 * re-implementing the copy here: it owns re-minting A/B variant ids (a verbatim
 * copy would steal the original's email_ab_variants rows and their stats) and
 * running copied enrollments through the shared admission guards. A second
 * implementation is a second set of rules — see the enrollment-guards header.
 */
async function duplicateEmailSequence(
  _supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { sequence_id, name, copy_lead_lists, copy_enrolled_leads } = params;

  if (!sequence_id) throw new Error("sequence_id is required");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const organizationId = getEffectiveOrgId(ctx);

  const callFn = async (fn: string, body: Record<string, unknown>) => {
    const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (payload as { error?: string } | null)?.error ?? `${res.status}`;
      console.error(`[MCP] ${fn} failed:`, res.status, message);
      throw new Error(`${fn} failed: ${message}`);
    }
    return payload;
  };

  const dup = await callFn("duplicate-email-sequence", {
    sequenceId: sequence_id,
    organizationId,
    name: name ?? undefined,
    copyLeadLists: copy_lead_lists === true,
  }) as { sequence: { id: string } };

  if (copy_enrolled_leads !== true) {
    return { email_sequence: dup.sequence };
  }

  // The audience is a second call by design, and a paged one: enroll-leads
  // works a bounded slice per request (the platform kills a request at 150s),
  // so loop until the source is exhausted. Every page is durable on its own.
  const totals = {
    enrolled: 0,
    suppressed: 0,
    alreadyInAnotherSequence: 0,
    noEmail: 0,
    leadsWithoutContact: 0,
  };
  let offset = 0;
  // Backstop against a cursor that never reports done: 1000 pages is a million
  // leads, far past any real sequence.
  for (let page = 0; page < 1000; page++) {
    const res = await callFn("enroll-leads", {
      sequenceId: dup.sequence.id,
      organizationId,
      sourceSequenceId: sequence_id,
      sourceOffset: offset,
    }) as {
      enrolled?: number;
      suppressed?: number;
      alreadyInAnotherSequence?: number;
      noEmail?: number;
      leadsWithoutContact?: number;
      sourceCursor?: { offset: number; done: boolean };
    };

    totals.enrolled += res.enrolled ?? 0;
    totals.suppressed += res.suppressed ?? 0;
    totals.alreadyInAnotherSequence += res.alreadyInAnotherSequence ?? 0;
    totals.noEmail += res.noEmail ?? 0;
    totals.leadsWithoutContact += res.leadsWithoutContact ?? 0;

    if (!res.sourceCursor || res.sourceCursor.done) break;
    offset = res.sourceCursor.offset;
  }

  return {
    email_sequence: dup.sequence,
    enrolled: totals.enrolled,
    skipped_suppressed: totals.suppressed,
    skipped_active_in_another_sequence: totals.alreadyInAnotherSequence,
    skipped_no_email: totals.noEmail,
    skipped_no_crm_contact: totals.leadsWithoutContact,
  };
}

async function toggleEmailSequence(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { sequence_id, status } = params;

  if (!sequence_id) throw new Error("sequence_id is required");
  if (!status || !["active", "paused"].includes(status as string)) {
    throw new Error("status must be 'active' or 'paused'");
  }

  const { data: sequence, error } = await supabase
    .from("email_sequences")
    .update({ status })
    .eq("id", sequence_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to toggle email sequence:", error.message); throw new Error("Failed to toggle email sequence"); }

  return { email_sequence: sequence };
}

async function listEmailEnrollments(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { sequence_id, status, limit: limitParam, offset: offsetParam } = params;

  if (!sequence_id) throw new Error("sequence_id is required");

  // Verify sequence belongs to org
  const { error: seqError } = await supabase
    .from("email_sequences")
    .select("id")
    .eq("id", sequence_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (seqError) { console.error("[MCP] Sequence not found:", seqError.message); throw new Error("Sequence not found"); }

  let query = supabase
    .from("email_sequence_enrollments")
    .select("id, sequence_id, lead_id, current_step, status, next_send_at, mailbox_id, variant_assignments, custom_data, created_at, updated_at")
    .eq("sequence_id", sequence_id)
    .order("created_at", { ascending: false });

  if (status && typeof status === "string") {
    query = query.eq("status", status);
  }

  const lim = typeof limitParam === "number" ? Math.min(limitParam, 10000) : 50;
  const off = typeof offsetParam === "number" ? offsetParam : 0;

  let countQuery = supabase
    .from("email_sequence_enrollments")
    .select("*", { count: "exact", head: true })
    .eq("sequence_id", sequence_id);
  if (status && typeof status === "string") countQuery = countQuery.eq("status", status);

  query = query.range(off, off + lim - 1);

  const [{ data: enrollments, error }, { count: total }] = await Promise.all([query, countQuery]);

  if (error) { console.error("[MCP] Failed to list enrollments:", error.message); throw new Error("Failed to list enrollments"); }

  // Enrich with lead info
  if (enrollments && enrollments.length > 0) {
    const leadIds = [...new Set(enrollments.map((e: Record<string, unknown>) => e.lead_id as string))];

    // Chunk the .in() — PostgREST encodes ids into the URL query string, so a
    // large id set (e.g. a 2,585-enrollment sequence) blows past the Deno edge
    // runtime's URL limit and the request errors out. selectInChunks batches at
    // 50 ids; without it (and with the error swallowed) every row hydrated null.
    let leads: Record<string, unknown>[] = [];
    try {
      leads = await selectInChunks<Record<string, unknown>>(
        supabase,
        "leads",
        "id, first_name, last_name, email, company, job_title",
        "id",
        leadIds,
      );
    } catch (e) {
      console.error("[MCP] Failed to hydrate enrollment leads:", e instanceof Error ? e.message : String(e));
      throw new Error("Failed to hydrate enrollment leads");
    }

    const leadMap = new Map((leads || []).map((l: Record<string, unknown>) => [l.id, l]));

    const enriched = enrollments.map((e: Record<string, unknown>) => {
      const lead = leadMap.get(e.lead_id as string) as Record<string, unknown> | undefined;
      return {
        ...e,
        lead_name: lead ? `${lead.first_name || ""} ${lead.last_name || ""}`.trim() : null,
        lead_email: lead?.email || null,
        lead_company: lead?.company || null,
        lead_position: lead?.job_title || null,
      };
    });

    return { enrollments: enriched, total: total || 0, limit: lim, offset: off };
  }

  return { enrollments: [], total: total || 0, limit: lim, offset: off };
}

async function enrollLeads(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { sequence_id, lead_ids, continue_from_conversation_id } = params;

  if (!sequence_id) throw new Error("sequence_id is required");
  if (!lead_ids || !Array.isArray(lead_ids) || (lead_ids as string[]).length === 0) {
    throw new Error("lead_ids array is required");
  }

  const orgId = getEffectiveOrgId(ctx);

  // Verify sequence belongs to org (settings needed for mailbox pre-assignment)
  const { data: seqRow, error: seqError } = await supabase
    .from("email_sequences")
    .select("id, settings")
    .eq("id", sequence_id)
    .eq("organization_id", orgId)
    .single();

  if (seqError || !seqRow) { console.error("[MCP] Sequence not found:", seqError?.message); throw new Error("Sequence not found"); }

  // `lead_ids` may hold either leads.id OR crm_contacts.id — callers routinely pass
  // contact ids straight out of list_contacts/search_contacts_and_leads. If we insert
  // those verbatim as enrollment.lead_id, the row points nowhere: the live sender only
  // ever resolves recipients via `.from('leads').eq('id', lead_id)` and silently skips
  // (no error, no mailbox assignment, no send) when that lookup misses. Resolve any id
  // that isn't already a lead into its leads mirror, creating one if needed — mirrors
  // the crm_contact→leads resolution the enroll-leads edge function already does.
  const inputIds = [...new Set((lead_ids as string[]).filter(Boolean))];

  const existingLeads = await selectInChunks<{ id: string }>(
    supabase, "leads", "id", "id", inputIds,
    (q) => q.eq("organization_id", orgId),
  );
  const knownLeadIds = new Set(existingLeads.map(l => l.id));
  const maybeContactIds = inputIds.filter(id => !knownLeadIds.has(id));

  const resolvedLeadIds: string[] = inputIds.filter(id => knownLeadIds.has(id));
  let noEmailCount = 0;
  let unresolvedCount = 0;

  if (maybeContactIds.length > 0) {
    const contacts = await selectInChunks<{
      id: string; first_name: string | null; last_name: string | null;
      primary_email: string | null; company: string | null; job_title: string | null;
      primary_linkedin_url: string | null;
    }>(
      supabase, "crm_contacts",
      "id, first_name, last_name, primary_email, company, job_title, primary_linkedin_url",
      "id", maybeContactIds,
      (q) => q.eq("organization_id", orgId),
    );
    const contactMap = new Map(contacts.map(c => [c.id, c]));
    const validContactIds = contacts.filter(c => c.primary_email).map(c => c.id);
    noEmailCount = contacts.length - validContactIds.length;
    unresolvedCount = maybeContactIds.length - contacts.length;

    const existingMirrors = await selectInChunks<{ id: string; source_id: string }>(
      supabase, "leads", "id, source_id", "source_id", validContactIds,
      (q) => q.eq("organization_id", orgId).eq("source", "crm_contact"),
    );
    const sourceToLeadId = new Map(existingMirrors.map(l => [l.source_id, l.id]));

    const toCreate = validContactIds
      .filter(id => !sourceToLeadId.has(id))
      .map(id => {
        const c = contactMap.get(id)!;
        return {
          organization_id: orgId,
          email: c.primary_email,
          first_name: c.first_name || null,
          last_name: c.last_name || null,
          company: c.company || null,
          job_title: c.job_title || null,
          linkedin_url: c.primary_linkedin_url || null,
          source: "crm_contact",
          source_id: id,
        };
      });

    if (toCreate.length > 0) {
      const { data: newLeads, error: createErr } = await supabase
        .from("leads")
        .insert(toCreate)
        .select("id, source_id");
      if (createErr) { console.error("[MCP] Failed to create mirror leads:", createErr.message); throw new Error("Failed to create lead records for contacts"); }
      for (const l of newLeads || []) sourceToLeadId.set(l.source_id, l.id);
    }

    for (const contactId of validContactIds) {
      const leadId = sourceToLeadId.get(contactId);
      if (leadId) resolvedLeadIds.push(leadId);
    }
  }

  let dedupedLeadIds = [...new Set(resolvedLeadIds)];
  if (dedupedLeadIds.length === 0) {
    return { enrolled: 0, sequence_id, no_email: noEmailCount, unresolved: unresolvedCount };
  }

  // Admission guards — identical to the enroll-leads edge function, via the
  // shared module. This path used to have NEITHER, so an agent could enroll a
  // contact that had unsubscribed or hard-bounced, and could put a lead into a
  // second concurrent sequence that the exclusivity rule forbids elsewhere. A
  // guarantee enforced on only one of two enrollment paths is not a guarantee.
  const suppressedLeadIds = await findSuppressedLeadIds(supabase, orgId, dedupedLeadIds);
  let suppressedCount = 0;
  if (suppressedLeadIds.size > 0) {
    const before = dedupedLeadIds.length;
    dedupedLeadIds = dedupedLeadIds.filter((id) => !suppressedLeadIds.has(id));
    suppressedCount = before - dedupedLeadIds.length;
  }

  // A thread continuation is concurrent BY DESIGN (an interested-reply follow-up
  // threads into the conversation the first sequence opened), so it is exempt.
  const continuing = typeof continue_from_conversation_id === "string" && !!continue_from_conversation_id;
  let concurrentSkipped = 0;
  if (!continuing && dedupedLeadIds.length > 0) {
    const busy = await findLeadsActiveInOtherSequences(supabase, orgId, dedupedLeadIds, sequence_id as string);
    if (busy.size > 0) {
      const before = dedupedLeadIds.length;
      dedupedLeadIds = dedupedLeadIds.filter((id) => !busy.has(id));
      concurrentSkipped = before - dedupedLeadIds.length;
    }
  }

  if (dedupedLeadIds.length === 0) {
    return {
      enrolled: 0, sequence_id, no_email: noEmailCount, unresolved: unresolvedCount,
      suppressed: suppressedCount, already_in_another_sequence: concurrentSkipped,
    };
  }

  // Round-robin pre-assign a mailbox from the sequence's pool (mirrors the
  // enroll-leads edge function). The sender lazy-assigns at send time anyway,
  // so a null mailbox_id still sends — but pre-assigning makes API-created
  // enrollments inspectable (a visible mailbox instead of a null that reads
  // like a broken enrollment) and spreads leads across the pool up front.
  const seqSettings = (seqRow.settings as Record<string, unknown>) || {};
  const settingsMailboxIds = Array.isArray(seqSettings.mailbox_ids)
    ? seqSettings.mailbox_ids.filter((id): id is string => typeof id === "string")
    : undefined;
  const availableMailboxIds = await getReadyMailboxIds(supabase, orgId, settingsMailboxIds);

  // A configured pool is an explicit sender constraint. Fail visibly instead
  // of reporting successful enrollment rows that cannot ever send or display a
  // mailbox assignment. An empty pool intentionally retains the org-wide
  // rotation behavior.
  if (settingsMailboxIds?.length && availableMailboxIds.length === 0) {
    throw new Error("None of the sequence's configured mailboxes are ready and connected");
  }

  // next_send_at MUST be set or the sequence processor (which selects
  // next_send_at <= now()) will never pick the enrollment up — it'd strand
  // forever with nothing sending. Use now(); the processor defers to the
  // sequence's send window on the first tick. organization_id is set for
  // org-scoped queries.
  // When continuing an existing thread (e.g. an external agent moving an interested
  // replier into a follow-up sequence), stamp the conversation id so the sender keeps
  // the same mailbox + email thread instead of rotating a fresh one. The sequence
  // sender reads metadata.continue_from_conversation_id (resolveContinuationAnchor).
  const continueConversationId = typeof continue_from_conversation_id === "string"
    ? continue_from_conversation_id
    : undefined;
  const nowISO = new Date().toISOString();
  const rows = dedupedLeadIds.map((leadId, idx) => ({
    sequence_id,
    lead_id: leadId,
    current_step: 0,
    status: "active",
    next_send_at: nowISO,
    organization_id: orgId,
    // Thread continuations must NOT pre-assign — the sender resolves the
    // original conversation's mailbox (resolveContinuationAnchor) instead.
    ...(continueConversationId
      ? { metadata: { continue_from_conversation_id: continueConversationId } }
      : (availableMailboxIds.length > 0
          ? { mailbox_id: availableMailboxIds[idx % availableMailboxIds.length] }
          : {})),
  }));

  const { data, error } = await supabase
    .from("email_sequence_enrollments")
    .upsert(rows, { onConflict: "sequence_id,lead_id", ignoreDuplicates: true })
    .select("id, lead_id, status");

  if (error) { console.error("[MCP] Failed to enroll leads:", error.message); throw new Error("Failed to enroll leads"); }

  return {
    enrolled: (data || []).length,
    sequence_id,
    no_email: noEmailCount,
    unresolved: unresolvedCount,
    suppressed: suppressedCount,
    already_in_another_sequence: concurrentSkipped,
  };
}

async function updateEnrollmentStatus(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { enrollment_id, sequence_id, status } = params;

  if (!enrollment_id) throw new Error("enrollment_id is required");
  if (!sequence_id) throw new Error("sequence_id is required");

  const allowedStatuses = ["active", "paused", "completed", "unsubscribed"];
  if (!status || !allowedStatuses.includes(status as string)) {
    throw new Error(`status must be one of: ${allowedStatuses.join(", ")}`);
  }

  // Verify sequence belongs to org
  const { error: seqError } = await supabase
    .from("email_sequences")
    .select("id")
    .eq("id", sequence_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (seqError) { console.error("[MCP] Sequence not found:", seqError.message); throw new Error("Sequence not found"); }

  const { data: enrollment, error } = await supabase
    .from("email_sequence_enrollments")
    .update({ status })
    .eq("id", enrollment_id)
    .eq("sequence_id", sequence_id)
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update enrollment:", error.message); throw new Error("Failed to update enrollment"); }

  return { enrollment };
}

async function listEmailMailboxes(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const { data: mailboxes, error } = await supabase
    .from("email_mailboxes")
    .select("id, display_name, email_address, status, connection_type, warmup_max_daily, daily_limit, health_score, tags, imap_connected, created_at, updated_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false });

  if (error) { console.error("[MCP] Failed to list mailboxes:", error.message); throw new Error("Failed to list mailboxes"); }

  return { email_mailboxes: mailboxes };
}

// ============================================================================
// CRM Contacts
// ============================================================================

// ============================================================================
// Inbox / conversations (the "unibox") — read + threaded send
// ============================================================================

async function listConversations(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { channel, status, lead_intent, unread_only, limit: limitParam, offset: offsetParam } = params;
  const orgId = getEffectiveOrgId(ctx);
  const lim = typeof limitParam === "number" ? Math.min(limitParam, 200) : 50;
  const off = typeof offsetParam === "number" ? offsetParam : 0;

  let query = supabase
    .from("crm_conversations")
    .select("id, channel, status, lead_intent, mailbox_id, message_count, unread_count, last_message_at, last_message_preview, last_message_direction, contact:crm_contacts(id, display_name, primary_email, company)")
    .eq("organization_id", orgId);

  if (typeof channel === "string") query = query.eq("channel", channel);
  if (typeof status === "string" && status !== "all") query = query.eq("status", status);
  if (typeof lead_intent === "string") query = query.eq("lead_intent", lead_intent);
  if (unread_only === true) query = query.gt("unread_count", 0);

  query = query.order("last_message_at", { ascending: false, nullsFirst: false }).range(off, off + lim - 1);

  const { data: conversations, error } = await query;
  if (error) { console.error("[MCP] Failed to list conversations:", error.message); throw new Error("Failed to list conversations"); }

  return { conversations: conversations || [], limit: lim, offset: off };
}

async function getConversation(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { conversation_id, message_limit } = params;
  if (!conversation_id) throw new Error("conversation_id is required");
  const orgId = getEffectiveOrgId(ctx);
  const msgLim = typeof message_limit === "number" ? Math.min(message_limit, 200) : 50;

  const { data: conversation, error: convErr } = await supabase
    .from("crm_conversations")
    .select("id, channel, status, lead_intent, mailbox_id, external_participant_id, message_count, unread_count, last_message_at, contact:crm_contacts(id, display_name, primary_email, company, job_title)")
    .eq("id", conversation_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (convErr || !conversation) throw new Error("Conversation not found");

  // Resolve the mailbox (so the agent sees which inbox the thread lives on)
  let mailbox: Record<string, unknown> | null = null;
  if (conversation.mailbox_id) {
    const { data: mb } = await supabase
      .from("email_mailboxes")
      .select("id, email_address, display_name, status")
      .eq("id", conversation.mailbox_id)
      .maybeSingle();
    mailbox = mb || null;
  }

  // Newest-first window, returned chronologically
  const { data: messages } = await supabase
    .from("crm_messages")
    .select("id, direction, sender_type, content, content_type, email_subject, email_from, external_message_id, metadata, status, created_at")
    .eq("conversation_id", conversation_id)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(msgLim);

  const newestFirst = messages || [];
  const ordered = newestFirst.slice().reverse();

  // Thread context: what's needed to reply in-thread (also handled server-side by send_conversation_reply)
  const latest = newestFirst[0] || null;
  const latestMeta = (latest?.metadata || {}) as Record<string, any>;
  const threadContext = latest
    ? {
        mailbox_id: conversation.mailbox_id || null,
        mailbox_email: (mailbox?.email_address as string) || null,
        last_message_id: latestMeta.email_message_id || latest.external_message_id || null,
        last_subject: latest.email_subject || null,
        references: latestMeta.email_references || [],
      }
    : null;

  return {
    conversation: { ...conversation, mailbox },
    messages: ordered,
    thread_context: threadContext,
  };
}

async function sendConversationReply(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { conversation_id, content, content_type, subject } = params;
  if (!conversation_id) throw new Error("conversation_id is required");
  if (typeof content !== "string" || !content.trim()) throw new Error("content is required");
  if (content_type !== undefined && content_type !== "text" && content_type !== "html") {
    throw new Error("content_type must be 'text' or 'html'");
  }

  // sendThreadedReply org-scopes the conversation lookup, so cross-tenant sends are rejected.
  const result = await sendThreadedReply(supabase, {
    organizationId: getEffectiveOrgId(ctx),
    conversationId: conversation_id as string,
    content,
    contentType: content_type as 'text' | 'html' | undefined,
    subject: typeof subject === "string" ? subject : undefined,
    senderType: "automation",
    metadata: { source: "mcp_external_agent" },
  });

  if (!result.success) throw new Error(result.error || "Failed to send reply");

  return { success: true, message_id: result.messageId, external_message_id: result.externalMessageId };
}

async function listContacts(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const {
    search, status, pipeline_id, stage_id, tags, source,
    contact_type, outreach_status, min_score, max_score,
    sort_by, sort_direction, limit: limitParam, offset: offsetParam,
  } = params;

  const orgId = getEffectiveOrgId(ctx);
  const lim = typeof limitParam === "number" ? Math.min(limitParam, 10000) : 50;
  const off = typeof offsetParam === "number" ? offsetParam : 0;
  const sortCol = typeof sort_by === "string" ? sort_by : "last_activity_at";
  const sortDir = sort_direction === "asc" ? true : false;

  let query = supabase
    .from("crm_contacts")
    .select("id, display_name, first_name, last_name, company, job_title, primary_email, primary_linkedin_url, lead_score, pipeline_id, stage_id, tags, status, contact_type, outreach_status, source, owner_user_id, last_activity_at, created_at")
    .eq("organization_id", orgId);

  let countQuery = supabase
    .from("crm_contacts")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId);

  if (typeof search === "string" && search.trim()) {
    const s = search.trim();
    const filter = `display_name.ilike.%${s}%,primary_email.ilike.%${s}%,company.ilike.%${s}%`;
    query = query.or(filter);
    countQuery = countQuery.or(filter);
  }
  if (typeof status === "string" && status !== "all") {
    query = query.eq("status", status);
    countQuery = countQuery.eq("status", status);
  }
  if (typeof pipeline_id === "string") {
    query = query.eq("pipeline_id", pipeline_id);
    countQuery = countQuery.eq("pipeline_id", pipeline_id);
  }
  if (typeof stage_id === "string") {
    query = query.eq("stage_id", stage_id);
    countQuery = countQuery.eq("stage_id", stage_id);
  }
  if (Array.isArray(tags) && tags.length > 0) {
    query = query.overlaps("tags", tags as string[]);
    countQuery = countQuery.overlaps("tags", tags as string[]);
  }
  if (typeof source === "string") {
    query = query.eq("source", source);
    countQuery = countQuery.eq("source", source);
  }
  if (typeof contact_type === "string" && contact_type !== "all") {
    query = query.eq("contact_type", contact_type);
    countQuery = countQuery.eq("contact_type", contact_type);
  }
  if (typeof outreach_status === "string") {
    query = query.eq("outreach_status", outreach_status);
    countQuery = countQuery.eq("outreach_status", outreach_status);
  }
  if (typeof min_score === "number") {
    query = query.gte("lead_score", min_score);
    countQuery = countQuery.gte("lead_score", min_score);
  }
  if (typeof max_score === "number") {
    query = query.lte("lead_score", max_score);
    countQuery = countQuery.lte("lead_score", max_score);
  }

  query = query.order(sortCol, { ascending: sortDir, nullsFirst: false });
  query = query.range(off, off + lim - 1);

  const [{ data: contacts, error }, { count: total }] = await Promise.all([query, countQuery]);

  if (error) { console.error("[MCP] Failed to list contacts:", error.message); throw new Error("Failed to list contacts"); }

  return { contacts, total: total || 0, limit: lim, offset: off };
}

async function getContact(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { contact_id } = params;
  if (!contact_id) throw new Error("contact_id is required");

  const orgId = getEffectiveOrgId(ctx);

  const [contactResult, identitiesResult, activitiesResult, notesResult] = await Promise.all([
    supabase
      .from("crm_contacts")
      .select("*, pipeline:crm_pipelines(id, name), stage:crm_pipeline_stages(id, name, color)")
      .eq("id", contact_id)
      .eq("organization_id", orgId)
      .single(),
    supabase
      .from("crm_contact_identities")
      .select("*")
      .eq("contact_id", contact_id)
      .eq("organization_id", orgId)
      .order("is_primary", { ascending: false }),
    supabase
      .from("crm_activities")
      .select("id, activity_type, title, description, metadata, created_at")
      .eq("contact_id", contact_id)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("crm_notes")
      .select("id, content, is_pinned, created_by_user_id, created_at")
      .eq("contact_id", contact_id)
      .eq("organization_id", orgId)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (contactResult.error) { console.error("[MCP] Contact not found:", contactResult.error.message); throw new Error("Contact not found"); }

  return {
    contact: {
      ...contactResult.data,
      identities: identitiesResult.data || [],
      activities: activitiesResult.data || [],
      notes: notesResult.data || [],
    },
  };
}

// Native crm_contacts email-verification columns writable via create/update_contact.
// These are real columns (not custom fields), so callers like the enrichment/verification
// pipeline can populate the same fields the internal verifier writes.
const EMAIL_VERIFICATION_FIELDS = [
  "email_verification_status",
  "email_verification_score",
  "email_verification_source",
  "email_verified_at",
  "email_last_validated_at",
  "email_type",
  "email_is_deliverable",
  "email_is_catch_all",
  "email_is_disposable",
  "email_is_free",
  "email_is_role",
  "email_is_spamtrap",
] as const;

const EMAIL_VERIFIER_DB_PROVIDERS = new Set([
  "mailtester_ninja",
  "million_verifier",
  "apify_million_verifier",
  "neverbounce",
  "zerobounce",
  "kickbox",
  "webbula",
  "smtp_probe",
  "heuristic",
  "manual",
]);

// Populate the native verification columns on a DB write payload.
// Precedence: explicit top-level params win; otherwise promote matching keys nested
// inside custom_fields (callers that predate the native params stored them there).
// Promoted keys are stripped from custom_fields so the native columns are the single
// source of truth and no shadow copy lingers. email_verified_at defaults to `now`
// when a status is set without a timestamp.
function applyEmailVerificationFields(
  target: Record<string, unknown>,
  params: Record<string, unknown>,
  now: string
): void {
  // 1. Explicit top-level params.
  for (const key of EMAIL_VERIFICATION_FIELDS) {
    if (params[key] !== undefined) target[key] = params[key];
  }

  // 2. Promote any native verification keys nested inside custom_fields.
  const cf = target.custom_fields;
  if (cf && typeof cf === "object" && !Array.isArray(cf)) {
    const cfObj = { ...(cf as Record<string, unknown>) };
    let stripped = false;
    for (const key of EMAIL_VERIFICATION_FIELDS) {
      if (cfObj[key] !== undefined) {
        if (target[key] === undefined) target[key] = cfObj[key];
        delete cfObj[key];
        stripped = true;
      }
    }
    if (stripped) target.custom_fields = cfObj;
  }

  // 3. Default the verification timestamp when a status was set without one.
  if (target.email_verification_status !== undefined && target.email_verified_at === undefined) {
    target.email_verified_at = now;
  }
}

async function persistVerifierResultIfApplicable(
  supabase: SupabaseClient,
  orgId: string,
  email: string | undefined,
  params: Record<string, unknown>,
): Promise<void> {
  const status = params.email_verification_status;
  const provider = params.email_verification_source;
  if (!email || typeof status !== "string" || !status) return;
  if (!provider || !EMAIL_VERIFIER_DB_PROVIDERS.has(String(provider))) return;

  const lower = String(email).trim().toLowerCase();
  const at = lower.indexOf("@");
  if (at < 1) return;
  const domain = lower.slice(at + 1);
  const local = lower.slice(0, at);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const verifiedAt =
    (typeof params.email_verified_at === "string" && params.email_verified_at) ||
    new Date().toISOString();

  const { error } = await supabase.from("email_address_verifications").upsert(
    {
      organization_id: orgId,
      email: lower,
      email_lower: lower,
      domain,
      local_part: local,
      status,
      provider: String(provider),
      is_disposable: params.email_is_disposable === true || status === "disposable",
      is_role: params.email_is_role === true || status === "role",
      is_catch_all: params.email_is_catch_all === true || status === "catch_all",
      is_spamtrap: params.email_is_spamtrap === true,
      raw_response: params.email_verifier_raw ?? null,
      verified_at: verifiedAt,
      expires_at: expiresAt,
    },
    { onConflict: "organization_id,email_lower" },
  );
  if (error) {
    console.warn("[MCP] email_address_verifications upsert failed:", error.message);
  }
}

async function createContact(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { display_name, first_name, last_name, company, job_title, primary_email, primary_phone, primary_linkedin_url, instagram_url, linkedin_bio, home_page_text, company_website, city, state, country, pipeline_id, stage_id, tags, source, custom_fields, owner_user_id, discovery_metadata } = params;

  if (!display_name) throw new Error("display_name is required");

  const orgId = getEffectiveOrgId(ctx);
  const now = new Date().toISOString();

  const insertData: Record<string, unknown> = {
    organization_id: orgId,
    display_name,
    status: "active",
    source: source || "mcp",
  };

  if (first_name !== undefined) insertData.first_name = first_name;
  if (last_name !== undefined) insertData.last_name = last_name;
  if (company !== undefined) insertData.company = company;
  if (job_title !== undefined) insertData.job_title = job_title;
  if (primary_email !== undefined) insertData.primary_email = primary_email;
  if (primary_phone !== undefined) insertData.primary_phone = primary_phone;
  if (primary_linkedin_url !== undefined) insertData.primary_linkedin_url = primary_linkedin_url;
  if (instagram_url !== undefined) insertData.instagram_url = instagram_url;
  if (linkedin_bio !== undefined) insertData.linkedin_bio = linkedin_bio;
  if (home_page_text !== undefined) insertData.home_page_text = home_page_text;
  if (company_website !== undefined) insertData.company_website = company_website;
  if (city !== undefined) insertData.city = city;
  if (state !== undefined) insertData.state = state;
  if (country !== undefined) insertData.country = country;
  if (pipeline_id !== undefined) insertData.pipeline_id = pipeline_id;
  if (stage_id !== undefined) {
    insertData.stage_id = stage_id;
    insertData.stage_entered_at = now;
  }
  if (Array.isArray(tags)) insertData.tags = tags;
  if (custom_fields !== undefined) insertData.custom_fields = custom_fields;
  if (owner_user_id !== undefined) insertData.owner_user_id = owner_user_id;
  // Discovery-layer signal context powers {{ai_signal_*}} email variables.
  if (discovery_metadata !== undefined && typeof discovery_metadata === "object" && discovery_metadata !== null) {
    insertData.discovery_metadata = discovery_metadata;
  }
  applyEmailVerificationFields(insertData, params, now);

  const { data: contact, error } = await supabase
    .from("crm_contacts")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    console.error("[MCP] Failed to create contact:", error.message);
    // Duplicate primary_email in org — return existing contact so bulk import can add to list
    if (error.code === "23505" && typeof primary_email === "string" && primary_email.trim()) {
      const { data: existing } = await supabase
        .from("crm_contacts")
        .select("*")
        .eq("organization_id", orgId)
        .eq("primary_email", primary_email.trim())
        .maybeSingle();
      if (existing) {
        return { contact: existing, reused_existing: true };
      }
    }
    throw new Error(`Failed to create contact: ${error.message}`);
  }

  const primaryEmail = typeof primary_email === "string" ? primary_email : undefined;
  await persistVerifierResultIfApplicable(supabase, orgId, primaryEmail, params);

  // Log activity
  await supabase.from("crm_activities").insert({
    organization_id: orgId,
    contact_id: contact.id,
    activity_type: "contact_created",
    title: "Contact created via MCP",
    performed_by_type: "system",
  });

  return { contact };
}

async function pushPublicSignal(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  try {
    const result = await upsertPublicSignal(supabase, params as unknown as PushSignalInput, {
      createdBy: ctx.userId ?? null,
    });
    return {
      ok: true,
      signal: result,
      message: `Pushed ${result.signal_type} signal for ${result.company_name}${result.people_upserted ? ` with ${result.people_upserted} ${result.people_upserted === 1 ? "person" : "people"}` : ""}${result.published ? "" : " (staged, not published)"}.`,
    };
  } catch (e) {
    if (e instanceof PushValidationError) throw new Error(e.message);
    console.error("[MCP] push_public_signal failed:", e instanceof Error ? e.message : String(e));
    throw new Error("Failed to push public signal");
  }
}

async function updateContact(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { contact_id, ...fields } = params;
  if (!contact_id) throw new Error("contact_id is required");

  const orgId = getEffectiveOrgId(ctx);
  const allowedFields = [
    "display_name", "first_name", "last_name", "company", "job_title",
    "primary_email", "primary_phone", "primary_linkedin_url", "instagram_url",
    "linkedin_bio", "home_page_text",
    "company_website", "city", "state", "country",
    "pipeline_id", "stage_id", "status", "tags", "lead_score",
    "custom_fields", "owner_user_id", "discovery_metadata",
    ...EMAIL_VERIFICATION_FIELDS,
  ];

  const updateData: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (fields[key] !== undefined) updateData[key] = fields[key];
  }

  // enrichment_data backs the {{ai_company_offering}}/{{ai_company_target}}/
  // {{ai_primary_need}}/etc. message variables. It's merged (not replaced) so a
  // manual push here never clobbers what analyze-company already wrote — same
  // pattern that function uses when it saves its own results.
  const enrichmentPatch = fields.enrichment_data;
  const hasEnrichmentPatch = enrichmentPatch !== undefined && enrichmentPatch !== null
    && typeof enrichmentPatch === "object" && !Array.isArray(enrichmentPatch);

  if (Object.keys(updateData).length === 0 && !hasEnrichmentPatch) {
    throw new Error("At least one field to update is required");
  }

  // Promote native verification fields (top-level or nested in custom_fields) and
  // default email_verified_at when a status is set without an explicit timestamp.
  applyEmailVerificationFields(updateData, fields, new Date().toISOString());

  // Handle stage_entered_at if stage changed, and/or merge enrichment_data
  if (updateData.stage_id !== undefined || hasEnrichmentPatch) {
    const { data: current } = await supabase
      .from("crm_contacts")
      .select("stage_id, enrichment_data")
      .eq("id", contact_id)
      .eq("organization_id", orgId)
      .single();

    if (current && updateData.stage_id !== undefined && current.stage_id !== updateData.stage_id) {
      updateData.stage_entered_at = new Date().toISOString();
    }

    if (current && hasEnrichmentPatch) {
      updateData.enrichment_data = {
        ...(current.enrichment_data as Record<string, unknown> | null || {}),
        ...(enrichmentPatch as Record<string, unknown>),
      };
    }
  }

  if (updateData.lead_score !== undefined) {
    updateData.lead_score_updated_at = new Date().toISOString();
  }

  const { data: contact, error } = await supabase
    .from("crm_contacts")
    .update(updateData)
    .eq("id", contact_id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update contact:", error.message); throw new Error("Failed to update contact"); }

  const emailForVerify =
    (typeof updateData.primary_email === "string" && updateData.primary_email) ||
    (typeof contact.primary_email === "string" ? contact.primary_email : undefined);
  await persistVerifierResultIfApplicable(supabase, orgId, emailForVerify, { ...fields, ...updateData });

  return { contact };
}

async function deleteContacts(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { contact_ids } = params;
  if (!contact_ids || !Array.isArray(contact_ids) || contact_ids.length === 0) {
    throw new Error("contact_ids array is required");
  }
  if (contact_ids.length > 100) throw new Error("Maximum 100 contacts per request");

  const { error } = await supabase
    .from("crm_contacts")
    .delete()
    .in("id", contact_ids as string[])
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to delete contacts:", error.message); throw new Error("Failed to delete contacts"); }

  return { deleted: contact_ids.length };
}

async function bulkUpdateContacts(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { contact_ids, status, pipeline_id, stage_id, owner_user_id, tags } = params;

  if (!contact_ids || !Array.isArray(contact_ids) || contact_ids.length === 0) {
    throw new Error("contact_ids array is required");
  }
  if (contact_ids.length > 100) throw new Error("Maximum 100 contacts per request — loop this call in batches of 100 over the same contact set; it does not create or require a new list");

  const updateData: Record<string, unknown> = {};
  if (status !== undefined) updateData.status = status;
  if (pipeline_id !== undefined) updateData.pipeline_id = pipeline_id;
  if (stage_id !== undefined) {
    updateData.stage_id = stage_id;
    updateData.stage_entered_at = new Date().toISOString();
  }
  if (owner_user_id !== undefined) updateData.owner_user_id = owner_user_id;
  if (tags !== undefined) updateData.tags = tags;

  if (Object.keys(updateData).length === 0) {
    throw new Error("At least one update field is required (status, pipeline_id, stage_id, owner_user_id, tags)");
  }

  const { error } = await supabase
    .from("crm_contacts")
    .update(updateData)
    .in("id", contact_ids as string[])
    .eq("organization_id", getEffectiveOrgId(ctx));

  if (error) { console.error("[MCP] Failed to bulk update contacts:", error.message); throw new Error("Failed to bulk update contacts"); }

  return { updated: contact_ids.length };
}

async function addContactTag(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { contact_id, tag } = params;
  if (!contact_id) throw new Error("contact_id is required");
  if (!tag || typeof tag !== "string") throw new Error("tag is required");

  const orgId = getEffectiveOrgId(ctx);

  const { data: contact, error: fetchError } = await supabase
    .from("crm_contacts")
    .select("tags")
    .eq("id", contact_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError) { console.error("[MCP] Contact not found:", fetchError.message); throw new Error("Contact not found"); }

  const currentTags: string[] = contact.tags || [];
  if (currentTags.includes(tag)) {
    return { contact_id, tag, action: "already_exists" };
  }

  const { error } = await supabase
    .from("crm_contacts")
    .update({ tags: [...currentTags, tag] })
    .eq("id", contact_id)
    .eq("organization_id", orgId);

  if (error) { console.error("[MCP] Failed to add tag:", error.message); throw new Error("Failed to add tag"); }

  return { contact_id, tag, action: "added" };
}

async function removeContactTag(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { contact_id, tag } = params;
  if (!contact_id) throw new Error("contact_id is required");
  if (!tag || typeof tag !== "string") throw new Error("tag is required");

  const orgId = getEffectiveOrgId(ctx);

  const { data: contact, error: fetchError } = await supabase
    .from("crm_contacts")
    .select("tags")
    .eq("id", contact_id)
    .eq("organization_id", orgId)
    .single();

  if (fetchError) { console.error("[MCP] Contact not found:", fetchError.message); throw new Error("Contact not found"); }

  const currentTags: string[] = contact.tags || [];
  const newTags = currentTags.filter((t: string) => t !== tag);

  const { error } = await supabase
    .from("crm_contacts")
    .update({ tags: newTags })
    .eq("id", contact_id)
    .eq("organization_id", orgId);

  if (error) { console.error("[MCP] Failed to remove tag:", error.message); throw new Error("Failed to remove tag"); }

  return { contact_id, tag, action: "removed" };
}

async function listCrmPipelines(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);

  const [pipelinesResult, stagesResult] = await Promise.all([
    supabase
      .from("crm_pipelines")
      .select("id, name, is_default, created_at")
      .eq("organization_id", orgId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("crm_pipeline_stages")
      .select("id, pipeline_id, name, color, stage_order, is_won_stage, is_lost_stage")
      .eq("organization_id", orgId)
      .order("stage_order", { ascending: true }),
  ]);

  if (pipelinesResult.error) { console.error("[MCP] Failed to list pipelines:", pipelinesResult.error.message); throw new Error("Failed to list pipelines"); }

  const stagesByPipeline = new Map<string, unknown[]>();
  for (const stage of stagesResult.data || []) {
    const pid = (stage as Record<string, unknown>).pipeline_id as string;
    if (!stagesByPipeline.has(pid)) stagesByPipeline.set(pid, []);
    stagesByPipeline.get(pid)!.push(stage);
  }

  const pipelines = (pipelinesResult.data || []).map((p: Record<string, unknown>) => ({
    ...p,
    stages: stagesByPipeline.get(p.id as string) || [],
  }));

  return { pipelines };
}

async function addContactNote(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { contact_id, content, is_pinned } = params;
  if (!contact_id) throw new Error("contact_id is required");
  if (!content || typeof content !== "string") throw new Error("content is required");

  const orgId = getEffectiveOrgId(ctx);

  // Verify contact belongs to org
  const { error: verifyError } = await supabase
    .from("crm_contacts")
    .select("id")
    .eq("id", contact_id)
    .eq("organization_id", orgId)
    .single();

  if (verifyError) { console.error("[MCP] Contact not found:", verifyError.message); throw new Error("Contact not found"); }

  const { data: note, error } = await supabase
    .from("crm_notes")
    .insert({
      organization_id: orgId,
      contact_id,
      content,
      is_internal: true,
      is_pinned: is_pinned === true,
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to add note:", error.message); throw new Error("Failed to add note"); }

  return { note };
}

// ============================================================================
// Email Leads
// ============================================================================

async function listLeads(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { search, source, email_status, limit: limitParam, offset: offsetParam } = params;

  const orgId = getEffectiveOrgId(ctx);
  const lim = typeof limitParam === "number" ? Math.min(limitParam, 10000) : 50;
  const off = typeof offsetParam === "number" ? offsetParam : 0;

  let query = supabase
    .from("leads")
    .select("id, email, first_name, last_name, company, job_title, linkedin_url, source, source_id, assigned_mailbox_id, email_status, last_sequence_email_at, created_at")
    .eq("organization_id", orgId);

  let countQuery = supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId);

  if (typeof search === "string" && search.trim()) {
    const s = search.trim();
    query = query.or(`email.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%,company.ilike.%${s}%`);
    countQuery = countQuery.or(`email.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%,company.ilike.%${s}%`);
  }
  if (typeof source === "string") { query = query.eq("source", source); countQuery = countQuery.eq("source", source); }
  if (typeof email_status === "string") { query = query.eq("email_status", email_status); countQuery = countQuery.eq("email_status", email_status); }

  query = query.order("created_at", { ascending: false });
  query = query.range(off, off + lim - 1);

  const [{ data: leads, error }, { count: total }] = await Promise.all([query, countQuery]);

  if (error) { console.error("[MCP] Failed to list leads:", error.message); throw new Error("Failed to list leads"); }

  return { leads, total: total || 0, limit: lim, offset: off };
}

async function getLead(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { lead_id } = params;
  if (!lead_id) throw new Error("lead_id is required");

  const orgId = getEffectiveOrgId(ctx);

  const [leadResult, enrollmentsResult] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .eq("organization_id", orgId)
      .single(),
    supabase
      .from("email_sequence_enrollments")
      .select("id, sequence_id, current_step, status, next_send_at, created_at")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false }),
  ]);

  if (leadResult.error) { console.error("[MCP] Lead not found:", leadResult.error.message); throw new Error("Lead not found"); }

  return { lead: { ...leadResult.data, enrollments: enrollmentsResult.data || [] } };
}

async function createLead(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { email, first_name, last_name, company, job_title, linkedin_url, source, source_id, assigned_mailbox_id } = params;

  if (!email || typeof email !== "string") throw new Error("email is required");

  const orgId = getEffectiveOrgId(ctx);

  // Check for existing lead with same email in this org
  const { data: existing } = await supabase
    .from("leads")
    .select("*")
    .eq("organization_id", orgId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (existing) return { lead: existing, created: false };

  const insertData: Record<string, unknown> = {
    organization_id: orgId,
    email,
    source: source || "mcp",
  };

  if (first_name !== undefined) insertData.first_name = first_name;
  if (last_name !== undefined) insertData.last_name = last_name;
  if (company !== undefined) insertData.company = company;
  if (job_title !== undefined) insertData.job_title = job_title;
  if (linkedin_url !== undefined) insertData.linkedin_url = linkedin_url;
  if (source_id !== undefined) insertData.source_id = source_id;
  if (assigned_mailbox_id !== undefined) insertData.assigned_mailbox_id = assigned_mailbox_id;
  // Senders load the mailbox by id alone: never assign another org's mailbox.
  if (assigned_mailbox_id) await assertOwned(supabase, orgId, "email_mailboxes", [assigned_mailbox_id as string], "Mailbox");

  const { data: lead, error } = await supabase
    .from("leads")
    .insert(insertData)
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create lead:", error.message); throw new Error("Failed to create lead"); }

  return { lead, created: true };
}

async function bulkCreateLeads(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { leads } = params;

  if (!leads || !Array.isArray(leads) || leads.length === 0) {
    throw new Error("leads array is required");
  }
  if (leads.length > 100) throw new Error("Maximum 100 leads per request");

  const orgId = getEffectiveOrgId(ctx);
  const inputLeads = leads as Record<string, unknown>[];

  // Validate all have email
  for (const l of inputLeads) {
    if (!l.email || typeof l.email !== "string") {
      throw new Error("Each lead must have an email field");
    }
  }

  // Fetch existing emails to dedup
  const emails = inputLeads.map(l => l.email as string);
  const { data: existing } = await supabase
    .from("leads")
    .select("email")
    .eq("organization_id", orgId)
    .in("email", emails);

  const existingEmails = new Set((existing || []).map((e: Record<string, unknown>) => e.email as string));

  const newLeads = inputLeads
    .filter(l => !existingEmails.has(l.email as string))
    .map(l => ({
      organization_id: orgId,
      email: l.email,
      first_name: l.first_name || null,
      last_name: l.last_name || null,
      company: l.company || null,
      job_title: l.job_title || null,
      linkedin_url: l.linkedin_url || null,
      source: l.source || "mcp",
      source_id: l.source_id || null,
    }));

  if (newLeads.length === 0) {
    return { created: 0, skipped: inputLeads.length, total_submitted: inputLeads.length };
  }

  const { data, error } = await supabase
    .from("leads")
    .insert(newLeads)
    .select();

  if (error) { console.error("[MCP] Failed to bulk create leads:", error.message); throw new Error("Failed to bulk create leads"); }

  return { created: (data || []).length, skipped: inputLeads.length - (data || []).length, total_submitted: inputLeads.length };
}

async function bulkCreateContacts(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { contacts, dedupe_on_email, log_activity, source } = params;

  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    throw new Error("contacts array is required");
  }

  const orgId = getEffectiveOrgId(ctx);

  // Shared core — identical semantics to the bulk-create-contacts REST function.
  return await insertContactsBulk(supabase, orgId, contacts as BulkContactInput[], {
    dedupeOnEmail: dedupe_on_email !== false,
    logActivity: log_activity !== false,
    defaultSource: typeof source === "string" && source ? source : "mcp",
    maxBatch: 100,
  });
}

// ============================================================================
// Lead Lists
// ============================================================================

async function listLeadLists(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { status, source_type, search, include_smart, limit: limitParam, offset: offsetParam } = params;

  const orgId = getEffectiveOrgId(ctx);
  const lim = typeof limitParam === "number" ? Math.min(limitParam, 10000) : 50;
  const off = typeof offsetParam === "number" ? offsetParam : 0;

  let query = supabase
    .from("lead_lists")
    .select("id, name, description, source_type, lead_count, status, is_smart, filter_criteria, created_at, updated_at")
    .eq("organization_id", orgId);

  let countQuery = supabase
    .from("lead_lists")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId);

  if (typeof status === "string") { query = query.eq("status", status); countQuery = countQuery.eq("status", status); }
  if (typeof source_type === "string") { query = query.eq("source_type", source_type); countQuery = countQuery.eq("source_type", source_type); }
  if (include_smart === false) { query = query.eq("is_smart", false); countQuery = countQuery.eq("is_smart", false); }
  if (typeof search === "string" && search.trim()) {
    query = query.ilike("name", `%${search.trim()}%`);
    countQuery = countQuery.ilike("name", `%${search.trim()}%`);
  }

  query = query.order("created_at", { ascending: false });
  query = query.range(off, off + lim - 1);

  const [{ data: lists, error }, { count: total }] = await Promise.all([query, countQuery]);

  if (error) { console.error("[MCP] Failed to list lead lists:", error.message); throw new Error("Failed to list lead lists"); }

  return { lead_lists: lists, total: total || 0, limit: lim, offset: off };
}

async function getLeadList(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { list_id, include_members, members_limit, members_offset } = params;
  if (!list_id) throw new Error("list_id is required");

  const orgId = getEffectiveOrgId(ctx);

  const { data: list, error } = await supabase
    .from("lead_lists")
    .select("*")
    .eq("id", list_id)
    .eq("organization_id", orgId)
    .single();

  if (error) { console.error("[MCP] Lead list not found:", error.message); throw new Error("Lead list not found"); }

  const result: Record<string, unknown> = { lead_list: list };

  if (include_members !== false) {
    const memLim = typeof members_limit === "number" ? Math.min(members_limit, 10000) : 50;
    const memOff = typeof members_offset === "number" ? members_offset : 0;

    const [membersResult, countResult] = await Promise.all([
      supabase
        .from("lead_list_members")
        .select("contact_id, added_at, contact:crm_contacts(id, display_name, primary_email, company, job_title, status, tags)")
        .eq("list_id", list_id)
        .order("added_at", { ascending: false })
        .range(memOff, memOff + memLim - 1),
      supabase
        .from("lead_list_members")
        .select("*", { count: "exact", head: true })
        .eq("list_id", list_id),
    ]);

    result.members = (membersResult.data || []).map((m: Record<string, unknown>) => ({
      contact_id: m.contact_id,
      added_at: m.added_at,
      ...(m.contact as Record<string, unknown> || {}),
    }));
    result.members_total = countResult.count || 0;
    result.members_limit = memLim;
    result.members_offset = memOff;
  }

  return result;
}

async function createLeadList(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { name, description, source_type, contact_ids } = params;

  if (!name || typeof name !== "string") throw new Error("name is required");

  const orgId = getEffectiveOrgId(ctx);

  const { data: list, error } = await supabase
    .from("lead_lists")
    .insert({
      organization_id: orgId,
      name,
      description: description || null,
      source_type: source_type || "manual",
      source_config: {},
      lead_count: 0,
      status: "active",
    })
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to create lead list:", error.message); throw new Error("Failed to create lead list"); }

  // If contact_ids provided, add them as members. Capped and chunked the same way
  // as add_contacts_to_list (500/request, validated in 100s) so a caller who hits
  // the cap here gets the same "keep paging into this list_id" behavior rather
  // than a raw query failure that looks like a hard wall and invites creating a
  // second list for the overflow.
  if (Array.isArray(contact_ids) && contact_ids.length > 0) {
    if (contact_ids.length > 500) {
      throw new Error(
        "Maximum 500 contacts per request. Create the list first, then call add_contacts_to_list " +
        `repeatedly with list_id "${list.id}" in batches of up to 500 for the rest — do not create another list.`
      );
    }

    const uniqueInitialIds = [...new Set((contact_ids as string[]).map(String))];
    const validIds = new Set<string>();
    const ID_CHUNK = 100;
    for (let i = 0; i < uniqueInitialIds.length; i += ID_CHUNK) {
      const slice = uniqueInitialIds.slice(i, i + ID_CHUNK);
      const { data: rows } = await supabase
        .from("crm_contacts")
        .select("id")
        .eq("organization_id", orgId)
        .in("id", slice);
      for (const r of rows || []) validIds.add(r.id as string);
    }

    const members = uniqueInitialIds
      .filter(cid => validIds.has(cid))
      .map(cid => ({ list_id: list.id, contact_id: cid }));

    if (members.length > 0) {
      const { error: memberError } = await supabase
        .from("lead_list_members")
        .insert(members);

      if (memberError) {
        console.error("[MCP] Failed to add initial members:", memberError.message);
      }
    }

    // Update lead_count from actual membership count
    const { count } = await supabase
      .from("lead_list_members")
      .select("*", { count: "exact", head: true })
      .eq("list_id", list.id);

    await supabase
      .from("lead_lists")
      .update({ lead_count: count || 0 })
      .eq("id", list.id);

    list.lead_count = count || 0;
  }

  return { lead_list: list };
}

async function updateLeadList(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { list_id, name, description, status } = params;

  if (!list_id) throw new Error("list_id is required");

  const orgId = getEffectiveOrgId(ctx);
  const updateData: Record<string, unknown> = {};

  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (status !== undefined) updateData.status = status;

  if (Object.keys(updateData).length === 0) throw new Error("No valid fields to update");

  const { data: list, error } = await supabase
    .from("lead_lists")
    .update(updateData)
    .eq("id", list_id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) { console.error("[MCP] Failed to update lead list:", error.message); throw new Error("Failed to update lead list"); }

  return { lead_list: list };
}

async function deleteLeadList(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { list_id } = params;

  if (!list_id) throw new Error("list_id is required");

  const orgId = getEffectiveOrgId(ctx);

  // Members are deleted via cascade
  const { error } = await supabase
    .from("lead_lists")
    .delete()
    .eq("id", list_id)
    .eq("organization_id", orgId);

  if (error) { console.error("[MCP] Failed to delete lead list:", error.message); throw new Error("Failed to delete lead list"); }

  return { deleted: true };
}

async function addContactsToList(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { list_id, contact_ids } = params;

  if (!list_id) throw new Error("list_id is required");
  if (!Array.isArray(contact_ids) || contact_ids.length === 0) throw new Error("contact_ids array is required");

  const uniqueIds = [...new Set((contact_ids as string[]).map(String))];
  if (uniqueIds.length > 500) throw new Error("Maximum 500 contacts per request");

  const orgId = getEffectiveOrgId(ctx);

  // Verify the list belongs to this org
  const { data: list, error: listError } = await supabase
    .from("lead_lists")
    .select("id")
    .eq("id", list_id)
    .eq("organization_id", orgId)
    .single();

  if (listError || !list) throw new Error("Lead list not found");

  // Shared core: org-checked, skips contacts already in the list (or whose
  // email already is) instead of failing the whole batch.
  const result = await addContactsToListShared(supabase, orgId, list_id as string, uniqueIds);
  return {
    added: result.added,
    skipped: result.skipped + result.not_found,
    total_submitted: uniqueIds.length,
  };
}

async function removeContactsFromList(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { list_id, contact_ids } = params;

  if (!list_id) throw new Error("list_id is required");
  if (!Array.isArray(contact_ids) || contact_ids.length === 0) throw new Error("contact_ids array is required");
  if (contact_ids.length > 500) throw new Error("Maximum 500 contacts per request");

  const orgId = getEffectiveOrgId(ctx);

  // Verify the list belongs to this org
  const { data: list, error: listError } = await supabase
    .from("lead_lists")
    .select("id")
    .eq("id", list_id)
    .eq("organization_id", orgId)
    .single();

  if (listError || !list) throw new Error("Lead list not found");

  // Only remove contacts that belong to this org (prevents cross-org manipulation)
  const { data: validContacts } = await supabase
    .from("crm_contacts")
    .select("id")
    .eq("organization_id", orgId)
    .in("id", contact_ids as string[]);

  const validIds = (validContacts || []).map((c: Record<string, unknown>) => c.id as string);

  if (validIds.length === 0) return { removed: 0 };

  const { error } = await supabase
    .from("lead_list_members")
    .delete()
    .eq("list_id", list_id)
    .in("contact_id", validIds);

  if (error) { console.error("[MCP] Failed to remove contacts from list:", error.message); throw new Error("Failed to remove contacts from list"); }

  // Update lead_count
  const { count } = await supabase
    .from("lead_list_members")
    .select("*", { count: "exact", head: true })
    .eq("list_id", list_id);

  await supabase
    .from("lead_lists")
    .update({ lead_count: count || 0 })
    .eq("id", list_id);

  return { removed: validIds.length };
}

// ============================================================================
// Lead Processing Setup (per-list processing policy)
// ============================================================================

const ENRICHMENT_PROVIDERS = ["apollo", "hunter", "prospeo", "moltsets"];
const VERIFICATION_PROVIDERS = ["lite", "apify_million_verifier", "mailtester_ninja"];
const EMAIL_STRATEGIES = ["none", "find_only", "verify_only", "find_then_verify", "verify_then_recover"];

// Derive the stage flags + order from a high-level email strategy. Mirrors
// setEmailStrategy() in LeadListProcessingDialog so MCP and the UI stay aligned.
function deriveEmailStages(strategy: string): {
  find_email: boolean; verify_email: boolean; find_replacement_email_on_invalid: boolean; stage_order: string[];
} {
  const find = strategy === "find_only" || strategy === "find_then_verify" || strategy === "verify_then_recover";
  const verify = strategy === "verify_only" || strategy === "find_then_verify" || strategy === "verify_then_recover";
  const recover = strategy === "verify_then_recover";
  return {
    find_email: find,
    verify_email: verify,
    find_replacement_email_on_invalid: recover,
    stage_order: recover
      ? ["icp", "verify_email", "find_email", "enroll"]
      : ["icp", "find_email", "verify_email", "enroll"],
  };
}

// Reverse mapping: describe a stored policy's email behaviour as a strategy label.
function emailStrategyFromPolicy(p: Record<string, unknown>): string {
  const find = !!p.find_email;
  const verify = !!p.verify_email;
  if (!find && !verify) return "none";
  if (find && !verify) return "find_only";
  if (!find && verify) return "verify_only";
  return p.find_replacement_email_on_invalid ? "verify_then_recover" : "find_then_verify";
}

// Guard against cross-tenant references: every id must belong to this org.
async function assertOwned(
  supabase: SupabaseClient, orgId: string, table: string, ids: string[], label: string,
): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const { data, error } = await supabase.from(table).select("id").eq("organization_id", orgId).in("id", unique);
  if (error) { console.error(`[MCP] ownership check failed for ${table}:`, error.message); throw new Error(`Could not validate ${label}`); }
  const found = new Set((data || []).map((r: Record<string, unknown>) => r.id as string));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`${label} not found in this organization: ${missing.join(", ")}`);
}

/** All unipile account ids referenced by sender_account_ids and the per-channel sender_accounts map. */
function senderAccountIdsFrom(params: Record<string, unknown>): string[] {
  const ids: string[] = Array.isArray(params.sender_account_ids) ? (params.sender_account_ids as string[]) : [];
  const byChannel = params.sender_accounts;
  if (byChannel && typeof byChannel === "object") {
    for (const list of Object.values(byChannel as Record<string, unknown>)) {
      if (Array.isArray(list)) ids.push(...(list as string[]));
    }
  }
  return ids;
}

async function getLeadProcessingSetup(
  supabase: SupabaseClient, ctx: AuthContext, params: Record<string, unknown>,
): Promise<unknown> {
  const { list_id } = params;
  if (!list_id) throw new Error("list_id is required");
  const orgId = getEffectiveOrgId(ctx);

  const { data: list, error: listError } = await supabase
    .from("lead_lists").select("id, name").eq("id", list_id).eq("organization_id", orgId).single();
  if (listError || !list) throw new Error("Lead list not found");

  const { data: policy, error } = await supabase
    .from("lead_list_processing_policies").select("*")
    .eq("organization_id", orgId).eq("lead_list_id", list_id).maybeSingle();
  if (error) { console.error("[MCP] Failed to load processing setup:", error.message); throw new Error("Failed to load processing setup"); }

  if (!policy) {
    return { configured: false, lead_list: list, note: "No processing setup exists for this list yet. Use configure_lead_processing_setup to create one." };
  }
  return { configured: true, lead_list: list, email_strategy: emailStrategyFromPolicy(policy as Record<string, unknown>), processing_setup: policy };
}

async function configureLeadProcessingSetup(
  supabase: SupabaseClient, ctx: AuthContext, params: Record<string, unknown>,
): Promise<unknown> {
  const { list_id } = params;
  if (!list_id || typeof list_id !== "string") throw new Error("list_id is required");
  const orgId = getEffectiveOrgId(ctx);

  // Verify the list belongs to this org
  const { data: list, error: listError } = await supabase
    .from("lead_lists").select("id, name").eq("id", list_id).eq("organization_id", orgId).single();
  if (listError || !list) throw new Error("Lead list not found");

  const { data: existing } = await supabase
    .from("lead_list_processing_policies").select("id")
    .eq("organization_id", orgId).eq("lead_list_id", list_id).maybeSingle();

  // Email stage strategy → derived stage flags + order
  const emailStrategy = (params.email_strategy as string) ?? "none";
  if (!EMAIL_STRATEGIES.includes(emailStrategy)) throw new Error(`email_strategy must be one of: ${EMAIL_STRATEGIES.join(", ")}`);
  const stages = deriveEmailStages(emailStrategy);

  // Provider chains (ordered fallbacks)
  const emailChain = Array.isArray(params.email_provider_chain) ? (params.email_provider_chain as string[]) : [];
  const verifyChain = Array.isArray(params.verification_provider_chain) ? (params.verification_provider_chain as string[]) : [];
  const badEmail = emailChain.filter((p) => !ENRICHMENT_PROVIDERS.includes(p));
  if (badEmail.length) throw new Error(`Invalid email provider(s): ${badEmail.join(", ")}. Valid: ${ENRICHMENT_PROVIDERS.join(", ")}`);
  const badVerify = verifyChain.filter((p) => !VERIFICATION_PROVIDERS.includes(p));
  if (badVerify.length) throw new Error(`Invalid verification provider(s): ${badVerify.join(", ")}. Valid: ${VERIFICATION_PROVIDERS.join(", ")}`);
  if (stages.find_email && emailChain.length === 0) throw new Error("email_provider_chain needs at least one provider when email_strategy finds an email");
  if (stages.verify_email && verifyChain.length === 0) throw new Error("verification_provider_chain needs at least one provider when email_strategy verifies an email");

  // Outcome routing destinations
  const outcomeTypes = ["none", "list", "linkedin_campaign"];
  const readOutcome = (prefix: string): { type: string; id: string | null } => {
    const type = (params[`${prefix}_type`] as string) ?? "none";
    if (!outcomeTypes.includes(type)) throw new Error(`${prefix}_type must be one of: ${outcomeTypes.join(", ")}`);
    const id = type === "none" ? null : ((params[`${prefix}_id`] as string) ?? null);
    if (type !== "none" && !id) throw new Error(`${prefix}_id is required when ${prefix}_type is '${type}'`);
    return { type, id };
  };
  const lowIcp = readOutcome("low_icp_destination");
  const noSource = readOutcome("no_source_data_destination");
  const noEmail = readOutcome("no_email_destination");
  const unverified = readOutcome("unverified_email_destination");

  // Ready-contact (approved) destination
  const approvedTypes = ["none", "email_sequence", "linkedin_campaign"];
  const approvedType = (params.approved_destination_type as string) ?? "none";
  if (!approvedTypes.includes(approvedType)) throw new Error(`approved_destination_type must be one of: ${approvedTypes.join(", ")}`);
  const approvedId = approvedType === "none" ? null : ((params.approved_destination_id as string) ?? null);
  if (approvedType !== "none" && !approvedId) throw new Error(`approved_destination_id is required when approved_destination_type is '${approvedType}'`);

  // ICP qualification
  const analyzeIcp = params.analyze_icp === true;
  const icpProductId = (params.icp_product_id as string) ?? null;
  const icpIds = Array.isArray(params.icp_ids) ? (params.icp_ids as string[]) : [];
  const minIcpScore = params.min_icp_score === undefined || params.min_icp_score === null ? null : Number(params.min_icp_score);
  if (minIcpScore !== null && (Number.isNaN(minIcpScore) || minIcpScore < 0 || minIcpScore > 100)) throw new Error("min_icp_score must be between 0 and 100");

  // Analysis reuse — defaults match the DB (skip anything analyzed in the last 30 days).
  const analyzeWhen = (params.analyze_when as string) ?? "if_stale";
  if (!["always", "if_stale"].includes(analyzeWhen)) throw new Error("analyze_when must be 'always' or 'if_stale'");
  const analysisFreshnessDays = params.analysis_freshness_days === undefined || params.analysis_freshness_days === null
    ? 30 : Number(params.analysis_freshness_days);
  if (Number.isNaN(analysisFreshnessDays) || analysisFreshnessDays < 1 || analysisFreshnessDays > 3650) {
    throw new Error("analysis_freshness_days must be between 1 and 3650");
  }

  // Validate ownership of every referenced entity (prevents cross-tenant leakage)
  const listRefs = [lowIcp, noSource, noEmail, unverified].filter((d) => d.type === "list").map((d) => d.id as string);
  const campaignRefs = [lowIcp, noSource, noEmail, unverified, { type: approvedType, id: approvedId }]
    .filter((d) => d.type === "linkedin_campaign").map((d) => d.id as string);
  const sequenceRefs = approvedType === "email_sequence" && approvedId ? [approvedId] : [];
  await assertOwned(supabase, orgId, "lead_lists", listRefs, "Destination lead list");
  await assertOwned(supabase, orgId, "linkedin_campaigns", campaignRefs, "Destination LinkedIn campaign");
  await assertOwned(supabase, orgId, "email_sequences", sequenceRefs, "Destination email sequence");
  if (icpProductId) await assertOwned(supabase, orgId, "library_products", [icpProductId], "ICP product");
  if (icpIds.length) await assertOwned(supabase, orgId, "library_icps", icpIds, "ICP");

  const requireValidEmail = params.require_valid_email === undefined ? true : params.require_valid_email === true;

  // Step 4 — AI-written emails. Only meaningful for an email-sequence
  // destination; generate-email-sequence hard-requires enrichment_data, which
  // only the ICP/company analysis stage produces.
  const writeMessage = params.write_message === true && approvedType === "email_sequence";
  const messagePrompt = (params.message_prompt as string) ?? null;
  const messageProductId = (params.message_product_id as string) ?? null;
  const messageTemperature = params.message_temperature === undefined || params.message_temperature === null
    ? null : Number(params.message_temperature);
  if (writeMessage && !messagePrompt?.trim()) throw new Error("message_prompt is required when write_message is true");
  if (writeMessage && !analyzeIcp) throw new Error("write_message requires analyze_icp — the AI writer needs the company analysis it produces");
  if (messageTemperature !== null && (Number.isNaN(messageTemperature) || messageTemperature < 0 || messageTemperature > 1)) {
    throw new Error("message_temperature must be between 0 and 1");
  }
  if (messageProductId) await assertOwned(supabase, orgId, "library_products", [messageProductId], "Message product");

  // One-line icebreaker into a contact custom field. Unlike write_message this
  // is destination-agnostic — the field lives on the contact and any copy can
  // reference {{custom_<key>}} — but it needs the same company analysis.
  const writeIcebreaker = params.write_icebreaker === true;
  const icebreakerPrompt = (params.icebreaker_prompt as string) ?? null;
  const icebreakerFieldKey = ((params.icebreaker_field_key as string) ?? "icebreaker").trim();
  const icebreakerTemperature = params.icebreaker_temperature === undefined || params.icebreaker_temperature === null
    ? null : Number(params.icebreaker_temperature);
  if (writeIcebreaker && !icebreakerPrompt?.trim()) throw new Error("icebreaker_prompt is required when write_icebreaker is true");
  if (writeIcebreaker && !analyzeIcp) throw new Error("write_icebreaker requires analyze_icp — the AI writer needs the company analysis it produces");
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(icebreakerFieldKey)) {
    throw new Error("icebreaker_field_key must be lowercase letters, digits and underscores, starting with a letter");
  }
  if (icebreakerTemperature !== null && (Number.isNaN(icebreakerTemperature) || icebreakerTemperature < 0 || icebreakerTemperature > 1)) {
    throw new Error("icebreaker_temperature must be between 0 and 1");
  }

  const row = {
    organization_id: orgId,
    lead_list_id: list_id,
    enabled: params.enabled === true,
    analyze_icp: analyzeIcp,
    icp_product_id: icpProductId,
    icp_ids: icpIds,
    min_icp_score: minIcpScore,
    icp_llm_provider: (params.icp_llm_provider as string) ?? null,
    icp_llm_model: (params.icp_llm_model as string) ?? null,
    analyze_when: analyzeWhen,
    analysis_freshness_days: analysisFreshnessDays,
    find_email: stages.find_email,
    verify_email: stages.verify_email,
    find_replacement_email_on_invalid: stages.find_replacement_email_on_invalid,
    stage_order: stages.stage_order,
    email_provider_chain: emailChain,
    email_provider: emailChain[0] ?? null,
    verification_provider_chain: verifyChain.length ? verifyChain : ["lite"],
    verification_provider: verifyChain[0] ?? "lite",
    require_valid_email: requireValidEmail,
    low_icp_destination_type: lowIcp.type,
    low_icp_destination_id: lowIcp.id,
    no_source_data_destination_type: noSource.type,
    no_source_data_destination_id: noSource.id,
    no_email_destination_type: noEmail.type,
    no_email_destination_id: noEmail.id,
    no_email_list_id: noEmail.type === "list" ? noEmail.id : null,
    unverified_email_destination_type: unverified.type,
    unverified_email_destination_id: unverified.id,
    unverified_email_list_id: unverified.type === "list" ? unverified.id : null,
    approved_destination_type: approvedType,
    approved_destination_id: approvedId,
    sequence_id: approvedType === "email_sequence" ? approvedId : null,
    write_message: writeMessage,
    message_prompt: messagePrompt,
    message_llm_model: (params.message_llm_model as string) ?? null,
    message_temperature: messageTemperature,
    message_product_id: messageProductId,
    write_icebreaker: writeIcebreaker,
    icebreaker_prompt: icebreakerPrompt,
    icebreaker_field_key: icebreakerFieldKey,
    icebreaker_llm_model: (params.icebreaker_llm_model as string) ?? null,
    icebreaker_temperature: icebreakerTemperature,
    fetch_home_page_text: params.fetch_home_page_text === true,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error } = await supabase
    .from("lead_list_processing_policies")
    .upsert(row, { onConflict: "lead_list_id" })
    .select().single();
  if (error) { console.error("[MCP] Failed to save processing setup:", error.message); throw new Error("Failed to save processing setup"); }

  return { created: !existing, updated: !!existing, lead_list: list, email_strategy: emailStrategy, processing_setup: saved };
}

// ============================================================================
// LinkedIn Connections
// ============================================================================

async function listLinkedInConnections(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { search, account_id, limit: limitParam, offset: offsetParam } = params;

  const orgId = getEffectiveOrgId(ctx);
  const lim = typeof limitParam === "number" ? Math.min(limitParam, 10000) : 50;
  const off = typeof offsetParam === "number" ? offsetParam : 0;

  // Use the search_linkedin_connections RPC if there's a search query
  if (typeof search === "string" && search.trim()) {
    const { data, error } = await supabase.rpc("search_linkedin_connections", {
      p_organization_id: orgId,
      p_search_query: search.trim(),
      p_account_id: typeof account_id === "string" ? account_id : undefined,
      p_limit: lim,
      p_offset: off,
    });

    if (error) { console.error("[MCP] Failed to search LinkedIn connections:", error.message); throw new Error("Failed to search LinkedIn connections"); }

    const totalCount = data && data.length > 0 ? Number((data[0] as Record<string, unknown>).total_count) || 0 : 0;

    return {
      connections: (data || []).map((c: Record<string, unknown>) => {
        const { total_count: _, ...rest } = c;
        return rest;
      }),
      total: totalCount,
      limit: lim,
      offset: off,
    };
  }

  // Direct query without search
  // NOTE: connections live in crm_contacts/crm_contact_identities since the
  // 2026-01-16 "merge network to contacts" migration — the raw
  // linkedin_connections table is no longer written to. Read the
  // backward-compatible view instead.
  let query = supabase
    .from("linkedin_connections_view")
    .select("id, full_name, first_name, last_name, company, job_title, headline, linkedin_url, linkedin_id, location, profile_picture_url, account_id, connected_at, synced_at")
    .eq("organization_id", orgId);

  let countQuery = supabase
    .from("linkedin_connections_view")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId);

  if (typeof account_id === "string") {
    query = query.eq("account_id", account_id);
    countQuery = countQuery.eq("account_id", account_id);
  }

  query = query.order("connected_at", { ascending: false, nullsFirst: false });
  query = query.range(off, off + lim - 1);

  const [{ data: connections, error }, { count: total }] = await Promise.all([query, countQuery]);

  if (error) { console.error("[MCP] Failed to list LinkedIn connections:", error.message); throw new Error("Failed to list LinkedIn connections"); }

  return { connections, total: total || 0, limit: lim, offset: off };
}

async function getLinkedInConnection(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { connection_id } = params;
  if (!connection_id) throw new Error("connection_id is required");

  const orgId = getEffectiveOrgId(ctx);

  const { data: connection, error } = await supabase
    .from("linkedin_connections_view")
    .select("*")
    .eq("id", connection_id)
    .eq("organization_id", orgId)
    .single();

  if (error) { console.error("[MCP] LinkedIn connection not found:", error.message); throw new Error("LinkedIn connection not found"); }

  // The view is sourced from crm_contacts, so its id already *is* the CRM
  // contact id — no separate identity lookup needed.
  return {
    connection: {
      ...connection,
      linked_crm_contact_id: connection.id,
    },
  };
}

// ============================================================================
// Unified Search
// ============================================================================

async function searchContactsAndLeads(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { query, limit: limitParam } = params;

  if (!query || typeof query !== "string") throw new Error("query is required");

  const lim = typeof limitParam === "number" ? Math.min(limitParam, 25) : 10;
  const orgId = getEffectiveOrgId(ctx);
  const q = query.trim();

  const [contactsResult, leadsResult] = await Promise.all([
    supabase
      .from("crm_contacts")
      .select("id, display_name, primary_email, company, job_title, status, contact_type")
      .eq("organization_id", orgId)
      .or(`display_name.ilike.%${q}%,primary_email.ilike.%${q}%,company.ilike.%${q}%`)
      .order("first_seen_at", { ascending: false })
      .limit(lim),
    supabase
      .from("leads")
      .select("id, email, first_name, last_name, company, job_title, source")
      .eq("organization_id", orgId)
      .or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,company.ilike.%${q}%`)
      .limit(lim),
  ]);

  return {
    contacts: contactsResult.data || [],
    leads: leadsResult.data || [],
  };
}

// ============================================================================
// MCP Resources
// ============================================================================

async function getResource(
  supabase: SupabaseClient,
  ctx: AuthContext,
  uri: string
): Promise<unknown> {
  // Parse resource URI: aca://resource-name
  const match = uri.match(/^aca:\/\/(.+)$/);
  if (!match) throw new Error(`Invalid resource URI: ${uri}`);

  const resourcePath = match[1];

  switch (resourcePath) {
    case "brand-voices":
      return listBrandVoices(supabase, ctx);

    case "products":
      return listProducts(supabase, ctx);

    case "icps":
      return listICPs(supabase, ctx);

    case "characters":
      return listCharacters(supabase, ctx);

    case "tags":
      return listTags(supabase, ctx);

    case "blueprints":
      return listBlueprints(supabase, ctx, {});

    case "prompt-templates":
      return listPromptTemplates(supabase, ctx, {});

    case "blocks":
      return listBlocks(supabase, ctx, {});

    case "strategy-documents":
      return listStrategyDocuments(supabase, ctx, {});

    case "pipelines":
      return listPipelines();

    case "agent-profiles":
      return listAgentProfiles(supabase, ctx);

    case "knowledge-documents":
      return listKnowledgeDocuments(supabase, ctx, {});

    case "lead-magnet-campaigns":
      return listLeadMagnetCampaigns(supabase, ctx);

    case "outreach-campaigns":
      return listCampaigns(supabase, ctx, {});

    case "email-sequences":
      return listEmailSequences(supabase, ctx);

    case "email-mailboxes":
      return listEmailMailboxes(supabase, ctx);

    case "contacts":
      return listContacts(supabase, ctx, {});

    case "leads":
      return listLeads(supabase, ctx, {});

    case "crm-pipelines":
      return listCrmPipelines(supabase, ctx);

    case "lead-lists":
      return listLeadLists(supabase, ctx, {});

    case "linkedin-connections":
      return listLinkedInConnections(supabase, ctx, { limit: 100 });

    default:
      throw new Error(`Unknown resource: ${resourcePath}`);
  }
}

// ============================================================================
// LinkedIn Lead Import
// ============================================================================

/**
 * Get the first active LinkedIn account for the organization.
 * Used by LinkedIn import tools when account_id is not specified.
 */
async function getDefaultLinkedInAccountId(
  supabase: SupabaseClient,
  ctx: AuthContext
): Promise<string> {
  const { data, error } = await supabase
    .from("unipile_accounts")
    .select("id")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .eq("provider", "LINKEDIN")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("No active LinkedIn account found. Connect one in Settings first.");
  }
  return data.id;
}

/**
 * Mapping from frontend parameter types to Unipile API types (uppercase).
 */
const LINKEDIN_PARAM_TYPE_MAP: Record<string, string> = {
  location: "LOCATION",
  industry: "INDUSTRY",
  company: "COMPANY",
  school: "SCHOOL",
  skill: "SKILL",
  function: "JOB_FUNCTION",
  seniority: "SENIORITY_LEVEL",
};

/**
 * Search LinkedIn parameters (locations, industries, companies, etc.) by keyword.
 * Calls the Unipile API directly to avoid edge-function-to-edge-function invocation issues.
 */
async function searchLinkedInParameters(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { parameter_type, keywords, account_id } = params;

  if (!parameter_type || typeof parameter_type !== "string") {
    throw new Error("parameter_type is required");
  }
  if (!keywords || typeof keywords !== "string") {
    throw new Error("keywords is required");
  }

  const validTypes = Object.keys(LINKEDIN_PARAM_TYPE_MAP);
  if (!validTypes.includes(parameter_type)) {
    throw new Error(`Invalid parameter_type. Must be one of: ${validTypes.join(", ")}`);
  }

  const accountId = (account_id as string) || await getDefaultLinkedInAccountId(supabase, ctx);

  // Fetch the Unipile account details
  const { data: account, error: accountError } = await supabase
    .from("unipile_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (accountError || !account) {
    throw new Error(`LinkedIn account not found: ${accountError?.message || "Not found"}`);
  }

  if (account.status !== "active") {
    throw new Error("LinkedIn account is not active");
  }

  const encryptionKey = Deno.env.get("ENCRYPTION_KEY");
  if (!encryptionKey) {
    throw new Error("Missing ENCRYPTION_KEY environment variable");
  }

  // Decrypt API key and call Unipile directly
  const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
  const dsnUrl = normalizeDsnUrl(account.dsn_url);

  const unipileType = LINKEDIN_PARAM_TYPE_MAP[parameter_type];
  const queryParams = new URLSearchParams({
    account_id: account.unipile_account_id,
    type: unipileType,
    limit: "50",
    keywords: String(keywords),
  });

  const url = `${dsnUrl}/api/v1/linkedin/search/parameters?${queryParams.toString()}`;

  console.log(`[MCP] searchLinkedInParameters: ${parameter_type}="${keywords}" via ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[MCP] Unipile API error ${response.status}:`, errorText);
    throw new Error(`Unipile API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  // Normalize response — Unipile returns { items: [...] } with { id, title } objects
  let parameters: Array<{ id: string; name: string }> = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const items = data.items || data.results || [];
    if (Array.isArray(items)) {
      parameters = items.map((p: Record<string, unknown>) => ({
        id: String(p.id || p.urn || p.value || ""),
        name: String(p.title || p.name || p.text || p.label || ""),
      }));
    }
  } else if (Array.isArray(data)) {
    parameters = data.map((p: Record<string, unknown>) => ({
      id: String(p.id || p.urn || p.value || ""),
      name: String(p.title || p.name || p.text || p.label || ""),
    }));
  }

  return { parameters, parameter_type, keywords };
}

/**
 * Build a LinkedIn search URL from keywords and filters.
 * Pure URL construction, no API calls.
 */
function buildLinkedInSearchUrl(
  params: Record<string, unknown>
): unknown {
  const { keywords, platform, geo_urns, network, industry_urns, company_urns } = params;

  if (!keywords || typeof keywords !== "string") {
    throw new Error("keywords is required");
  }

  const plat = (platform as string) || "linkedin";
  const encodedKeywords = encodeURIComponent(keywords);
  let url: string;
  const filtersApplied: string[] = ["keywords"];

  if (plat === "sales_navigator") {
    // Sales Navigator URL format
    url = `https://www.linkedin.com/sales/search/people?query=(keywords:${encodedKeywords})`;
    // Note: Sales Navigator uses a different filter syntax that's hard to construct programmatically.
    // For advanced filters, use parameter mode in start_linkedin_import instead.
  } else if (plat === "recruiter") {
    // Recruiter URL format
    url = `https://www.linkedin.com/talent/search?keywords=${encodedKeywords}`;
  } else {
    // LinkedIn Classic People Search URL
    const searchParams = new URLSearchParams();
    searchParams.set("keywords", keywords);

    if (geo_urns && Array.isArray(geo_urns) && geo_urns.length > 0) {
      // LinkedIn uses multiple geoUrn params or a bracketed list
      searchParams.set("geoUrn", JSON.stringify(geo_urns));
      filtersApplied.push("location");
    }

    if (network && Array.isArray(network) && network.length > 0) {
      searchParams.set("network", JSON.stringify(network));
      filtersApplied.push("network");
    }

    if (industry_urns && Array.isArray(industry_urns) && industry_urns.length > 0) {
      searchParams.set("industry", JSON.stringify(industry_urns));
      filtersApplied.push("industry");
    }

    if (company_urns && Array.isArray(company_urns) && company_urns.length > 0) {
      searchParams.set("currentCompany", JSON.stringify(company_urns));
      filtersApplied.push("company");
    }

    url = `https://www.linkedin.com/search/results/people/?${searchParams.toString()}`;
  }

  return { url, platform: plat, filters_applied: filtersApplied };
}

/**
 * Detect import type and API type from a LinkedIn search URL.
 */
function detectImportTypeFromUrl(url: string): { type: string; apiType: string } {
  if (url.includes("/talent/search/")) {
    return { type: "search", apiType: "recruiter" }; // DB CHECK constraint only allows 'search'
  }
  if (url.includes("/sales/search/") || url.includes("/sales/lists/")) {
    return { type: "sales_nav", apiType: "sales_navigator" };
  }
  return { type: "search", apiType: "classic" };
}

/**
 * Start a LinkedIn lead import job.
 * Creates lead list (if needed), import job record, and triggers the edge function.
 */
async function startLinkedInImport(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const {
    list_name, list_id,
    max_leads, account_id,
    search_url,
    keywords, location_ids, industry_ids, company_ids, network_distance,
    api_type: requestedApiType,
  } = params;

  const orgId = getEffectiveOrgId(ctx);

  // Validate: need either search_url or keywords
  if (!search_url && !keywords) {
    throw new Error("Either search_url (URL mode) or keywords (parameter mode) is required");
  }

  // Resolve account
  const accountId = (account_id as string) || await getDefaultLinkedInAccountId(supabase, ctx);
  // linkedin-search-import joins the account by job id only: it must be this org's account.
  await assertOwned(supabase, getEffectiveOrgId(ctx), "unipile_accounts", [accountId], "LinkedIn account");

  // Pre-flight: check Sales Navigator subscription if needed
  const isSalesNavRequest = requestedApiType === "sales_navigator" ||
    (search_url && typeof search_url === "string" && (search_url.includes("/sales/search/") || search_url.includes("/sales/lists/")));

  if (isSalesNavRequest) {
    const { data: account, error: accError } = await supabase
      .from("unipile_accounts")
      .select("metadata")
      .eq("id", accountId)
      .single();

    if (accError || !account) {
      throw new Error("LinkedIn account not found");
    }

    const connectionParams = (account.metadata as Record<string, unknown>)?.connection_params as Record<string, unknown> | undefined;
    const im = connectionParams?.im as Record<string, unknown> | undefined;
    const premiumFeatures = (im?.premiumFeatures || []) as unknown[];
    const premiumId = im?.premiumId;

    if (!premiumId && premiumFeatures.length === 0) {
      console.warn(
        "[MCP] Stored metadata does not show Sales Navigator features. " +
        "Proceeding so Unipile can validate live access; metadata may be stale."
      );
    }
  }

  // Resolve or create lead list
  let targetListId: string;
  let targetListName: string;

  if (list_id && typeof list_id === "string") {
    // Verify list exists and belongs to org
    const { data: existingList, error: listError } = await supabase
      .from("lead_lists")
      .select("id, name")
      .eq("id", list_id)
      .eq("organization_id", orgId)
      .single();

    if (listError || !existingList) {
      throw new Error(`Lead list not found: ${list_id}`);
    }
    targetListId = existingList.id;
    targetListName = existingList.name;
  } else {
    // Create new list
    const name = (list_name as string) || `LinkedIn Import ${new Date().toISOString().split("T")[0]}`;
    const { data: newList, error: createError } = await supabase
      .from("lead_lists")
      .insert({
        name: name.trim(),
        source_type: "linkedin_search",
        source_config: {},
        organization_id: orgId,
      })
      .select("id, name")
      .single();

    if (createError || !newList) {
      throw new Error(`Failed to create lead list: ${createError?.message || "Unknown error"}`);
    }
    targetListId = newList.id;
    targetListName = newList.name;
  }

  // Resolve max leads (1-2500, default 100)
  const maxLeads = typeof max_leads === "number"
    ? Math.min(2500, Math.max(1, max_leads))
    : 100;

  // Determine search mode and build metadata
  let importType: string;
  let apiType: string;
  let searchMode: string;
  let sourceUrl: string;
  let metadata: Record<string, unknown>;

  if (search_url && typeof search_url === "string") {
    // URL mode
    const detected = detectImportTypeFromUrl(search_url);
    importType = detected.type;
    apiType = detected.apiType;
    searchMode = "url";
    sourceUrl = search_url;
    metadata = {
      max_leads: maxLeads,
      search_mode: "url",
      api_type: apiType,
      url: search_url,
    };
  } else {
    // Parameter mode - supports both classic and sales_navigator
    const resolvedApiType = (requestedApiType === "sales_navigator") ? "sales_navigator" : "classic";
    importType = resolvedApiType === "sales_navigator" ? "sales_nav" : "search";
    apiType = resolvedApiType;
    searchMode = "parameters";
    sourceUrl = ""; // DB requires NOT NULL, empty string for parameter mode
    metadata = {
      max_leads: maxLeads,
      search_mode: "parameters",
      api_type: resolvedApiType,
      // The caller decided the API here (default classic). Mark it explicit so the
      // import edge function's Sales-Nav auto-upgrade can't override it — accounts
      // without a Sales Nav subscription must stay on classic.
      api_type_explicit: true,
      search_params: {
        category: "people",
        keywords: keywords as string,
        location: Array.isArray(location_ids) ? location_ids : undefined,
        industry: Array.isArray(industry_ids) ? industry_ids : undefined,
        current_company: Array.isArray(company_ids) ? company_ids : undefined,
        network_distance: Array.isArray(network_distance) ? network_distance : undefined,
      },
    };
  }

  // Create import job record
  const { data: job, error: jobError } = await supabase
    .from("linkedin_import_jobs")
    .insert({
      organization_id: orgId,
      type: importType,
      source_url: sourceUrl,
      account_id: accountId,
      target_list_id: targetListId,
      status: "pending",
      metadata,
    })
    .select()
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to create import job: ${jobError?.message || "Unknown error"}`);
  }

  // Trigger the edge function (fire and forget)
  supabase.functions.invoke("linkedin-search-import", {
    body: { jobId: job.id },
  }).catch((err: Error) => {
    console.error("[MCP] Failed to invoke linkedin-search-import:", err.message);
  });

  return {
    job_id: job.id,
    status: "pending",
    list_id: targetListId,
    list_name: targetListName,
    max_leads: maxLeads,
    search_mode: searchMode,
    import_type: importType,
    api_type: apiType,
    note: "Import started. Use get_linkedin_import_job to check progress.",
  };
}

/**
 * Get the status and progress of a LinkedIn import job.
 */
async function getLinkedInImportJob(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { job_id } = params;

  if (!job_id || typeof job_id !== "string") {
    throw new Error("job_id is required");
  }

  const { data: job, error } = await supabase
    .from("linkedin_import_jobs")
    .select("*")
    .eq("id", job_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error || !job) {
    throw new Error(`Import job not found: ${job_id}`);
  }

  return {
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    total_found: job.total_found,
    total_imported: job.total_imported,
    total_skipped: job.total_skipped,
    error_message: job.error_message,
    type: job.type,
    target_list_id: job.target_list_id,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  };
}

/**
 * List recent LinkedIn import jobs for the organization.
 */
async function listLinkedInImportJobs(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { status, limit: limitParam } = params;
  const lim = typeof limitParam === "number" ? Math.min(limitParam, 50) : 10;

  let query = supabase
    .from("linkedin_import_jobs")
    .select("id, type, status, progress, total_found, total_imported, total_skipped, error_message, target_list_id, created_at, completed_at", { count: "exact" })
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false })
    .limit(lim);

  if (status && typeof status === "string") {
    query = query.eq("status", status);
  }

  const { data: jobs, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list import jobs: ${error.message}`);
  }

  return { jobs: jobs || [], count: count || 0, limit: lim };
}

/**
 * Cancel a pending or running LinkedIn import job.
 */
async function cancelLinkedInImport(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { job_id } = params;

  if (!job_id || typeof job_id !== "string") {
    throw new Error("job_id is required");
  }

  const { data, error } = await supabase
    .from("linkedin_import_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("id", job_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .in("status", ["pending", "running"])
    .select("id, status")
    .single();

  if (error || !data) {
    throw new Error(`Failed to cancel import job. It may already be completed, failed, or not found.`);
  }

  return { cancelled: true, job_id: data.id };
}

// ============================================================================
// Apify B2B Lead Finder Handlers
// ============================================================================

async function startApifyLeadsImport(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const {
    list_name, list_id,
    contact_job_title, contact_location,
    company_industry, company_keywords,
    company_not_industry, company_not_keywords,
    contact_not_job_title,
    email_status, seniority_level, functional_level, size,
    fetch_count, batch_size,
  } = params;

  const orgId = getEffectiveOrgId(ctx);

  // Resolve or create lead list
  let targetListId: string;
  let targetListName: string;

  if (list_id && typeof list_id === "string") {
    const { data: existingList, error: listError } = await supabase
      .from("lead_lists")
      .select("id, name")
      .eq("id", list_id)
      .eq("organization_id", orgId)
      .single();

    if (listError || !existingList) {
      throw new Error(`Lead list not found: ${list_id}`);
    }
    targetListId = existingList.id;
    targetListName = existingList.name;
  } else {
    const name = (list_name as string) || `Apify Import ${new Date().toISOString().split("T")[0]}`;
    const { data: newList, error: createError } = await supabase
      .from("lead_lists")
      .insert({
        name: name.trim(),
        source_type: "apify_leads_finder",
        source_config: {},
        organization_id: orgId,
      })
      .select("id, name")
      .single();

    if (createError || !newList) {
      throw new Error(`Failed to create lead list: ${createError?.message || "Unknown error"}`);
    }
    targetListId = newList.id;
    targetListName = newList.name;
  }

  // Build search config
  const searchConfig: Record<string, unknown> = {};
  if (Array.isArray(contact_job_title)) searchConfig.contact_job_title = contact_job_title;
  if (Array.isArray(contact_location)) searchConfig.contact_location = contact_location;
  if (Array.isArray(company_industry)) searchConfig.company_industry = company_industry;
  if (Array.isArray(company_keywords)) searchConfig.company_keywords = company_keywords;
  if (Array.isArray(company_not_industry)) searchConfig.company_not_industry = company_not_industry;
  if (Array.isArray(company_not_keywords)) searchConfig.company_not_keywords = company_not_keywords;
  if (Array.isArray(contact_not_job_title)) searchConfig.contact_not_job_title = contact_not_job_title;
  if (Array.isArray(email_status)) searchConfig.email_status = email_status;
  if (Array.isArray(seniority_level)) searchConfig.seniority_level = seniority_level;
  if (Array.isArray(functional_level)) searchConfig.functional_level = functional_level;
  if (Array.isArray(size)) searchConfig.size = size;

  const totalRequested = typeof fetch_count === "number"
    ? Math.min(30000, Math.max(1, fetch_count))
    : 1000;
  const batchSizeVal = typeof batch_size === "number"
    ? Math.min(5000, Math.max(100, batch_size))
    : 2500;
  const totalBatches = Math.ceil(totalRequested / batchSizeVal);

  // Create import job
  const { data: job, error: jobError } = await supabase
    .from("apify_leads_import_jobs")
    .insert({
      organization_id: orgId,
      target_list_id: targetListId,
      search_config: searchConfig,
      total_requested: totalRequested,
      batch_size: batchSizeVal,
      total_batches: totalBatches,
      estimated_cost_usd: (totalRequested / 1000) * 1.5,
    })
    .select()
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to create import job: ${jobError?.message || "Unknown error"}`);
  }

  // Fire and forget the edge function
  supabase.functions.invoke("apify-leads-import", {
    body: { jobId: job.id },
  }).catch((err: Error) => {
    console.error("[MCP] Failed to invoke apify-leads-import:", err.message);
  });

  return {
    job_id: job.id,
    status: "pending",
    list_id: targetListId,
    list_name: targetListName,
    total_requested: totalRequested,
    batch_size: batchSizeVal,
    total_batches: totalBatches,
    estimated_cost_usd: (totalRequested / 1000) * 1.5,
    note: "Import started. Use get_apify_leads_import_job to check progress.",
  };
}

async function getApifyLeadsImportJob(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { job_id } = params;

  if (!job_id || typeof job_id !== "string") {
    throw new Error("job_id is required");
  }

  const { data: job, error } = await supabase
    .from("apify_leads_import_jobs")
    .select("*")
    .eq("id", job_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (error || !job) {
    throw new Error(`Import job not found: ${job_id}`);
  }

  return {
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    total_found: job.total_found,
    total_imported: job.total_imported,
    total_skipped: job.total_skipped,
    current_batch: job.current_batch,
    total_batches: job.total_batches,
    batches: job.batches,
    estimated_cost_usd: job.estimated_cost_usd,
    error_message: job.error_message,
    target_list_id: job.target_list_id,
    search_config: job.search_config,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  };
}

async function listApifyLeadsImportJobs(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { status, limit: rawLimit } = params;
  const limitVal = Math.min(50, Math.max(1, (rawLimit as number) || 10));

  let query = supabase
    .from("apify_leads_import_jobs")
    .select("id, status, progress, total_found, total_imported, total_skipped, current_batch, total_batches, estimated_cost_usd, error_message, search_config, created_at, completed_at")
    .eq("organization_id", getEffectiveOrgId(ctx))
    .order("created_at", { ascending: false })
    .limit(limitVal);

  if (status && typeof status === "string") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list import jobs: ${error.message}`);
  }

  return { jobs: data || [], total: data?.length || 0 };
}

async function cancelApifyLeadsImport(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const { job_id } = params;

  if (!job_id || typeof job_id !== "string") {
    throw new Error("job_id is required");
  }

  const { data: job, error: fetchError } = await supabase
    .from("apify_leads_import_jobs")
    .select("status")
    .eq("id", job_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();

  if (fetchError || !job) {
    throw new Error(`Import job not found: ${job_id}`);
  }

  if (job.status !== "pending" && job.status !== "running") {
    throw new Error(`Cannot cancel job with status: ${job.status}`);
  }

  const { error } = await supabase
    .from("apify_leads_import_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("id", job_id);

  if (error) {
    throw new Error(`Failed to cancel import: ${error.message}`);
  }

  return { job_id, status: "cancelled", note: "Import job cancelled." };
}

// ============================================================================
// B2B Lead Pool Tools
// ----------------------------------------------------------------------------
// Wrap the list-building-pool-search edge function (search/count) and
// pool-add-to-list (background list builder). Filter shape mirrors the UI's
// PoolSearchFilter so the agent can drive the same flow as the dashboard.
// ============================================================================

const POOL_FILTER_KEYS = [
  "sic_code_in", "industry_pattern", "industry_exact", "p_bucket",
  "keyword", "match_combinator",
  "state", "country", "city",
  "employees_min", "employees_max",
  "seniority_in",
  "has_linkedin", "has_phone", "email_status",
] as const;

function extractPoolFilter(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of POOL_FILTER_KEYS) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

// `country` is kept in POOL_FILTER_KEYS on purpose: stripping it here would
// recreate the bug it caused. The pool has no country column, so the filter
// never restricted anything — while still satisfying the "geography + size"
// selectivity bound, so {country, employees_min} was accepted as a scoped
// query and ran worldwide. Reject it where the caller can see the reason.
function assertPoolFilterSupported(filter: Record<string, unknown>): void {
  if (filter.country) {
    throw new Error(
      "country is not a supported pool filter — the pool has no country column, so it matches " +
        "every row regardless of geography instead of narrowing to that country. Use state " +
        "(US 2-letter code, e.g. 'TX') or city.",
    );
  }
}

// HMAC-sign request body for the Fly pool-query worker. Mirrors the signing
// done by list-building-pool-search edge function. POOL_QUERY_WORKER_SECRET
// must be set on the MCP function for the search/count tool to work.
async function signPoolBody(body: Uint8Array): Promise<string> {
  const secret = Deno.env.get("POOL_QUERY_WORKER_SECRET");
  if (!secret) throw new Error("POOL_QUERY_WORKER_SECRET not configured on MCP function");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, body);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callPoolWorker(path: "/search" | "/count", filter: Record<string, unknown>): Promise<unknown> {
  const base = poolQueryWorkerUrl();
  const raw = new TextEncoder().encode(JSON.stringify(filter));
  const sig = await signPoolBody(raw);
  const resp = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": sig },
    body: raw,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`pool worker ${path} ${resp.status}: ${text.slice(0, 500)}`);
  }
  return resp.json();
}

async function searchLeadPool(
  _supabase: SupabaseClient,
  _ctx: AuthContext,
  params: Record<string, unknown>,
): Promise<unknown> {
  const filter = extractPoolFilter(params);
  const limit = typeof params.limit === "number"
    ? Math.min(1000, Math.max(1, params.limit as number))
    : 25;

  // Selectivity guard — same rule the edge function enforces.
  assertPoolFilterSupported(filter);
  const hasIndustry = Array.isArray(filter.sic_code_in) && (filter.sic_code_in as string[]).length > 0;
  const hasKeyword = typeof filter.keyword === "string" && (filter.keyword as string).trim().length >= 2;
  const hasGeoEmp = filter.state && typeof filter.employees_min === "number";
  if (!hasIndustry && !hasKeyword && !hasGeoEmp) {
    throw new Error("filter too broad — provide at least one of sic_code_in, keyword (≥2 chars), or (state + employees_min)");
  }

  const [searchResult, countResult] = await Promise.all([
    callPoolWorker("/search", { ...filter, limit, offset: 0, skip_count: true, dedup_by_email: false }) as Promise<{ rows?: unknown[]; elapsed_ms?: number }>,
    callPoolWorker("/count", filter) as Promise<{ total_distinct_emails?: number; elapsed_ms?: number }>,
  ]);

  return {
    filter,
    total_distinct_emails: countResult.total_distinct_emails ?? null,
    sample_rows: searchResult.rows ?? [],
    sample_size: limit,
    elapsed_ms: { search: searchResult.elapsed_ms, count: countResult.elapsed_ms },
    note: "Use build_lead_pool_list with the same filter to materialize all matches into a lead list.",
  };
}

async function buildLeadPoolList(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>,
): Promise<unknown> {
  const orgId = getEffectiveOrgId(ctx);
  const filter = extractPoolFilter(params);

  // selectivity guard mirrors what the edge function enforces — fail early
  // with a clearer message instead of returning a 400 from the worker.
  assertPoolFilterSupported(filter);
  const hasIndustry = Array.isArray(filter.sic_code_in) && (filter.sic_code_in as string[]).length > 0;
  const hasKeyword = typeof filter.keyword === "string" && (filter.keyword as string).trim().length >= 2;
  const hasGeoEmp = filter.state && typeof filter.employees_min === "number";
  if (!hasIndustry && !hasKeyword && !hasGeoEmp) {
    throw new Error(
      "filter too broad — provide at least one of sic_code_in, keyword (≥2 chars), or (state + employees_min)",
    );
  }

  // Resolve or create the destination list.
  let targetListId: string;
  let targetListName: string;
  if (typeof params.list_id === "string" && params.list_id) {
    const { data: list, error } = await supabase
      .from("lead_lists")
      .select("id, name")
      .eq("id", params.list_id)
      .eq("organization_id", orgId)
      .single();
    if (error || !list) throw new Error(`Lead list not found: ${params.list_id}`);
    targetListId = list.id;
    targetListName = list.name;
  } else {
    const name = typeof params.list_name === "string" && params.list_name.trim()
      ? params.list_name.trim()
      : `Pool build ${new Date().toISOString().split("T")[0]}`;
    const { data: created, error } = await supabase
      .from("lead_lists")
      .insert({
        name,
        source_type: "pool_search",
        source_config: filter,
        organization_id: orgId,
      })
      .select("id, name")
      .single();
    if (error || !created) throw new Error(`Failed to create list: ${error?.message}`);
    targetListId = created.id;
    targetListName = created.name;
  }

  // Insert the job row directly. The cron-driven process-pool-add-to-list
  // worker (1-minute tick) picks up pending rows and does the paginate +
  // upsert + member-insert work. Same shape the pool-add-to-list edge
  // function would create — we just skip the user-JWT layer since the MCP
  // request was already authenticated via API key.
  const { data: job, error: jobErr } = await supabase
    .from("pool_add_to_list_jobs")
    .insert({
      organization_id: orgId,
      target_list_id: targetListId,
      query_body: filter,
      status: "pending",
      processed: 0,
      errors: 0,
      current_offset: 0,
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    throw new Error(`Failed to enqueue build job: ${jobErr?.message ?? "no job"}`);
  }

  return {
    job_id: job.id,
    list_id: targetListId,
    list_name: targetListName,
    filter,
    note: "Build job enqueued. Poll get_lead_pool_build_job for progress.",
  };
}

async function getLeadPoolBuildJob(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>,
): Promise<unknown> {
  const job_id = params.job_id;
  if (typeof job_id !== "string" || !job_id) {
    throw new Error("job_id is required");
  }
  const { data, error } = await supabase
    .from("pool_add_to_list_jobs")
    .select("id, status, total, processed, errors, current_offset, target_list_id, created_at, started_at, completed_at")
    .eq("id", job_id)
    .eq("organization_id", getEffectiveOrgId(ctx))
    .single();
  if (error || !data) throw new Error(`Job not found: ${job_id}`);
  return data;
}

// ============================================================================
// Campaign Sequence Compiler & Layout
// ============================================================================

// Step type → React Flow node type mapping
const STEP_TO_NODE_TYPE: Record<string, string> = {
  connection_request: "connectionRequest",
  message: "message",
  inmail: "inmail",
  email: "email",
  whatsapp_message: "whatsappMessage",
  instagram_dm: "instagramDm",
  instagram_follow: "instagramFollow",
  instagram_like_post: "instagramLikePost",
  telegram_message: "telegramMessage",
  sms: "smsMessage",
  whatsapp_template: "whatsappTemplate",
  handoff_to_agent: "handoffToAgent",
  view_profile: "viewProfile",
  follow: "follow",
  like_post: "likePost",
  warmup_engagement: "warmupEngagement",
  find_email: "findEmail",
  analyze_contact: "analyzeContact",
  create_notion_page: "createNotionPage",
  schedule_meeting: "scheduleMeeting",
  send_to_smartlead: "sendToSmartlead",
  send_to_instantly: "sendToInstantly",
  send_to_lead_connector: "sendToLeadConnector",
  send_to_zapmail: "sendToZapMail",
  delay: "delay",
  switch_channel: "switchChannel",
  go_to: "goTo",
  if_connected: "conditionConnection",
  if_reply_received: "conditionReplyReceived",
  if_email_opened: "conditionEmailOpened",
  if_email_clicked: "conditionEmailClicked",
  if_open_profile: "conditionOpenProfile",
  if_channel_available: "conditionChannelAvailable",
  route_by_channel: "routeByChannel",
  if_enriched: "conditionEnriched",
  if_analyzed: "conditionAnalyzed",
  if_whatsapp_number: "whatsappCheckNumber",
  end: "end",
};

// Branch name → source handle mapping
const BRANCH_TO_HANDLE: Record<string, Record<string, string>> = {
  if_connected: { accepted: "accepted", not_accepted: "notAccepted" },
  if_reply_received: { replied: "replied", no_reply: "noReply" },
  if_email_opened: { opened: "opened", not_opened: "notOpened" },
  if_email_clicked: { clicked: "clicked", not_clicked: "notClicked" },
  if_open_profile: { open: "open", closed: "closed" },
  if_channel_available: { available: "available", not_available: "notAvailable" },
  // The real branches follow the step's channels; see routeBranchMap.
  route_by_channel: Object.fromEntries([...ROUTE_CHANNELS, ROUTE_NONE].map((h) => [h, h])),
  if_enriched: { enriched: "enriched", not_enriched: "notEnriched" },
  if_analyzed: { analyzed: "analyzed", not_analyzed: "notAnalyzed" },
  if_whatsapp_number: { has_whatsapp: "hasWhatsapp", no_whatsapp: "noWhatsapp" },
};

// Condition step types
const CONDITION_STEP_TYPES = new Set(Object.keys(BRANCH_TO_HANDLE));

/** route_by_channel branches: one per channel the step lists, then "none". */
function routeBranchMap(step: StepDef): Record<string, string> {
  const handles = [...routeChannels({ channels: step.channels }), ROUTE_NONE];
  return Object.fromEntries(handles.map((h) => [h, h]));
}

interface CompilerNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface CompilerEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  type: string;
}

interface StepDef {
  type: string;
  [key: string]: unknown;
}

function buildNodeData(step: StepDef): Record<string, unknown> {
  const t = step.type;
  switch (t) {
    case "connection_request":
      return {
        message: (step.message as string) || "",
        messageVariations: (step.message_variations as string[]) || [],
        withdrawAfterDays: (step.withdraw_after_days as number) ?? 14,
        messageMode: (step.message_mode as string) || "manual",
        prompt: step.prompt || undefined,
        promptVariations: step.prompt_variations || undefined,
        llmModel: step.llm_model || undefined,
        llmTemperature: step.llm_temperature || undefined,
      };
    case "message":
      return {
        message: (step.message as string) || "",
        messageVariations: (step.message_variations as string[]) || [],
        messageMode: (step.message_mode as string) || "manual",
        prompt: step.prompt || undefined,
        promptVariations: step.prompt_variations || undefined,
        llmModel: step.llm_model || undefined,
        llmTemperature: step.llm_temperature || undefined,
      };
    case "inmail":
      return {
        subject: (step.subject as string) || "",
        message: (step.message as string) || "",
        messageVariations: (step.message_variations as Array<{subject: string; message: string}>) || [],
        messageMode: (step.message_mode as string) || "manual",
        prompt: step.prompt || undefined,
        promptVariations: step.prompt_variations || undefined,
        llmModel: step.llm_model || undefined,
        llmTemperature: step.llm_temperature || undefined,
      };
    case "email":
      return {
        subject: (step.subject as string) || "",
        subjectVariations: (step.subject_variations as string[]) || [],
        body: (step.body as string) || "",
        bodyVariations: (step.body_variations as string[]) || [],
        trackOpens: step.track_opens ?? true,
        trackClicks: step.track_clicks ?? true,
        mailboxId: step.mailbox_id || undefined,
        messageMode: (step.message_mode as string) || "manual",
        prompt: step.prompt || undefined,
        promptVariations: step.prompt_variations || undefined,
        llmModel: step.llm_model || undefined,
        llmTemperature: step.llm_temperature || undefined,
      };
    case "delay":
      return {
        days: (step.days as number) ?? 1,
        hours: (step.hours as number) ?? 0,
        minutes: (step.minutes as number) ?? 0,
      };
    case "whatsapp_message":
      return {
        message: (step.message as string) || "",
        messageVariations: (step.message_variations as string[]) || [],
        includeMedia: step.include_media ?? false,
        mediaUrl: step.media_url || undefined,
        mediaType: step.media_type || undefined,
        messageMode: (step.message_mode as string) || "manual",
        prompt: step.prompt || undefined,
        promptVariations: step.prompt_variations || undefined,
        llmModel: step.llm_model || undefined,
        llmTemperature: step.llm_temperature || undefined,
      };
    case "instagram_dm":
      return {
        message: (step.message as string) || "",
        messageVariations: (step.message_variations as string[]) || [],
        includeMedia: step.include_media ?? false,
        mediaUrl: step.media_url || undefined,
        messageMode: (step.message_mode as string) || "manual",
        prompt: step.prompt || undefined,
        promptVariations: step.prompt_variations || undefined,
        llmModel: step.llm_model || undefined,
        llmTemperature: step.llm_temperature || undefined,
      };
    case "telegram_message":
      return {
        message: (step.message as string) || "",
        messageVariations: (step.message_variations as string[]) || [],
        parseMode: step.parse_mode || undefined,
        messageMode: (step.message_mode as string) || "manual",
        prompt: step.prompt || undefined,
        promptVariations: step.prompt_variations || undefined,
        llmModel: step.llm_model || undefined,
        llmTemperature: step.llm_temperature || undefined,
      };
    case "sms":
      return {
        message: (step.message as string) || "",
        messageVariations: (step.message_variations as string[]) || [],
        messageMode: (step.message_mode as string) || "manual",
        prompt: step.prompt || undefined,
        promptVariations: step.prompt_variations || undefined,
        llmModel: step.llm_model || undefined,
        llmTemperature: step.llm_temperature || undefined,
        continueOnFailure: step.continue_on_failure ?? false,
      };
    case "handoff_to_agent":
      return {
        agentProfileId: (step.agent_profile_id as string) || null,
        exitAfterHandoff: step.exit_after_handoff ?? true,
        channel: (step.channel as string) || undefined,
        continueOnFailure: step.continue_on_failure ?? false,
      };
    case "whatsapp_template":
      return {
        templateId: (step.template_id as string) || undefined,
        templateName: (step.template_name as string) || undefined,
        continueOnFailure: step.continue_on_failure ?? false,
      };
    case "like_post":
    case "instagram_like_post":
      return { likeCount: (step.like_count as number) ?? 1 };
    case "warmup_engagement":
      return {
        engagementType: (step.engagement_type as string) || "reaction",
        reactionType: (step.reaction_type as string) || "like",
        commentTemplates: (step.comment_templates as string[]) || [],
        postCount: (step.post_count as number) ?? 1,
        preferHighEngagement: step.prefer_high_engagement ?? true,
        cooldownDays: (step.cooldown_days as number) ?? 7,
      };
    case "find_email":
      return {
        provider: (step.provider as string) || "auto",
        skipIfHasEmail: step.skip_if_has_email ?? true,
        acceptCatchAll: step.accept_catch_all ?? false,
        validateEmail: step.validate_email ?? true,
        continueOnFailure: step.continue_on_failure ?? true,
      };
    case "analyze_contact":
      return {
        skipIfAlreadyEnriched: step.skip_if_already_enriched ?? true,
        continueOnFailure: step.continue_on_failure ?? true,
        model: step.model || DEFAULT_FAST_TEXT_MODEL,
        productId: step.product_id || undefined,
      };
    case "switch_channel":
      return {
        targetChannel: step.target_channel || "email",
        fallbackChannel: step.fallback_channel || undefined,
      };
    case "go_to":
      return { targetNodeId: step.target_node_id || undefined };
    case "if_reply_received":
      return { withinDays: (step.within_days as number) ?? 7 };
    case "if_channel_available":
      return {
        ...(isContactCheck(step.check) ? { check: step.check } : {}),
        channel: step.channel || (step.check === "senderConnected" || step.check === "enteredOnChannel" ? "linkedin" : "email"),
        checkRegistration: step.check_registration ?? false,
        ...(typeof step.trigger_id === "string" && step.trigger_id ? { triggerId: step.trigger_id } : {}),
      };
    case "route_by_channel":
      return {
        channels: routeChannels({ channels: step.channels }),
        requireSender: step.require_sender ?? true,
        verifyOnUnipile: step.verify_on_unipile ?? false,
        entryChannelFirst: step.entry_channel_first ?? false,
      };
    case "schedule_meeting":
      return {
        titleTemplate: (step.title_template as string) || "Call with {contact_name}",
        durationMinutes: (step.duration_minutes as number) ?? 30,
        conferenceProvider: (step.conference_provider as string) || "google_meet",
        bodyTemplate: step.body_template || "",
        triggerCondition: (step.trigger_condition as string) || "positive_reply",
        templateId: step.template_id || undefined,
      };
    case "create_notion_page":
      return {
        connectionId: step.connection_id || undefined,
        databaseId: step.database_id || undefined,
        productId: step.product_id || undefined,
        blueprintIds: (step.blueprint_ids as string[]) || [],
        customPrompt: step.custom_prompt || undefined,
        icpThreshold: (step.icp_threshold as number) ?? 0,
        continueOnFailure: step.continue_on_failure ?? true,
        model: step.model || undefined,
      };
    case "send_to_smartlead":
    case "send_to_instantly":
    case "send_to_lead_connector":
    case "send_to_zapmail":
      return {
        connectionId: step.connection_id || undefined,
        externalCampaignId: step.external_campaign_id || undefined,
        externalWorkflowId: step.external_workflow_id || undefined,
        emailSubject: (step.email_subject as string) || "",
        emailBody: (step.email_body as string) || "",
        exitAfterHandoff: step.exit_after_handoff ?? true,
        messageMode: (step.message_mode as string) || "manual",
        prompt: step.prompt || undefined,
        promptVariations: step.prompt_variations || undefined,
        llmModel: step.llm_model || undefined,
        llmTemperature: step.llm_temperature || undefined,
        emailCount: (step.email_count as number) ?? 3,
        requireReview: step.require_review ?? true,
        ...(t === "send_to_zapmail" ? {
          enrollmentMode: (step.enrollment_mode as string) || "new",
          existingSequenceId: step.existing_sequence_id || undefined,
          existingSequenceName: step.existing_sequence_name || undefined,
        } : {}),
      };
    default:
      // view_profile, follow, instagram_follow, end, conditions without data
      return {};
  }
}

/**
 * Compile high-level steps DSL into React Flow nodes + edges.
 */
function compileStepsToSequence(steps: StepDef[]): {
  nodes: CompilerNode[];
  edges: CompilerEdge[];
  errors: string[];
  warnings: string[];
} {
  const nodes: CompilerNode[] = [];
  const edges: CompilerEdge[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let counter = 0;

  function genId(): string {
    counter++;
    const rand = Math.random().toString(36).substring(2, 8);
    return `node-${counter}-${rand}`;
  }

  // Start node
  const startId = "start";
  nodes.push({ id: startId, type: "start", position: { x: 0, y: 0 }, data: {} });

  /**
   * Compile a chain of steps. Returns the last node ID (or null if chain ends with condition).
   */
  function compileChain(chain: StepDef[], parentId: string, sourceHandle: string): string | null {
    let prevId = parentId;
    let prevHandle = sourceHandle;

    for (const step of chain) {
      const nodeType = STEP_TO_NODE_TYPE[step.type];
      if (!nodeType) {
        errors.push(`Unknown step type: "${step.type}"`);
        continue;
      }

      if (step.type === "if_channel_available" && step.check !== undefined && !isContactCheck(step.check)) {
        errors.push(`if_channel_available: unknown check "${step.check}". Use one of: ${CONTACT_CHECKS.join(", ")}`);
      }
      if (step.type === "route_by_channel" && routeChannels({ channels: step.channels }).length === 0) {
        errors.push(`route_by_channel needs "channels", e.g. ["linkedin", "email"] (from ${ROUTE_CHANNELS.join(", ")})`);
      }

      const nodeId = genId();
      const data = buildNodeData(step);

      nodes.push({ id: nodeId, type: nodeType, position: { x: 0, y: 0 }, data });
      edges.push({
        id: `edge-${prevId}-${nodeId}-${prevHandle}`,
        source: prevId,
        target: nodeId,
        sourceHandle: prevHandle,
        type: "sequenceEdge",
      });

      // Condition node: recurse into branches
      if (CONDITION_STEP_TYPES.has(step.type) && step.branches) {
        const branchMap = step.type === "route_by_channel" ? routeBranchMap(step) : BRANCH_TO_HANDLE[step.type];
        const branches = step.branches as Record<string, StepDef[]>;
        for (const [branchName, branchSteps] of Object.entries(branches)) {
          const handle = branchMap?.[branchName] || branchName;
          if (branchSteps.length === 0) {
            // Empty branch — add end node
            const endId = genId();
            nodes.push({ id: endId, type: "end", position: { x: 0, y: 0 }, data: {} });
            edges.push({
              id: `edge-${nodeId}-${endId}-${handle}`,
              source: nodeId,
              target: endId,
              sourceHandle: handle,
              type: "sequenceEdge",
            });
          } else {
            compileChain(branchSteps, nodeId, handle);
          }
        }
        // Check both branches are present
        if (branchMap) {
          for (const expectedBranch of Object.keys(branchMap)) {
            if (!branches[expectedBranch]) {
              warnings.push(`Condition "${step.type}" is missing "${expectedBranch}" branch — auto-adding end node`);
              const handle = branchMap[expectedBranch];
              const endId = genId();
              nodes.push({ id: endId, type: "end", position: { x: 0, y: 0 }, data: {} });
              edges.push({
                id: `edge-${nodeId}-${endId}-${handle}`,
                source: nodeId,
                target: endId,
                sourceHandle: handle,
                type: "sequenceEdge",
              });
            }
          }
        }
        return null; // Condition node branches don't have a single "next"
      }

      prevId = nodeId;
      prevHandle = "default";
    }

    return prevId;
  }

  if (steps.length === 0) {
    errors.push("Steps array is empty — campaign needs at least one action");
  } else {
    compileChain(steps, startId, "default");
  }

  // Validate: message nodes must have content
  for (const node of nodes) {
    if (node.type === "message" || node.type === "whatsappMessage" || node.type === "instagramDm" || node.type === "telegramMessage") {
      const isPrompt = node.data.messageMode === "prompt";
      if (isPrompt) {
        if (!node.data.prompt && !(node.data.promptVariations as string[] | undefined)?.length) {
          errors.push(`${node.type} node must have an AI prompt`);
        }
      } else if (!node.data.message && !(node.data.messageVariations as string[] | undefined)?.length) {
        errors.push(`${node.type} node must have message content`);
      }
    }
    if (node.type === "inmail") {
      if (!node.data.subject) errors.push("InMail node must have a subject");
      const isPrompt = node.data.messageMode === "prompt";
      if (isPrompt) {
        if (!node.data.prompt) errors.push("InMail node must have an AI prompt");
      } else if (!node.data.message) {
        errors.push("InMail node must have a message");
      }
    }
    if (node.type === "email") {
      if (!node.data.subject) errors.push("Email node must have a subject");
      const isPrompt = node.data.messageMode === "prompt";
      if (isPrompt) {
        if (!node.data.prompt) errors.push("Email node must have an AI prompt");
      } else if (!node.data.body && !(node.data.bodyVariations as string[] | undefined)?.length) {
        errors.push("Email node must have a body");
      }
    }
    if (node.type === "connectionRequest") {
      const isPrompt = node.data.messageMode === "prompt";
      if (isPrompt && !node.data.prompt) {
        warnings.push("Connection request has no AI prompt (will be sent without note)");
      } else if (!isPrompt && !node.data.message && !(node.data.messageVariations as string[] | undefined)?.length) {
        warnings.push("Connection request has no message (will be sent without note)");
      }
    }
  }

  // Apply auto-layout
  campaignAutoLayout(nodes, edges);

  return { nodes, edges, errors, warnings };
}

// ============================================================================
// Auto-Layout (ported from src/lib/auto-layout.ts)
// ============================================================================

const LAYOUT_NODE_WIDTH = 220;
const LAYOUT_H_GAP = 80;
const LAYOUT_V_SPACING = 160;

const CONTINUING_HANDLES = new Set([
  "noReply", "accepted", "analyzed", "enriched",
  "opened", "clicked", "available", "hasWhatsapp", "open",
  "default",
]);

const LEFT_HANDLES = new Set([
  "accepted", "replied", "analyzed", "enriched",
  "opened", "clicked", "available", "hasWhatsapp", "open",
]);

interface LayoutTreeNode {
  id: string;
  children: { handle: string; node: LayoutTreeNode }[];
  subtreeWidth: number;
}

function campaignAutoLayout(nodes: CompilerNode[], edges: CompilerEdge[]): void {
  if (nodes.length === 0) return;

  const childrenMap = new Map<string, { handle: string; targetId: string }[]>();
  for (const edge of edges) {
    const list = childrenMap.get(edge.source) || [];
    list.push({ handle: edge.sourceHandle || "default", targetId: edge.target });
    childrenMap.set(edge.source, list);
  }

  const startNode = nodes.find(n => n.type === "start");
  if (!startNode) return;

  const visited = new Set<string>();

  function buildTree(nodeId: string): LayoutTreeNode | null {
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);

    const outgoing = childrenMap.get(nodeId) || [];
    outgoing.sort((a, b) => {
      const aCont = CONTINUING_HANDLES.has(a.handle) ? 0 : 1;
      const bCont = CONTINUING_HANDLES.has(b.handle) ? 0 : 1;
      return aCont - bCont;
    });

    const children: { handle: string; node: LayoutTreeNode }[] = [];
    for (const { handle, targetId } of outgoing) {
      const child = buildTree(targetId);
      if (child) children.push({ handle, node: child });
    }

    let subtreeWidth: number;
    if (children.length === 0) {
      subtreeWidth = LAYOUT_NODE_WIDTH;
    } else if (children.length === 1) {
      subtreeWidth = Math.max(LAYOUT_NODE_WIDTH, children[0].node.subtreeWidth);
    } else {
      subtreeWidth = children.reduce((sum, c) => sum + c.node.subtreeWidth, 0)
        + LAYOUT_H_GAP * (children.length - 1);
    }

    return { id: nodeId, children, subtreeWidth };
  }

  const root = buildTree(startNode.id);
  if (!root) return;

  const positions = new Map<string, { x: number; y: number }>();

  function assignPositions(node: LayoutTreeNode, centerX: number, y: number) {
    positions.set(node.id, { x: centerX - LAYOUT_NODE_WIDTH / 2, y });

    if (node.children.length === 0) return;
    const childY = y + LAYOUT_V_SPACING;

    if (node.children.length === 1) {
      assignPositions(node.children[0].node, centerX, childY);
      return;
    }

    const childA = node.children[0];
    const childB = node.children[1];
    const exitIsLeft = LEFT_HANDLES.has(childB.handle);

    let leftChild: { handle: string; node: LayoutTreeNode };
    let rightChild: { handle: string; node: LayoutTreeNode };
    if (exitIsLeft) {
      leftChild = childB;
      rightChild = childA;
    } else {
      leftChild = childA;
      rightChild = childB;
    }

    const totalWidth = leftChild.node.subtreeWidth + LAYOUT_H_GAP + rightChild.node.subtreeWidth;
    const bandLeft = centerX - totalWidth / 2;
    const leftCenterX = bandLeft + leftChild.node.subtreeWidth / 2;
    const rightCenterX = bandLeft + leftChild.node.subtreeWidth + LAYOUT_H_GAP + rightChild.node.subtreeWidth / 2;

    assignPositions(leftChild.node, leftCenterX, childY);
    assignPositions(rightChild.node, rightCenterX, childY);

    let offsetX = rightCenterX + rightChild.node.subtreeWidth / 2 + LAYOUT_H_GAP;
    for (let i = 2; i < node.children.length; i++) {
      const extra = node.children[i];
      assignPositions(extra.node, offsetX + extra.node.subtreeWidth / 2, childY);
      offsetX += extra.node.subtreeWidth + LAYOUT_H_GAP;
    }
  }

  assignPositions(root, root.subtreeWidth / 2, 0);

  // Orphaned nodes
  const orphaned = nodes.filter(n => !visited.has(n.id));
  if (orphaned.length > 0) {
    const allPos = Array.from(positions.values());
    const maxX = allPos.length > 0 ? Math.max(...allPos.map(p => p.x)) : 0;
    const orphanStartX = maxX + LAYOUT_NODE_WIDTH + LAYOUT_H_GAP * 2;
    orphaned.forEach((node, i) => {
      positions.set(node.id, { x: orphanStartX, y: i * LAYOUT_V_SPACING });
    });
  }

  // Apply positions to nodes
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (pos) node.position = pos;
  }
}

// ============================================================================
// Sequence Summarizer (nodes/edges → human-readable tree)
// ============================================================================

const NODE_TYPE_LABELS: Record<string, string> = {
  start: "Campaign Start",
  end: "End",
  delay: "Delay",
  connectionRequest: "Connection Request",
  message: "LinkedIn Message",
  inmail: "InMail",
  email: "Email",
  viewProfile: "View Profile",
  follow: "Follow",
  likePost: "Like Post",
  warmupEngagement: "Warm-up Engagement",
  whatsappMessage: "WhatsApp Message",
  whatsappCheckNumber: "Check WhatsApp",
  instagramDm: "Instagram DM",
  instagramFollow: "Follow on Instagram",
  instagramLikePost: "Like Instagram Post",
  telegramMessage: "Telegram Message",
  switchChannel: "Switch Channel",
  goTo: "Go To",
  conditionConnection: "If Connected",
  conditionReplyReceived: "If Reply Received",
  conditionEmailOpened: "If Email Opened",
  conditionEmailClicked: "If Email Clicked",
  conditionOpenProfile: "If Open Profile",
  conditionChannelAvailable: "If Channel Available",
  routeByChannel: "Route by Channel",
  conditionEnriched: "If Enriched",
  conditionAnalyzed: "If Analyzed",
  findEmail: "Find Email",
  analyzeContact: "Analyze Contact",
  createNotionPage: "Create Notion Page",
  scheduleMeeting: "Schedule Meeting",
  sendToSmartlead: "Send to Smartlead",
  sendToInstantly: "Send to Instantly",
  sendToLeadConnector: "Send to LeadConnector",
  sendToZapMail: "Enroll in Email Sequence",
};

const HANDLE_LABELS: Record<string, string> = {
  accepted: "Accepted",
  notAccepted: "Not Accepted",
  replied: "Replied",
  noReply: "No Reply",
  opened: "Opened",
  notOpened: "Not Opened",
  clicked: "Clicked",
  notClicked: "Not Clicked",
  open: "Open Profile",
  closed: "Closed Profile",
  available: "Available",
  notAvailable: "Not Available",
  enriched: "Enriched",
  notEnriched: "Not Enriched",
  analyzed: "Analyzed",
  notAnalyzed: "Not Analyzed",
  hasWhatsapp: "Has WhatsApp",
  noWhatsapp: "No WhatsApp",
  linkedin: "LinkedIn",
  email: "Email",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  none: "No channel",
};

function summarizeSequence(nodes: CompilerNode[], edges: CompilerEdge[]): string {
  if (!nodes || nodes.length === 0) return "(empty sequence)";

  const nodeMap = new Map<string, CompilerNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const childrenMap = new Map<string, { handle: string; targetId: string }[]>();
  for (const e of edges) {
    const list = childrenMap.get(e.source) || [];
    list.push({ handle: e.sourceHandle || "default", targetId: e.target });
    childrenMap.set(e.source, list);
  }

  const startNode = nodes.find(n => n.type === "start");
  if (!startNode) return "(no start node)";

  const lines: string[] = [];
  let stepNum = 0;
  const visited = new Set<string>();

  function describeNode(node: CompilerNode): string {
    const label = NODE_TYPE_LABELS[node.type] || node.type;
    const d = node.data;
    if (node.type === "delay") {
      const parts: string[] = [];
      if (d.days) parts.push(`${d.days}d`);
      if (d.hours) parts.push(`${d.hours}h`);
      if (d.minutes) parts.push(`${d.minutes}m`);
      return `${label}: ${parts.join(" ") || "1d"}`;
    }
    if (d.message && typeof d.message === "string" && d.message.length > 0) {
      const msg = d.message.length > 60 ? d.message.substring(0, 57) + "..." : d.message;
      return `${label}: "${msg}"`;
    }
    if (d.subject && typeof d.subject === "string") {
      return `${label}: "${d.subject}"`;
    }
    if (d.messageMode === "prompt") {
      const p = (d.prompt as string) || "";
      const promptPreview = p.length > 50 ? p.substring(0, 47) + "..." : p;
      return `${label} (AI): "${promptPreview}"`;
    }
    return label;
  }

  function walk(nodeId: string, indent: string) {
    if (visited.has(nodeId)) {
      lines.push(`${indent}→ (loop back to ${nodeId})`);
      return;
    }
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) return;

    if (node.type === "start") {
      // Skip start node in summary, walk its children
      const children = childrenMap.get(nodeId) || [];
      if (children.length > 0) {
        walk(children[0].targetId, indent);
      }
      return;
    }

    stepNum++;
    const desc = describeNode(node);
    const children = childrenMap.get(nodeId) || [];

    if (children.length <= 1) {
      lines.push(`${indent}${stepNum}. ${desc}`);
      if (children.length === 1) {
        walk(children[0].targetId, indent);
      }
    } else {
      // Condition node with branches
      lines.push(`${indent}${stepNum}. ${desc}`);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const handleLabel = HANDLE_LABELS[child.handle] || child.handle;
        const isLast = i === children.length - 1;
        const prefix = isLast ? "└─" : "├─";
        const childIndent = isLast ? `${indent}   ` : `${indent}│  `;
        lines.push(`${indent}${prefix} ${handleLabel}:`);
        walk(child.targetId, childIndent);
      }
    }
  }

  walk(startNode.id, "");
  return lines.join("\n");
}

// ============================================================================
// Campaign CRUD Handlers
// ============================================================================

async function listSenderAccounts(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = ctx.effectiveOrgId;
  const channel = params.channel as string | undefined;

  let query = supabase
    .from("unipile_accounts")
    .select("id, display_name, provider, username, profile_url, avatar_url, status, metadata, created_at")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (channel) {
    const providerMap: Record<string, string> = {
      linkedin: "LINKEDIN",
      email: "MAIL",
      whatsapp: "WHATSAPP",
      instagram: "INSTAGRAM",
      telegram: "TELEGRAM",
    };
    const provider = providerMap[channel];
    if (provider) {
      query = query.eq("provider", provider);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list sender accounts: ${error.message}`);

  // Enrich LinkedIn accounts with Sales Navigator subscription info
  const enriched = (data || []).map((account: Record<string, unknown>) => {
    const result: Record<string, unknown> = { ...account };
    delete result.metadata; // Don't expose raw metadata

    if (account.provider === "LINKEDIN" && account.metadata) {
      const meta = account.metadata as Record<string, unknown>;
      const connectionParams = meta?.connection_params as Record<string, unknown> | undefined;
      const im = connectionParams?.im as Record<string, unknown> | undefined;
      const premiumFeatures = (im?.premiumFeatures || []) as unknown[];
      const premiumId = im?.premiumId;
      result.has_sales_navigator = !!(premiumId || premiumFeatures.length > 0);
    }

    return result;
  });

  return { sender_accounts: enriched };
}

async function listCampaigns(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = ctx.effectiveOrgId;
  const status = params.status as string | undefined;
  const search = params.search as string | undefined;
  const limit = Math.min((params.limit as number) || 20, 100);
  const offset = (params.offset as number) || 0;

  let query = supabase
    .from("linkedin_campaigns")
    .select("id, name, description, status, campaign_type, primary_channel, total_leads, processed_leads, contacted_leads, replied_count, connection_rate, lead_list_id, created_at, updated_at, started_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list campaigns: ${error.message}`);

  return { campaigns: data || [], count: (data || []).length, offset };
}

async function getCampaign(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = ctx.effectiveOrgId;
  const campaignId = params.campaign_id as string;
  if (!campaignId) throw new Error("campaign_id is required");

  const { data: campaign, error } = await supabase
    .from("linkedin_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("organization_id", orgId)
    .single();

  if (error || !campaign) throw new Error("Campaign not found");

  const includeSequence = params.include_sequence !== false;
  const result: Record<string, unknown> = { ...campaign };

  // Generate human-readable summary
  if (campaign.sequence_nodes && campaign.sequence_edges) {
    result.sequence_summary = summarizeSequence(
      campaign.sequence_nodes as CompilerNode[],
      campaign.sequence_edges as CompilerEdge[]
    );
  }

  if (!includeSequence) {
    delete result.sequence_nodes;
    delete result.sequence_edges;
  }

  // Lead progress summary
  if (params.include_leads_summary !== false) {
    const { data: progress } = await supabase
      .from("campaign_lead_progress")
      .select("status")
      .eq("campaign_id", campaignId);

    if (progress) {
      const summary: Record<string, number> = {};
      for (const p of progress) {
        summary[p.status] = (summary[p.status] || 0) + 1;
      }
      result.lead_progress_summary = summary;
    }
  }

  return { campaign: result };
}

// ============================================================================
// SMS + WhatsApp Business (Twilio) tools
// ============================================================================

async function listMessagingSenders(supabase: SupabaseClient, ctx: AuthContext, params: Record<string, unknown>): Promise<unknown> {
  let query = supabase
    .from("messaging_senders")
    .select("id, channel, address, address_type, country, two_way, daily_new_contact_cap, status, status_detail, wa_display_name, wa_quality_rating, wa_messaging_limit")
    .eq("organization_id", ctx.effectiveOrgId)
    .order("channel")
    .order("address");
  if (params.channel) query = query.eq("channel", params.channel as string);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list messaging senders: ${error.message}`);
  return { senders: data ?? [], count: data?.length ?? 0 };
}

async function listWhatsAppTemplates(supabase: SupabaseClient, ctx: AuthContext, params: Record<string, unknown>): Promise<unknown> {
  let query = supabase
    .from("whatsapp_templates")
    .select("id, name, language, category, body, variables, buttons, approval_status, rejected_reason, synced_at")
    .eq("organization_id", ctx.effectiveOrgId)
    .order("created_at", { ascending: false });
  if (params.status) query = query.eq("approval_status", params.status as string);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list WhatsApp templates: ${error.message}`);
  return { templates: data ?? [], count: data?.length ?? 0 };
}

/** "12% of delivered" style step conversion; null below the sample floor. */
function stepRate(part: number, base: number, floor: number): number | null {
  return base >= floor && base > 0 ? Math.round((part / base) * 1000) / 10 : null;
}

async function getMessagingFunnel(supabase: SupabaseClient, ctx: AuthContext, params: Record<string, unknown>): Promise<unknown> {
  const days = Number(params.days ?? 90);
  const { data, error } = await supabase.rpc("messaging_funnel", {
    p_org_id: ctx.effectiveOrgId,
    p_campaign_id: (params.campaign_id as string) || null,
    p_since: new Date(Date.now() - days * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`Failed to load funnel: ${error.message}`);
  const rows = (data ?? []) as Record<string, number | string>[];
  return {
    window_days: days,
    note: "Counted in leads. Rates are step conversions: delivered % of sent, replied % of delivered, positive % of replies (needs 5+ replies), booked % of positive (needs 3+). Out-of-office and auto-replies are excluded from replies.",
    rows: rows.map((r) => ({
      ...r,
      delivered_rate: stepRate(Number(r.delivered), Number(r.sent), 1),
      reply_rate: stepRate(Number(r.replied), Number(r.delivered), 1),
      positive_rate: stepRate(Number(r.positive), Number(r.replied), 5),
      booked_rate: stepRate(Number(r.booked), Number(r.positive), 3),
    })),
  };
}

// Same flow as src/lib/dbr-campaign-template.ts (keep in sync)
const DBR_FIRST_SMS = "Hi {{first_name}}, you asked us about this a while back. Is it still something you're looking into?";
const DBR_LAST_SMS = "Hi {{first_name}}, last message from me. Should I close your file, or is there a better time to talk?";

async function createDbrCampaign(supabase: SupabaseClient, ctx: AuthContext, params: Record<string, unknown>): Promise<unknown> {
  const templateId = (params.whatsapp_template_id as string) || null;
  let templateName: string | undefined;
  if (templateId) {
    const { data: template } = await supabase
      .from("whatsapp_templates")
      .select("id, name, approval_status")
      .eq("id", templateId)
      .eq("organization_id", ctx.effectiveOrgId)
      .maybeSingle();
    if (!template) throw new Error("WhatsApp template not found (list_whatsapp_templates)");
    if (!["approved", "pending", "submitted"].includes(template.approval_status)) {
      throw new Error(`Template "${template.name}" is ${template.approval_status}; pick an approved one`);
    }
    templateName = template.name;
  }

  const agentId = (params.agent_profile_id as string) || null;
  if (agentId) {
    const { data: agent } = await supabase
      .from("ai_agent_profiles")
      .select("id")
      .eq("id", agentId)
      .eq("organization_id", ctx.effectiveOrgId)
      .maybeSingle();
    if (!agent) throw new Error("AI agent not found (list_agent_profiles)");
  }
  // Agent on right after each send: a reply stops the campaign, so a later handoff never runs
  const handoff = (channel: string): StepDef[] =>
    agentId ? [{ type: "handoff_to_agent", agent_profile_id: agentId, exit_after_handoff: false, channel, continue_on_failure: true }] : [];

  const steps: StepDef[] = [];
  if (templateId) {
    steps.push({ type: "whatsapp_template", template_id: templateId, template_name: templateName, continue_on_failure: true });
    steps.push(...handoff("whatsapp"));
    steps.push({ type: "delay", days: Number(params.days_after_whatsapp ?? 2) });
  }
  steps.push({ type: "sms", message: (params.first_sms as string) || DBR_FIRST_SMS });
  steps.push(...handoff("sms"));
  steps.push({ type: "delay", days: Number(params.days_between_sms ?? 3) });
  steps.push({ type: "sms", message: (params.last_sms as string) || DBR_LAST_SMS });
  steps.push({ type: "end" });

  return createCampaign(supabase, ctx, {
    name: (params.name as string) || "Database reactivation",
    description: "Database reactivation over WhatsApp Business and SMS",
    lead_list_id: params.lead_list_id,
    steps,
    campaign_type: "sms_whatsapp",
    primary_channel: "sms",
    agent_profile_id: agentId,
  });
}

async function createCampaign(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = ctx.effectiveOrgId;
  const name = params.name as string;
  if (!name || name.length < 3) throw new Error("Campaign name must be at least 3 characters");

  const steps = (params.steps as StepDef[]) || [];
  let sequenceNodes: CompilerNode[] = [];
  let sequenceEdges: CompilerEdge[] = [];
  let validationErrors: string[] = [];
  let validationWarnings: string[] = [];

  if (steps.length > 0) {
    const compiled = compileStepsToSequence(steps);
    sequenceNodes = compiled.nodes;
    sequenceEdges = compiled.edges;
    validationErrors = compiled.errors;
    validationWarnings = compiled.warnings;
  } else {
    // Empty sequence — just a start node
    sequenceNodes = [{ id: "start", type: "start", position: { x: 250, y: 50 }, data: {} }];
  }

  const insertData: Record<string, unknown> = {
    organization_id: orgId,
    name,
    description: params.description || null,
    status: "draft",
    lead_list_id: params.lead_list_id || null,
    exclusion_list_ids: params.exclusion_list_ids || [],
    exclude_other_campaigns: params.exclude_other_campaigns ?? true,
    exclude_same_sender: params.exclude_same_sender ?? true,
    sender_account_ids: params.sender_account_ids || [],
    sequence_nodes: sequenceNodes,
    sequence_edges: sequenceEdges,
    stop_on_reply: params.stop_on_reply ?? true,
    campaign_type: params.campaign_type || "linkedin_only",
    primary_channel: params.primary_channel || "linkedin",
    channel_fallback_enabled: params.channel_fallback_enabled ?? false,
    fallback_order: params.fallback_order || [],
    campaign_settings: params.campaign_settings || {},
    created_by: ctx.userId,
  };

  // Multi-channel sender accounts
  if (params.sender_accounts) {
    insertData.sender_accounts = params.sender_accounts;
  }
  if (params.agent_profile_id) {
    // Only an agent of this org (the id comes from the caller)
    const { data: agent } = await supabase
      .from("ai_agent_profiles")
      .select("id")
      .eq("id", params.agent_profile_id as string)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!agent) throw new Error("AI agent not found (list_agent_profiles)");
    insertData.agent_profile_id = agent.id;
  }

  // Senders are loaded by id alone downstream (campaign-processor): never store another org's account.
  await assertOwned(supabase, orgId, "unipile_accounts", senderAccountIdsFrom(params), "Sender account");

  const { data: campaign, error } = await supabase
    .from("linkedin_campaigns")
    .insert(insertData)
    .select("id, name, status, campaign_type, primary_channel, lead_list_id, created_at")
    .single();

  if (error) throw new Error(`Failed to create campaign: ${error.message}`);

  const summary = summarizeSequence(sequenceNodes, sequenceEdges);

  return {
    campaign,
    sequence_summary: summary,
    sequence_stats: {
      total_nodes: sequenceNodes.length,
      action_count: sequenceNodes.filter(n =>
        !["start", "end", "delay", "goTo", "switchChannel"].includes(n.type) &&
        !n.type.startsWith("condition") &&
        n.type !== "whatsappCheckNumber"
      ).length,
    },
    validation: {
      valid: validationErrors.length === 0,
      errors: validationErrors,
      warnings: validationWarnings,
    },
  };
}

async function updateCampaign(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = ctx.effectiveOrgId;
  const campaignId = params.campaign_id as string;
  if (!campaignId) throw new Error("campaign_id is required");

  // Check campaign exists and is editable
  const { data: existing, error: fetchError } = await supabase
    .from("linkedin_campaigns")
    .select("id, status")
    .eq("id", campaignId)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !existing) throw new Error("Campaign not found");
  if (existing.status === "active") {
    throw new Error("Cannot update an active campaign. Pause it first.");
  }

  const updates: Record<string, unknown> = {};
  const directFields = [
    "name", "description", "lead_list_id", "sender_account_ids",
    "exclusion_list_ids", "exclude_other_campaigns", "exclude_same_sender",
    "stop_on_reply", "campaign_type", "primary_channel",
    "channel_fallback_enabled", "fallback_order", "campaign_settings",
    "autopilot_config", "icp_product_id", "min_icp_score",
    "sender_accounts", "agent_profile_id",
  ];

  for (const field of directFields) {
    if (params[field] !== undefined) {
      updates[field] = params[field];
    }
  }

  await assertOwned(supabase, orgId, "unipile_accounts", senderAccountIdsFrom(params), "Sender account");

  let validationErrors: string[] = [];
  let validationWarnings: string[] = [];

  // Recompile steps if provided
  if (params.steps) {
    const steps = params.steps as StepDef[];
    const compiled = compileStepsToSequence(steps);
    updates.sequence_nodes = compiled.nodes;
    updates.sequence_edges = compiled.edges;
    validationErrors = compiled.errors;
    validationWarnings = compiled.warnings;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("No fields to update");
  }

  const { data: campaign, error } = await supabase
    .from("linkedin_campaigns")
    .update(updates)
    .eq("id", campaignId)
    .eq("organization_id", orgId)
    .select("id, name, status, campaign_type, lead_list_id, updated_at")
    .single();

  if (error) throw new Error(`Failed to update campaign: ${error.message}`);

  const result: Record<string, unknown> = { campaign };
  if (params.steps) {
    result.validation = {
      valid: validationErrors.length === 0,
      errors: validationErrors,
      warnings: validationWarnings,
    };
  }

  return result;
}

async function updateCampaignStatus(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = ctx.effectiveOrgId;
  const campaignId = params.campaign_id as string;
  const targetStatus = params.status as string;

  if (!campaignId) throw new Error("campaign_id is required");
  if (!["active", "paused", "draft"].includes(targetStatus)) {
    throw new Error("status must be 'active', 'paused', or 'draft'");
  }

  const { data: campaign, error: fetchError } = await supabase
    .from("linkedin_campaigns")
    .select("id, status, lead_list_id, sender_account_ids, sequence_nodes, sequence_edges")
    .eq("id", campaignId)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !campaign) throw new Error("Campaign not found");

  // Validate before activating
  if (targetStatus === "active") {
    const problems: string[] = [];
    if (!campaign.lead_list_id) problems.push("No lead list selected");
    if (!campaign.sender_account_ids || campaign.sender_account_ids.length === 0) {
      problems.push("No sender accounts selected");
    }
    const nodes = (campaign.sequence_nodes || []) as CompilerNode[];
    const actionNodes = nodes.filter(n =>
      !["start", "end", "delay", "goTo", "switchChannel"].includes(n.type) &&
      !n.type.startsWith("condition") &&
      n.type !== "whatsappCheckNumber"
    );
    if (actionNodes.length === 0) {
      problems.push("Sequence has no action nodes");
    }
    if (problems.length > 0) {
      throw new Error(`Cannot activate campaign: ${problems.join("; ")}`);
    }
  }

  const updates: Record<string, unknown> = { status: targetStatus };
  if (targetStatus === "active" && campaign.status !== "active") {
    updates.started_at = new Date().toISOString();
  }
  if (targetStatus === "paused") {
    updates.paused_at = new Date().toISOString();
  }

  const { data: updated, error } = await supabase
    .from("linkedin_campaigns")
    .update(updates)
    .eq("id", campaignId)
    .eq("organization_id", orgId)
    .select("id, name, status, started_at, paused_at")
    .single();

  if (error) throw new Error(`Failed to update campaign status: ${error.message}`);

  return { campaign: updated };
}

async function deleteCampaigns(
  supabase: SupabaseClient,
  ctx: AuthContext,
  params: Record<string, unknown>
): Promise<unknown> {
  const orgId = ctx.effectiveOrgId;
  const campaignIds = params.campaign_ids as string[];
  if (!campaignIds || campaignIds.length === 0) throw new Error("campaign_ids is required");

  // Check all are draft/paused
  const { data: campaigns } = await supabase
    .from("linkedin_campaigns")
    .select("id, status")
    .eq("organization_id", orgId)
    .in("id", campaignIds);

  const activeOnes = (campaigns || []).filter(c => c.status === "active");
  if (activeOnes.length > 0) {
    throw new Error(`Cannot delete active campaigns. Pause them first. Active: ${activeOnes.map(c => c.id).join(", ")}`);
  }

  const { error } = await supabase
    .from("linkedin_campaigns")
    .delete()
    .eq("organization_id", orgId)
    .in("id", campaignIds);

  if (error) throw new Error(`Failed to delete campaigns: ${error.message}`);

  return { deleted: campaignIds.length, campaign_ids: campaignIds };
}

// ============================================================================
// MCP Protocol Handler
// ============================================================================

const TOOL_DEFINITIONS = {
  // Help & Documentation
  get_help: {
    description: "Get documentation about ACA MCP tools and how to use them. Call this first to understand available capabilities.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["overview", "ideas", "library", "content_generation", "blueprints", "organizations", "campaigns", "autopilots", "all"],
          description: "Help topic: overview (start here), ideas, library, content_generation, blueprints, organizations, campaigns (outreach sequences), or all"
        },
      },
    },
  },

  // Ideas
  list_ideas: {
    description: "List content ideas with optional filtering. Returns compact results by default (excludes large ai_analysis field). Use get_idea for full details of a specific idea.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search in idea titles" },
        limit: { type: "number", description: "Max results (default 20)" },
        offset: { type: "number", description: "Pagination offset" },
        include_analysis: { type: "boolean", description: "Include ai_analysis field (warning: can make response very large)" },
      },
    },
  },
  get_idea: {
    description: "Get full details of a single content idea including ai_analysis",
    inputSchema: {
      type: "object",
      properties: {
        idea_id: { type: "string", description: "The idea UUID" },
      },
      required: ["idea_id"],
    },
  },
  create_idea: {
    description: "💡 SAVE a content topic/idea to the ideas list (NOT for generating content). Use to store a brief content topic with title and keywords. This does NOT generate any content - just saves an idea for later. To GENERATE content (articles, videos, images), use trigger_content_generation instead. You can include ai_analysis with hooks, CTAs, talking_points, script_structure, and engagement_drivers.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The idea title (short, one-liner)" },
        keywords: { type: "array", items: { type: "string" }, description: "Keywords/tags" },
        emotional_triggers: { type: "array", items: { type: "string" }, description: "Emotional hooks" },
        content_framework: { type: "string", description: "Content structure" },
        brand_voice_id: { type: "string", description: "Brand voice UUID" },
        product_id: { type: "string", description: "Product UUID" },
        tag_ids: { type: "array", items: { type: "string" }, description: "Tag UUIDs to assign" },
        ai_analysis: {
          type: "object",
          description: "AI analysis with hooks, CTAs, talking points, script structure, and engagement drivers",
          properties: {
            hooks: { type: "array", items: { type: "object", properties: { text: { type: "string" }, type: { type: "string", description: "e.g. question, statistic, story, bold_claim, curiosity_gap" } } }, description: "Array of content hooks" },
            ctas: { type: "array", items: { type: "object", properties: { text: { type: "string" }, placement: { type: "string", description: "e.g. end, middle, throughout" }, type: { type: "string", description: "e.g. direct, soft, question" } } }, description: "Array of calls-to-action" },
            talking_points: { type: "array", items: { type: "string" }, description: "The points the post has to make. Only facts from the idea's notes, source or product; no invented numbers. They start as drafts a person approves in the app." },
            avoid: { type: "array", items: { type: "string" }, description: "Things posts from this idea must not mention (e.g. pricing, competitor names)" },
            script_structure: { type: "object", properties: { opening: { type: "string" }, body: { type: "string" }, climax: { type: "string" }, closing: { type: "string" } }, description: "Script structure breakdown" },
            engagement_drivers: { type: "array", items: { type: "string" }, description: "Engagement drivers / psychological triggers" },
          },
        },
      },
      required: ["title"],
    },
  },
  bulk_create_ideas: {
    description: "💡 SAVE multiple content topics/ideas at once (max 100). Does NOT generate content - just saves ideas for later use. Each idea can include brand_voice_id, product_id, ai_analysis (hooks, CTAs, talking_points, script_structure, engagement_drivers), and content details.",
    inputSchema: {
      type: "object",
      properties: {
        ideas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "The idea title (short, one-liner)" },
              keywords: { type: "array", items: { type: "string" }, description: "Keywords/tags" },
              emotional_triggers: { type: "array", items: { type: "string" }, description: "Emotional hooks" },
              content_framework: { type: "string", description: "Content structure" },
              brand_voice_id: { type: "string", description: "Brand voice UUID" },
              product_id: { type: "string", description: "Product UUID" },
              tag_ids: { type: "array", items: { type: "string" }, description: "Tag UUIDs to assign" },
              ai_analysis: {
                type: "object",
                description: "AI analysis with hooks, CTAs, talking points, script structure, and engagement drivers",
                properties: {
                  hooks: { type: "array", items: { type: "object", properties: { text: { type: "string" }, type: { type: "string" } } }, description: "Array of content hooks" },
                  ctas: { type: "array", items: { type: "object", properties: { text: { type: "string" }, placement: { type: "string" }, type: { type: "string" } } }, description: "Array of calls-to-action" },
                  talking_points: { type: "array", items: { type: "string" }, description: "The points the post has to make. Only facts from the idea's notes, source or product; no invented numbers. They start as drafts a person approves in the app." },
                  avoid: { type: "array", items: { type: "string" }, description: "Things posts from this idea must not mention (e.g. pricing, competitor names)" },
                  script_structure: { type: "object", properties: { opening: { type: "string" }, body: { type: "string" }, climax: { type: "string" }, closing: { type: "string" } } },
                  engagement_drivers: { type: "array", items: { type: "string" }, description: "Engagement drivers" },
                },
              },
            },
            required: ["title"],
          },
        },
      },
      required: ["ideas"],
    },
  },
  update_idea: {
    description: "Update an existing content idea. Can update any field including ai_analysis (hooks, CTAs, talking_points, script_structure, engagement_drivers).",
    inputSchema: {
      type: "object",
      properties: {
        idea_id: { type: "string", description: "The idea UUID" },
        title: { type: "string" },
        keywords: { type: "array", items: { type: "string" } },
        emotional_triggers: { type: "array", items: { type: "string" } },
        content_framework: { type: "string" },
        brand_voice_id: { type: "string" },
        product_id: { type: "string" },
        ai_analysis: {
          type: "object",
          description: "AI analysis with hooks, CTAs, talking points, script structure, and engagement drivers",
          properties: {
            hooks: { type: "array", items: { type: "object", properties: { text: { type: "string" }, type: { type: "string" } } }, description: "Array of content hooks" },
            ctas: { type: "array", items: { type: "object", properties: { text: { type: "string" }, placement: { type: "string" }, type: { type: "string" } } }, description: "Array of calls-to-action" },
            talking_points: { type: "array", items: { type: "string" }, description: "The points the post has to make. Only facts from the idea's notes, source or product; no invented numbers. They start as drafts a person approves in the app." },
            avoid: { type: "array", items: { type: "string" }, description: "Things posts from this idea must not mention (e.g. pricing, competitor names)" },
            script_structure: { type: "object", properties: { opening: { type: "string" }, body: { type: "string" }, climax: { type: "string" }, closing: { type: "string" } } },
            engagement_drivers: { type: "array", items: { type: "string" }, description: "Engagement drivers" },
          },
        },
      },
      required: ["idea_id"],
    },
  },
  delete_ideas: {
    description: "Delete one or more content ideas",
    inputSchema: {
      type: "object",
      properties: {
        idea_ids: { type: "array", items: { type: "string" }, description: "UUIDs of ideas to delete" },
      },
      required: ["idea_ids"],
    },
  },

  // Tags
  list_tags: {
    description: "List all idea tags",
    inputSchema: { type: "object", properties: {} },
  },
  create_tag: {
    description: "Create a new idea tag",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tag name" },
      },
      required: ["name"],
    },
  },
  assign_tags: {
    description: "Assign tags to an idea (replaces existing tags)",
    inputSchema: {
      type: "object",
      properties: {
        idea_id: { type: "string", description: "The idea UUID" },
        tag_ids: { type: "array", items: { type: "string" }, description: "Tag UUIDs to assign" },
      },
      required: ["idea_id", "tag_ids"],
    },
  },

  // Library
  list_brand_voices: {
    description: "List all brand voice configurations",
    inputSchema: { type: "object", properties: {} },
  },
  create_brand_voice: {
    description: "Create a new brand voice",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        tone: { type: "string" },
        style_guidelines: { type: "string" },
        mood_keywords: { type: "array", items: { type: "string" } },
      },
      required: ["name"],
    },
  },
  get_brand_voice: {
    description: "Get a single brand voice by ID with all visual identity details",
    inputSchema: {
      type: "object",
      properties: {
        brand_voice_id: { type: "string", description: "The brand voice UUID" },
      },
      required: ["brand_voice_id"],
    },
  },
  update_brand_voice: {
    description: "Update an existing brand voice configuration",
    inputSchema: {
      type: "object",
      properties: {
        brand_voice_id: { type: "string", description: "The brand voice UUID" },
        name: { type: "string" },
        description: { type: "string" },
        tone: { type: "string" },
        style_guidelines: { type: "string" },
        mood_keywords: { type: "array", items: { type: "string" } },
        color_palette: { type: "object", description: "Color palette configuration" },
        font_style: { type: "string" },
        visual_style_description: { type: "string" },
      },
      required: ["brand_voice_id"],
    },
  },
  delete_brand_voices: {
    description: "Delete one or more brand voices by their IDs",
    inputSchema: {
      type: "object",
      properties: {
        brand_voice_ids: { type: "array", items: { type: "string" }, description: "UUIDs of brand voices to delete" },
      },
      required: ["brand_voice_ids"],
    },
  },
  list_products: {
    description: "List all products",
    inputSchema: { type: "object", properties: {} },
  },
  create_product: {
    description: "Create a new product",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        features: { type: "array", items: { type: "string" } },
        key_benefits: { type: "array", items: { type: "string" } },
        category: { type: "string" },
      },
      required: ["name"],
    },
  },
  get_product: {
    description: "Get a single product by ID with all details including features, benefits, and media",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The product UUID" },
      },
      required: ["product_id"],
    },
  },
  update_product: {
    description: "Update an existing product",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The product UUID" },
        name: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        brand: { type: "string" },
        features: { type: "array", items: { type: "string" } },
        key_benefits: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        price: { type: "number" },
        currency: { type: "string" },
        sku: { type: "string" },
      },
      required: ["product_id"],
    },
  },
  delete_products: {
    description: "Delete one or more products by their IDs",
    inputSchema: {
      type: "object",
      properties: {
        product_ids: { type: "array", items: { type: "string" }, description: "UUIDs of products to delete" },
      },
      required: ["product_ids"],
    },
  },
  list_icps: {
    description: "List all Ideal Customer Profiles",
    inputSchema: { type: "object", properties: {} },
  },
  create_icp: {
    description: "Create a new Ideal Customer Profile (ICP)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "ICP name" },
        description: { type: "string", description: "ICP description" },
        summary: { type: "string", description: "One-sentence ICP summary. Template: '[Who] struggling with [problem] who have tried [thing] but [why it failed].'" },
        pain_points: { type: "array", items: { type: "string" }, description: "Customer pain points" },
        desires: { type: "array", items: { type: "string" }, description: "Customer desires/goals" },
        objections: { type: "array", items: { type: "string" }, description: "Common objections" },
        language_style: { type: "string", description: "How this audience speaks/communicates" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for organization" },
        target_locations: { type: "array", items: { type: "string" }, description: "Target geographies (free text: countries, regions, or cities, e.g. 'United States', 'DACH', 'London'). Used to score geographic fit during company analysis." },
      },
      required: ["name"],
    },
  },
  update_icp: {
    description: "Update an existing ICP",
    inputSchema: {
      type: "object",
      properties: {
        icp_id: { type: "string", description: "The ICP UUID" },
        name: { type: "string" },
        description: { type: "string" },
        summary: { type: "string", description: "One-sentence ICP summary" },
        pain_points: { type: "array", items: { type: "string" } },
        desires: { type: "array", items: { type: "string" } },
        objections: { type: "array", items: { type: "string" } },
        language_style: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        target_locations: { type: "array", items: { type: "string" }, description: "Target geographies (free text: countries, regions, or cities)." },
      },
      required: ["icp_id"],
    },
  },
  delete_icps: {
    description: "Delete one or more ICPs",
    inputSchema: {
      type: "object",
      properties: {
        icp_ids: { type: "array", items: { type: "string" }, description: "UUIDs of ICPs to delete" },
      },
      required: ["icp_ids"],
    },
  },

  // Characters
  list_characters: {
    description: "List all AI characters/personas with their personality traits, voice settings, and reference images",
    inputSchema: {
      type: "object",
      properties: {
        visual_style: { type: "string", description: "Filter by visual style" },
        gender: { type: "string", description: "Filter by gender" },
      },
    },
  },
  create_character: {
    description: "Create a new AI character/persona for use in content generation. Use list_voices first to get available ElevenLabs voice IDs for voice_selection.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Character name" },
        description: { type: "string", description: "Character description" },
        visual_style: { type: "string", description: "Visual style (e.g., Photorealistic, Cartoon, Anime)" },
        gender: { type: "string", enum: ["male", "female", "non-binary", "other"], description: "Character gender" },
        age_range: { type: "string", description: "Age range (e.g., 25-35)" },
        build: { type: "string", description: "Body build (e.g., Athletic, Average)" },
        ethnicity: { type: "string", description: "Ethnicity" },
        hair_description: { type: "string", description: "Hair description" },
        typical_clothing: { type: "string", description: "Typical clothing style" },
        personality: { type: "object", description: "Personality object with description" },
        personality_traits: { type: "array", items: { type: "string" }, description: "Personality traits list" },
        speaking_style: { type: "string", description: "How the character speaks/communicates" },
        overall_tone: { type: "string", description: "Overall tone (e.g., Professional, Friendly)" },
        voice_selection: { type: "string", description: "ElevenLabs voice_id (use list_voices to get available voices)" },
        reference_image_urls: { type: "array", items: { type: "string" }, description: "URLs to reference images (already hosted)" },
        reference_image_data: { type: "array", items: { type: "string" }, description: "Base64 encoded images to upload" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for organization" },
        background: { type: "string", description: "Character backstory/background" },
      },
      required: ["name"],
    },
  },
  get_character: {
    description: "Get full character details including all visual and voice configuration",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "The character UUID" },
      },
      required: ["character_id"],
    },
  },
  update_character: {
    description: "Update an existing character's attributes. Use add_reference_image_urls/data to add images, remove_reference_image_urls to remove them.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "The character UUID" },
        name: { type: "string" },
        description: { type: "string" },
        visual_style: { type: "string" },
        gender: { type: "string", enum: ["male", "female", "non-binary", "other"] },
        age_range: { type: "string" },
        build: { type: "string" },
        ethnicity: { type: "string" },
        hair_description: { type: "string" },
        typical_clothing: { type: "string" },
        personality: { type: "object" },
        speaking_style: { type: "string" },
        overall_tone: { type: "string" },
        voice_selection: { type: "string", description: "ElevenLabs voice_id" },
        tags: { type: "array", items: { type: "string" } },
        add_reference_image_urls: { type: "array", items: { type: "string" }, description: "Image URLs to add" },
        add_reference_image_data: { type: "array", items: { type: "string" }, description: "Base64 images to upload and add" },
        remove_reference_image_urls: { type: "array", items: { type: "string" }, description: "Image URLs to remove" },
      },
      required: ["character_id"],
    },
  },
  delete_characters: {
    description: "Delete one or more characters by their IDs",
    inputSchema: {
      type: "object",
      properties: {
        character_ids: { type: "array", items: { type: "string" }, description: "UUIDs of characters to delete" },
      },
      required: ["character_ids"],
    },
  },

  // Pipelines & Models Reference (for blueprint creation)
  list_pipelines: {
    description: "🔧 List all available content generation pipelines with their required/optional models. IMPORTANT: Call this before creating a blueprint to understand which pipeline to use and what models are required.",
    inputSchema: { type: "object", properties: {} },
  },
  list_available_models: {
    description: "🔧 List available AI models for each model type. Use with list_pipelines to configure model_config when creating blueprints. Filter by model_type for specific category.",
    inputSchema: {
      type: "object",
      properties: {
        model_type: {
          type: "string",
          enum: ["text_llm", "image_generator", "tts", "image_to_video", "world_simulator", "face_swap"],
          description: "Filter by model type (optional - returns all if not specified)",
        },
      },
    },
  },
  get_blueprint_schema: {
    description: "🔧 Get the complete schema for creating blueprints, including prompt variable syntax, model configuration, and examples. IMPORTANT: Call this before creating your first blueprint to understand the structure.",
    inputSchema: { type: "object", properties: {} },
  },
  list_voices: {
    description: "🔧 List available ElevenLabs voices for text-to-speech. Use voice_id in model_config.tts.parameters when creating blueprints for video pipelines.",
    inputSchema: { type: "object", properties: {} },
  },

  // Blueprints - TEMPLATES/CONFIGURATIONS (NOT for generating content)
  list_blueprints: {
    description: "📋 List saved blueprint TEMPLATES. Blueprints are reusable prompt configurations - they do NOT generate content themselves. To generate content, use trigger_content_generation with a blueprint_id.",
    inputSchema: {
      type: "object",
      properties: {
        pipeline: { type: "string", description: "Filter by pipeline type" },
        is_active: { type: "boolean", description: "Filter by active status" },
      },
    },
  },
  get_blueprint: {
    description: "Get full details of a blueprint TEMPLATE including its prompts and configuration.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "string" },
      },
      required: ["blueprint_id"],
    },
  },
  create_blueprint: {
    description: "📋 CREATE a blueprint TEMPLATE for content generation. Call get_blueprint_schema first to understand the structure. Call list_pipelines to see available pipelines. Call list_available_models to see model options. Use {{variable}} syntax in prompts - library refs like {{product.name}}, {{brand.tone}}, {{icp.pain_points}}, or simple text like {{topic}}.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Blueprint name (e.g., 'LinkedIn Post Generator')" },
        description: { type: "string", description: "What this blueprint does" },
        pipeline: {
          type: "string",
          enum: ["rich_article", "social_media_post", "image_only", "generative_video_oneshot", "video_script", "storyboard_video_longform"],
          description: "Pipeline type - determines required models. Use list_pipelines to see options.",
        },
        master_prompt: {
          type: "string",
          description: "Main prompt template with {{variables}}. Use {{topic}}, {{title}} for text slots. Use {{product.name}}, {{brand.tone}}, {{icp.pain_points}} for library element fields. Use {{?optional_var}} for optional variables.",
        },
        image_prompt: {
          type: "string",
          description: "Prompt for image generation (required for image_only pipeline, optional for others). Same {{variable}} syntax as master_prompt.",
        },
        model_config: {
          type: "object",
          description: "Configure AI models for each stage. Keys: text_llm, image_generator, tts, image_to_video, world_simulator. Each has: {provider, model_id, parameters}. Use list_available_models to see options.",
          properties: {
            text_llm: {
              type: "object",
              description: "Text generation model: {provider: 'openrouter', model_id: 'anthropic/claude-sonnet-4.5', parameters: {}}",
            },
            image_generator: {
              type: "object",
              description: "Image generation model: {provider: 'openrouter', model_id: 'google/gemini-3.1-flash-image-preview', parameters: {}}",
            },
            tts: {
              type: "object",
              description: "Text-to-speech: {provider: 'elevenlabs', model_id: 'eleven_alpha_3', parameters: {voice_id: '...'}}",
            },
            image_to_video: {
              type: "object",
              description: "I2V model: {provider: 'replicate', model_id: 'kwaivgi/kling-v2.5-turbo-pro', parameters: {}}",
            },
            world_simulator: {
              type: "object",
              description: "T2V model: {provider: 'replicate', model_id: 'google/veo-3.1', parameters: {}}",
            },
          },
        },
        structure: {
          type: "object",
          description: "Optional - slots are auto-parsed from prompts. Only provide if you need custom slot configuration.",
          properties: {
            slots: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", description: "Variable name (e.g., 'topic', 'product')" },
                  type: { type: "string", enum: ["text", "library_element"], description: "Slot type" },
                  label: { type: "string", description: "Human-readable label" },
                  library_table: { type: "string", description: "For library_element type: library_products, library_brand_voices, library_icps, library_characters, library_blocks" },
                  required: { type: "boolean" },
                },
              },
            },
          },
        },
        tags: { type: "array", items: { type: "string" }, description: "Tags for organization" },
        reference_image_libraries: {
          type: "array",
          items: { type: "string", enum: ["library_products", "library_characters", "library_brand_voices"] },
          description: "Library types to pull reference images from (for image generation)",
        },
        is_active: { type: "boolean", description: "Whether blueprint is active (default: true)" },
      },
      required: ["name", "pipeline"],
    },
  },
  update_blueprint: {
    description: "Update an existing blueprint TEMPLATE configuration.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "string", description: "The blueprint UUID" },
        name: { type: "string" },
        master_prompt: { type: "string" },
        image_prompt: { type: "string" },
        structure: { type: "object" },
        model_config: { type: "object" },
        pipeline: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        is_active: { type: "boolean" },
      },
      required: ["blueprint_id"],
    },
  },
  delete_blueprint: {
    description: "Delete a blueprint TEMPLATE.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "string", description: "UUID of the blueprint to delete" },
      },
      required: ["blueprint_id"],
    },
  },

  // Blocks (hooks, angles, CTAs, story elements)
  list_blocks: {
    description: "List content blocks (hooks, angles, CTAs, story elements)",
    inputSchema: {
      type: "object",
      properties: {
        block_type: {
          type: "string",
          enum: ["hook", "angle", "cta", "story_element"],
          description: "Filter by block type",
        },
      },
    },
  },
  create_block: {
    description: "Create a single content block",
    inputSchema: {
      type: "object",
      properties: {
        block_type: {
          type: "string",
          enum: ["hook", "angle", "cta", "story_element"],
          description: "Type of block",
        },
        content: { type: "string", description: "The block content/text" },
        name: { type: "string", description: "Optional name for the block" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["block_type", "content"],
    },
  },
  bulk_create_blocks: {
    description: "Create multiple content blocks at once (max 100)",
    inputSchema: {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              block_type: { type: "string", enum: ["hook", "angle", "cta", "story_element"] },
              content: { type: "string" },
              name: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["block_type", "content"],
          },
          maxItems: 100,
          description: "Array of blocks to create",
        },
      },
      required: ["blocks"],
    },
  },
  delete_blocks: {
    description: "Delete multiple blocks",
    inputSchema: {
      type: "object",
      properties: {
        block_ids: { type: "array", items: { type: "string" }, description: "UUIDs of blocks to delete" },
      },
      required: ["block_ids"],
    },
  },

  // Strategy Documents - FOR STORING MARKETING PLANS/DOCUMENTS (NOT for generating content)
  list_strategy_documents: {
    description: "List saved strategy documents (marketing plans, lead magnets, etc.). These are reference documents, NOT generated content.",
    inputSchema: {
      type: "object",
      properties: {
        document_type: {
          type: "string",
          enum: ["lead_magnet", "sales_strategy", "content_calendar", "funnel", "email_sequence", "landing_page", "ad_copy", "other"],
          description: "Filter by document type",
        },
      },
    },
  },
  get_strategy_document: {
    description: "Get a saved strategy document with its full content. These are reference documents for marketing plans.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "UUID of the document" },
      },
      required: ["document_id"],
    },
  },
  create_strategy_document: {
    description: "📝 SAVE a marketing reference document (NOT for generating content). Use ONLY to store/save strategic planning documents like marketing plans, lead magnets, sales strategies. This does NOT generate any content - it just saves a document to the library. To GENERATE content (articles, videos, images), use trigger_content_generation instead.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Document name (e.g., 'ACA Promotion Strategy')" },
        description: { type: "string", description: "Brief description of the document's purpose" },
        document_type: {
          type: "string",
          enum: ["lead_magnet", "sales_strategy", "content_calendar", "funnel", "email_sequence", "landing_page", "ad_copy", "other"],
          description: "Type of strategy document",
        },
        content: { type: "string", description: "Full markdown content of the document - include sections, bullet points, strategies, etc." },
        file_url: { type: "string", description: "URL to an uploaded file (PDF, doc, etc.) - alternative to content" },
        file_name: { type: "string", description: "Original filename for display" },
        file_type: { type: "string", description: "MIME type of the uploaded file" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for organization" },
        related_product_ids: { type: "array", items: { type: "string" }, description: "UUIDs of related products" },
        related_icp_ids: { type: "array", items: { type: "string" }, description: "UUIDs of related ICPs" },
      },
      required: ["name", "document_type"],
    },
  },
  update_strategy_document: {
    description: "Update a strategy document",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "UUID of the document" },
        name: { type: "string" },
        description: { type: "string" },
        document_type: { type: "string" },
        content: { type: "string" },
        file_url: { type: "string", description: "URL to an uploaded file" },
        file_name: { type: "string", description: "Original filename for display" },
        file_type: { type: "string", description: "MIME type of the uploaded file" },
        tags: { type: "array", items: { type: "string" } },
        related_product_ids: { type: "array", items: { type: "string" } },
        related_icp_ids: { type: "array", items: { type: "string" } },
        is_active: { type: "boolean" },
      },
      required: ["document_id"],
    },
  },
  delete_strategy_documents: {
    description: "Delete one or more strategy documents",
    inputSchema: {
      type: "object",
      properties: {
        document_ids: { type: "array", items: { type: "string" }, description: "UUIDs of documents to delete" },
      },
      required: ["document_ids"],
    },
  },

  // Fit Scoring
  set_product_icp_fit: {
    description: "Set the fit score (1-10) between a product and an ICP",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "UUID of the product" },
        icp_id: { type: "string", description: "UUID of the ICP" },
        fit_score: { type: "number", minimum: 1, maximum: 10, description: "Fit score from 1-10" },
        fit_notes: { type: "string", description: "Notes explaining the fit score" },
      },
      required: ["product_id", "icp_id", "fit_score"],
    },
  },
  get_suggested_icps: {
    description: "Get ICPs ranked by fit score for given products",
    inputSchema: {
      type: "object",
      properties: {
        product_ids: { type: "array", items: { type: "string" }, description: "UUIDs of products to match" },
      },
      required: ["product_ids"],
    },
  },
  list_contact_product_scores: {
    description: "List per-contact, per-product ICP scores (contact_product_scores). This is distinct from set_product_icp_fit/get_suggested_icps, which score a product against an ICP definition, not a contact — this is the per-contact score campaign ICP-gate conditions and email-generation actually read. Requires contact_id and/or product_id.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "Filter to one contact's scores across products" },
        product_id: { type: "string", description: "Filter to one product's scores across contacts" },
        min_icp_score: { type: "number", description: "Only return rows with icp_score >= this (0-100)" },
        limit: { type: "number", description: "Max rows to return (default 50, max 500)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
  },
  set_contact_product_score: {
    description: "Set (upsert) a contact's ICP score for a specific product — the row campaign ICP-gate conditions and product-scoped {{ai_*}} email variables actually read. Verifies contact_id and product_id both belong to the caller's org. Only pass the fields you want to set/overwrite; omitted fields are left as-is on an existing row.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "Contact UUID" },
        product_id: { type: "string", description: "Product UUID (library_products)" },
        icp_score: { type: "number", description: "0-100 fit score" },
        icp_score_reasoning: { type: "string" },
        primary_need: { type: "string" },
        primary_need_reasoning: { type: "string" },
        selected_outcome: { type: "string" },
        decision_maker_score: { type: "number", description: "0-100 decision-maker score" },
        decision_maker_reasoning: { type: "string" },
        decision_maker_source: { type: "string", description: "e.g. ai or rule" },
        model: { type: "string", description: "Model used to produce this score, if AI-generated" },
      },
      required: ["contact_id", "product_id"],
    },
  },

  // Prompt Templates
  list_prompt_templates: {
    description: "List saved prompt templates (reusable prompt snippets, NOT for generating content).",
    inputSchema: {
      type: "object",
      properties: {
        prompt_type: { type: "string", enum: ["text", "image"] },
        pipeline_type: { type: "string" },
      },
    },
  },
  create_prompt_template: {
    description: "SAVE a reusable prompt template snippet (NOT for generating content). Use trigger_content_generation to actually generate content.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        prompt_content: { type: "string" },
        prompt_type: { type: "string", enum: ["text", "image"] },
        description: { type: "string" },
        category: { type: "string" },
        pipeline_type: { type: "string" },
      },
      required: ["name", "prompt_content"],
    },
  },
  get_prompt_template: {
    description: "Get full details of a prompt template",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "string" },
      },
      required: ["template_id"],
    },
  },

  // Content Generation - THIS IS THE MAIN TOOL FOR GENERATING CONTENT
  trigger_content_generation: {
    description: "⚡ GENERATE CONTENT: Use this tool to actually PRODUCE/GENERATE content like articles, videos, images, or carousels. Requires a blueprint_id and pipeline. For carousels (pipeline: 'instagram_carousel'), set output_config with slide_count, template, and custom_palette. For a simpler carousel without needing a blueprint, use create_carousel instead. DO NOT confuse with create_strategy_document (for saving marketing plans) or create_idea (for saving topic ideas).",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "string", description: "UUID of the blueprint to use" },
        pipeline: {
          type: "string",
          enum: ["rich_article", "social_media_post", "instagram_carousel", "image_only", "ugc_video", "generative_video_oneshot", "video_script", "storyboard_video_longform"],
          description: "Content pipeline type"
        },
        items: {
          type: "array",
          description: "Content items to generate. Each item becomes one or more outputs based on variation settings.",
          items: {
            type: "object",
            properties: {
              idea_id: { type: "string", description: "UUID of existing idea, or omit for ad-hoc content" },
              idea_title: { type: "string", description: "Title/topic for the content (required if no idea_id)" },
              slot_values: {
                type: "object",
                description: "Template variable values: idea, context, title, description, topic, etc.",
                additionalProperties: { type: "string" }
              },
            },
          },
        },
        library_elements: {
          type: "object",
          description: "Library elements to include in generation. Key is table name (library_brand_voices, library_products, library_icps, library_characters, library_blocks)",
          additionalProperties: {
            type: "object",
            properties: {
              element_ids: { type: "array", items: { type: "string" }, description: "UUIDs of elements to use" },
              combination_mode: { type: "string", enum: ["combine", "separate"], description: "combine: merge all into each item, separate: create one item per element (multiplies output)" },
            },
          },
        },
        output_config: {
          type: "object",
          description: "Output format configuration. For carousels: set slide_count, template, and custom_palette.",
          properties: {
            aspect_ratio: { type: "string", enum: ["landscape", "portrait", "square"], description: "Output aspect ratio. Carousels take portrait (4:5) or square and default to the blueprint's shape." },
            video_duration: { type: "number", description: "For video pipelines: duration in seconds (30, 60, 90, etc.)" },
            slide_count: { type: "number", description: "For carousel: number of slides (3-10, defaults to the blueprint's)" },
            template: {
              type: "string",
              enum: CAROUSEL_THEMES,
              description: "For carousel: visual theme. Defaults to the blueprint's."
            },
            custom_palette: {
              type: "object",
              description: "For carousel: custom hex color palette",
              properties: {
                primary: { type: "string", description: "Primary color (hex)" },
                secondary: { type: "string", description: "Secondary color (hex)" },
                background: { type: "string", description: "Background color (hex)" },
                text: { type: "string", description: "Text color (hex)" },
                accent: { type: "string", description: "Accent color (hex)" },
              },
            },
            background_image_url: { type: "string", description: "For carousel: URL for custom slide background image" },
          },
        },
        auto_approve: { type: "boolean", description: "Whether to automatically process all stages without waiting for manual approval. Defaults to true for MCP calls (agents have no UI to click 'approve'). Set to false only if a human will review each stage (caption, image_prompt, image) before the next runs." },
      },
      required: ["blueprint_id", "pipeline", "items"],
    },
  },
  create_carousel: {
    description: "🎨 QUICK CAROUSEL: Generate an Instagram carousel from a short idea/topic. Uses an existing carousel blueprint (or creates a default one). The blueprint already contains the prompt template — you just provide the idea and optional talking points. Auto-approves all stages by default. After generation, use push_to_ghl to publish.",
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "Short topic for the carousel (e.g., '5 tips for better sleep', 'Why AI agents close more deals'). Keep it concise — the blueprint prompt template expands on it." },
        blueprint_id: { type: "string", description: "UUID of an instagram_carousel blueprint to use. If omitted, uses the most recent active carousel blueprint for the org." },
        brand_voice_id: { type: "string", description: "UUID of brand voice for styling/tone. Inherits the brand's visual template, color palette, and tone." },
        talking_points: { type: "array", items: { type: "string" }, description: "Key talking points the carousel should cover (e.g., ['Lead gen automation', 'AI content creation', 'CRM pipelines']). These guide the AI to cover specific topics across slides." },
        slide_count: { type: "number", description: "Number of slides (3-10, defaults to the blueprint's)" },
        template: {
          type: "string",
          enum: CAROUSEL_THEMES,
          description: "Visual theme override. If omitted, uses the blueprint's theme (default 'creator')."
        },
        custom_palette: {
          type: "object",
          description: "Custom hex color palette. Overrides brand voice colors.",
          properties: {
            primary: { type: "string" },
            secondary: { type: "string" },
            background: { type: "string" },
            text: { type: "string" },
            accent: { type: "string" },
          },
        },
        aspect_ratio: {
          type: "string",
          enum: ["square", "portrait"],
          description: "Slide shape: portrait=4:5, square=1:1. Defaults to the blueprint's shape (4:5 unless it chose square)."
        },
        custom_instructions: { type: "string", description: "Additional prompt guidance for the AI" },
        auto_approve: { type: "boolean", description: "Auto-approve all stages (default true). Set false to manually review each stage." },
        publish_to_ghl: { type: "array", items: { type: "string" }, description: "GHL account IDs to publish to after generation. Use list_ghl_accounts to discover IDs. After job completes, call push_to_ghl with the output ID." },
      },
      required: ["idea"],
    },
  },
  list_generation_jobs: {
    description: "List active/completed content generation jobs. Use after trigger_content_generation or create_carousel to check progress and status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["queued", "processing", "review", "completed", "failed"], description: "Filter by status" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  get_generation_job: {
    description: "Get details of a specific generation job including its outputs. Use with job_id from trigger_content_generation.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "UUID of the generation job" },
      },
      required: ["job_id"],
    },
  },

  // Autopilots - Automated Content Production
  list_autopilots: {
    description: "📋 List content autopilots. Autopilots automatically generate and publish content on a schedule using blueprints and idea pools.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "paused", "archived"], description: "Filter by status" },
      },
    },
  },
  get_autopilot: {
    description: "Get details of a specific autopilot including its content mix, destinations, pool stats, and recent automation logs.",
    inputSchema: {
      type: "object",
      properties: {
        autopilot_id: { type: "string", description: "UUID of the autopilot" },
      },
      required: ["autopilot_id"],
    },
  },
  trigger_autopilot: {
    description: "🚀 TRIGGER AUTOPILOT: Manually run an autopilot NOW to generate content immediately. The autopilot will pick a blueprint (weighted random from content mix), select an idea (from pool or tags), and dispatch a generation job. Returns the job_id for tracking progress with get_generation_job.",
    inputSchema: {
      type: "object",
      properties: {
        autopilot_id: { type: "string", description: "UUID of the autopilot to trigger" },
      },
      required: ["autopilot_id"],
    },
  },

  create_autopilot: {
    description:
      "🤖 CREATE AUTOPILOT: Create a new content autopilot that automatically generates and publishes content on a schedule. Requires: content_mix (blueprints with weights), frequency (how often), and destinations (where to publish). Use list_blueprints for blueprint IDs, list_publishing_accounts for destination account IDs, and list_tags for tag names. Call get_help(topic='autopilots') for a full workflow guide.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Autopilot name (e.g., 'Daily Instagram Posts', 'Weekly Blog Articles')",
        },
        content_mix: {
          type: "array",
          description:
            "Array of blueprints with weights (should sum to ~100). Each item specifies a blueprint and how often it should be used.",
          items: {
            type: "object",
            properties: {
              blueprint_id: { type: "string", description: "Blueprint UUID (from list_blueprints)" },
              weight: {
                type: "number",
                description:
                  "Share of the rotation (relative, e.g. 2 and 1 = two of every three rotating posts). 0 = only runs in schedule_slots pinned to it.",
              },
              destination_account_ids: {
                type: "array",
                items: { type: "string" },
                description:
                  "Only post this blueprint's pieces to these destination account_ids (default: every destination). Accounts that can't take the format (text to Instagram, non-video to TikTok/YouTube) are skipped automatically.",
              },
              enabled: { type: "boolean", description: "Whether this blueprint is active (default: true)" },
              idea_tags: {
                type: "array",
                items: { type: "string" },
                description: "Filter ideas by tag names for this blueprint (e.g., ['marketing', 'tips'])",
              },
              media_source: {
                type: "string",
                enum: ["generate", "saved_library", "mixed"],
                description: "Media source: generate (AI), saved_library (existing), mixed",
              },
              output_config: {
                type: "object",
                description: "Output format settings",
                properties: {
                  aspectRatio: { type: "string", enum: ["landscape", "portrait", "square"] },
                  slideCount: { type: "number", description: "Carousel slides (3-10)" },
                },
              },
              video_config: {
                type: "object",
                description: "Video format settings (video pipelines only)",
                properties: {
                  totalDuration: { type: "number", description: "Duration in seconds (30-600)" },
                  aspectRatio: { type: "string", enum: ["landscape", "portrait", "square"] },
                },
              },
            },
            required: ["blueprint_id", "weight"],
          },
        },
        ideas_source: {
          type: "string",
          enum: ["per_blueprint", "shared"],
          description:
            "How ideas are sourced: 'per_blueprint' = each blueprint uses its own idea_tags, 'shared' = all blueprints draw from shared_idea_tags (default: per_blueprint)",
        },
        shared_idea_tags: {
          type: "array",
          items: { type: "string" },
          description: "Tag names for shared idea pool (only when ideas_source='shared')",
        },
        frequency: {
          type: "object",
          description:
            "How often to generate. Examples: {amount:1, unit:'day'} = daily, {amount:12, unit:'hour'} = twice daily",
          properties: {
            amount: { type: "number", description: "Frequency amount" },
            unit: { type: "string", enum: ["hour", "day", "week"], description: "Frequency unit" },
          },
          required: ["amount", "unit"],
        },
        scheduling_mode: {
          type: "string",
          enum: ["immediate", "optimal", "scheduled"],
          description:
            "When to publish: immediate (ASAP), optimal (AI picks best time), scheduled (specific times). Default: optimal",
        },
        timezone: {
          type: "string",
          description: "IANA timezone (default: America/New_York). E.g., 'Europe/London'",
        },
        scheduled_times: {
          type: "array",
          items: { type: "string" },
          description: "Publish times in HH:MM format (for scheduling_mode='scheduled'). E.g., ['09:00', '18:00']",
        },
        scheduled_days: {
          type: "array",
          items: { type: "number" },
          description: "Local weekdays for scheduled_times, 0 = Sunday … 6 = Saturday (default: every day)",
        },
        schedule_slots: {
          type: "array",
          description:
            "Plan each day (scheduling_mode='scheduled'): replaces scheduled_times x scheduled_days. Each slot posts once; blueprint_id pins that slot to a blueprint in content_mix, otherwise the rotation picks. E.g. [{day:1,time:'09:00'},{day:3,time:'09:00',blueprint_id:'...'}]",
          items: {
            type: "object",
            properties: {
              day: { type: "number", description: "0 = Sunday … 6 = Saturday (local)" },
              time: { type: "string", description: "HH:MM local" },
              blueprint_id: { type: "string", description: "Optional: always run this blueprint in this slot" },
            },
            required: ["day", "time"],
          },
        },
        destinations: {
          type: "array",
          description: "Where to publish. Use list_publishing_accounts to find account_id and platform.",
          items: {
            type: "object",
            properties: {
              account_id: { type: "string", description: "Account ID from list_publishing_accounts" },
              platform: { type: "string", description: "Platform (e.g., 'facebook', 'instagram', 'wordpress')" },
              enabled: { type: "boolean", description: "Active (default: true)" },
              post_type: {
                type: "string",
                enum: ["feed", "reel", "story", "carousel"],
                description: "Post type override",
              },
            },
            required: ["account_id", "platform"],
          },
        },
        evergreen: {
          type: "object",
          description: "Evergreen recycling: auto-repost published content after a cooldown.",
          properties: {
            enabled: { type: "boolean", description: "Enable evergreen" },
            min_age_days: { type: "number", description: "Days before repost (e.g., 30)" },
            max_reposts: { type: "number", description: "Max reposts per piece (e.g., 3)" },
            variation_mode: {
              type: "string",
              enum: ["exact", "slight_variation", "regenerate"],
              description: "Repost mode: exact, slight_variation, or regenerate",
            },
          },
        },
        auto_reload_pool: {
          type: "boolean",
          description: "Auto-reload idea pool from tags when pool runs low (default: false)",
        },
      },
      required: ["name", "content_mix", "frequency", "destinations"],
    },
  },

  update_autopilot: {
    description:
      "Update an existing content autopilot. Only provide the fields you want to change. If you update content_mix tags or ideas_source, the pool will be automatically re-synced.",
    inputSchema: {
      type: "object",
      properties: {
        autopilot_id: { type: "string", description: "UUID of the autopilot to update" },
        name: { type: "string", description: "New name" },
        status: { type: "string", enum: ["active", "paused", "archived"] },
        content_mix: {
          type: "array",
          description: "Updated content mix (replaces entire array). Same format as create_autopilot.",
          items: { type: "object" },
        },
        ideas_source: { type: "string", enum: ["per_blueprint", "shared"] },
        shared_idea_tags: { type: "array", items: { type: "string" } },
        frequency: {
          type: "object",
          properties: {
            amount: { type: "number" },
            unit: { type: "string", enum: ["hour", "day", "week"] },
          },
        },
        scheduling_mode: { type: "string", enum: ["immediate", "optimal", "scheduled"] },
        timezone: { type: "string" },
        scheduled_times: { type: "array", items: { type: "string" } },
        scheduled_days: { type: "array", items: { type: "number" }, description: "0 = Sunday … 6 = Saturday" },
        schedule_slots: {
          type: "array",
          items: { type: "object" },
          description: "Plan each day: [{day, time, blueprint_id?}] (replaces the array; null clears it). Same format as create_autopilot.",
        },
        destinations: {
          type: "array",
          items: { type: "object" },
          description: "Updated destinations (replaces entire array)",
        },
        evergreen: { type: "object", description: "Updated evergreen settings" },
        auto_reload_pool: { type: "boolean" },
      },
      required: ["autopilot_id"],
    },
  },

  delete_autopilot: {
    description:
      "Delete a content autopilot. Also removes all pool entries and automation logs. This action is permanent.",
    inputSchema: {
      type: "object",
      properties: {
        autopilot_id: { type: "string", description: "UUID of the autopilot to delete" },
      },
      required: ["autopilot_id"],
    },
  },

  toggle_autopilot_status: {
    description:
      "⏯ Pause or activate a content autopilot. When activating, next_run_at is recalculated. When pausing, scheduled runs are suspended.",
    inputSchema: {
      type: "object",
      properties: {
        autopilot_id: { type: "string", description: "UUID of the autopilot" },
        status: {
          type: "string",
          enum: ["active", "paused"],
          description: "'active' to resume, 'paused' to suspend",
        },
      },
      required: ["autopilot_id", "status"],
    },
  },

  list_publishing_accounts: {
    description:
      "📡 List ALL available publishing accounts across platforms (GHL social media + WordPress). Returns a unified list with account_id, platform, and name. Use this before creating an autopilot to discover destinations.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  sync_autopilot_pool: {
    description:
      "🔄 Sync the idea pool from an autopilot's configured tags. Adds new matching ideas to the pool without affecting existing entries.",
    inputSchema: {
      type: "object",
      properties: {
        autopilot_id: { type: "string", description: "UUID of the autopilot to sync" },
      },
      required: ["autopilot_id"],
    },
  },

  add_ideas_to_pool: {
    description:
      "➕ Manually add specific ideas to an autopilot's idea pool. Duplicates are silently skipped. Use list_ideas to find idea UUIDs.",
    inputSchema: {
      type: "object",
      properties: {
        autopilot_id: { type: "string", description: "UUID of the autopilot" },
        idea_ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of idea UUIDs to add",
        },
      },
      required: ["autopilot_id", "idea_ids"],
    },
  },

  list_pool_entries: {
    description:
      "📊 List idea pool entries for an autopilot with status and stats. Shows which ideas are available, in progress, produced, or failed.",
    inputSchema: {
      type: "object",
      properties: {
        autopilot_id: { type: "string", description: "UUID of the autopilot" },
        status: {
          type: "string",
          enum: ["available", "in_progress", "produced", "failed", "skipped"],
          description: "Filter by status (optional)",
        },
        limit: { type: "number", description: "Max entries (default: 50, max: 200)" },
      },
      required: ["autopilot_id"],
    },
  },

  recycle_autopilot_pool: {
    description:
      "♻️ Recycle produced ideas back to 'available' in an autopilot's pool. Only recycles ideas with can_recycle=true. For evergreen content strategies.",
    inputSchema: {
      type: "object",
      properties: {
        autopilot_id: { type: "string", description: "UUID of the autopilot" },
        include_failed: {
          type: "boolean",
          description: "Also recycle failed ideas (default: false)",
        },
      },
      required: ["autopilot_id"],
    },
  },

  // GHL (LeadConnector) Social Media Publishing
  list_ghl_accounts: {
    description: "List connected social media accounts from LeadConnector (GHL). Returns the accounts you can publish to (Facebook, Instagram, LinkedIn, TikTok, YouTube, etc.). Use this to discover available account IDs before calling push_to_ghl.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  push_to_ghl: {
    description: "📤 PUBLISH CONTENT: Push a generated content output to social media via LeadConnector (GHL). Publishes to one or more connected social accounts. Use list_ghl_accounts first to get available account IDs, and get_generation_job to get content output IDs. Supports scheduling for future publication.",
    inputSchema: {
      type: "object",
      properties: {
        content_output_id: { type: "string", description: "UUID of a single content output to publish. Use get_generation_job to find output IDs." },
        content_output_ids: { type: "array", items: { type: "string" }, description: "UUIDs of multiple content outputs to publish in batch. Use this OR content_output_id." },
        account_ids: {
          type: "array",
          items: { type: "string" },
          description: "GHL social account IDs to publish to (from list_ghl_accounts). E.g., ['acc_facebook_123', 'acc_instagram_456']"
        },
        schedule_date: { type: "string", description: "ISO 8601 date to schedule the post (e.g., '2026-03-01T10:00:00Z'). Omit to publish immediately." },
        caption: { type: "string", description: "Override the generated caption with custom text. If omitted, uses the caption from the content output." },
        post_type: {
          type: "string",
          enum: ["feed", "reel", "story", "carousel"],
          description: "Override post type. feed=regular post, reel=video reel, story=Instagram story, carousel=multi-image. If omitted, auto-detected from content."
        },
      },
      required: ["account_ids"],
    },
  },

  // Organization Management
  list_accessible_organizations: {
    description: "List all organizations the authenticated user can access. IMPORTANT: All ACA operations (content, leads, campaigns, knowledge base, etc.) are scoped to the currently active organization. Before creating or modifying data, confirm which organization the user wants to operate on. Call this tool first if unsure, then use switch_organization if needed. For agency accounts, this includes client organizations.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  switch_organization: {
    description: "Switch the active organization context for subsequent operations. Use this BEFORE calling other tools to operate on a different organization's data. After switching, all tool calls will use the new organization context until you switch again.",
    inputSchema: {
      type: "object",
      properties: {
        organization_id: {
          type: "string",
          description: "The organization ID to switch to. Must be an organization you have access to (from list_accessible_organizations)."
        },
      },
      required: ["organization_id"],
    },
  },

  // AI Agent Profiles
  list_agent_profiles: {
    description: "List all AI agent profiles for the organization. Agent profiles are reusable autopilot configurations (e.g., 'SDR Follow-up', 'Inbound Qualifier') that can be applied to conversations.",
    inputSchema: { type: "object", properties: {} },
  },
  get_agent_profile: {
    description: "Get full details of a single AI agent profile including its autopilot config (rules, escalation rules, instructions, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string", description: "The agent profile UUID" },
      },
      required: ["profile_id"],
    },
  },
  create_agent_profile: {
    description: "Create a new AI agent profile. Profiles define how the AI autopilot behaves: what intents to handle, actions to take, conversation goals, escalation rules, etc. Sensible defaults are applied if config is omitted.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Profile name (e.g., 'SDR Follow-up Agent', 'Inbound Qualifier')" },
        description: { type: "string", description: "Brief description of what this agent does" },
        config: {
          type: "object",
          description: "Autopilot configuration. All fields optional — sensible defaults are applied. Provide only the fields you want to customize.",
          properties: {
            enabled: { type: "boolean", description: "Whether autopilot is active (default: true)" },
            rules: {
              type: "array",
              description: "Intent-action rules. Default: auto_reply for interested/neutral/not_interested, auto_followup_after_return for out_of_office",
              items: {
                type: "object",
                properties: {
                  intent: { type: "string", description: "Lead intent to match (e.g., 'interested', 'neutral', 'not_interested', 'out_of_office', 'referral')" },
                  action: {
                    type: "string",
                    enum: ["auto_reply", "send_calendly", "book_ghl_appointment", "auto_followup_after_return", "draft_for_approval", "escalate"],
                    description: "Action to take when intent matches",
                  },
                  calendly_link: { type: "string", description: "Calendly URL (for send_calendly action)" },
                  ghl_calendar_id: { type: "string", description: "GHL calendar ID (for book_ghl_appointment action)" },
                  message_template: { type: "string", description: "Custom message template for this rule" },
                  confidence_threshold: { type: "number", description: "Minimum confidence to trigger (0-1)" },
                },
                required: ["intent", "action"],
              },
            },
            require_approval: { type: "boolean", description: "Require human approval before sending (default: true)" },
            max_auto_replies: { type: "number", description: "Max auto-replies per conversation (default: 10)" },
            conversation_goal: { type: "string", description: "The goal for AI conversations (e.g., 'Book a demo call')" },
            system_instructions: { type: "string", description: "Custom system instructions for the AI agent" },
            use_knowledge_base: { type: "boolean", description: "Enable RAG from knowledge base documents" },
            knowledge_document_ids: { type: "array", items: { type: "string" }, description: "Specific knowledge document UUIDs to use (omit to use all)" },
            use_tone_profile: { type: "boolean", description: "Match the user's writing tone" },
            max_conversation_turns: { type: "number", description: "Max conversation turns before escalation (default: 10)" },
            owner_user_id: { type: "string", description: "User ID who owns/manages this profile's conversations" },
            escalation_rules: {
              type: "array",
              description: "Rules for when to escalate to a human",
              items: {
                type: "object",
                properties: {
                  condition: {
                    type: "string",
                    enum: ["low_confidence", "hostile_sentiment", "explicit_request", "max_turns", "custom_keyword"],
                  },
                  threshold: { type: "number", description: "Threshold value (e.g., confidence 0-1)" },
                  keywords: { type: "array", items: { type: "string" }, description: "Keywords to watch for (for custom_keyword condition)" },
                },
                required: ["condition"],
              },
            },
            booking_timezone: { type: "string", description: "IANA timezone for calendar booking (e.g., 'America/New_York')" },
          },
        },
        is_default: { type: "boolean", description: "Set as the default profile for new conversations (only one default per org)" },
      },
      required: ["name"],
    },
  },
  update_agent_profile: {
    description: "Update an existing AI agent profile's name, description, or config",
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string", description: "The agent profile UUID" },
        name: { type: "string", description: "New profile name" },
        description: { type: "string", description: "New description" },
        config: {
          type: "object",
          description: "Updated autopilot configuration (replaces entire config — provide the full config object)",
        },
      },
      required: ["profile_id"],
    },
  },
  delete_agent_profiles: {
    description: "Delete one or more AI agent profiles",
    inputSchema: {
      type: "object",
      properties: {
        profile_ids: { type: "array", items: { type: "string" }, description: "UUIDs of agent profiles to delete" },
      },
      required: ["profile_ids"],
    },
  },
  set_default_agent_profile: {
    description: "Set an agent profile as the default for the organization. The previous default (if any) is automatically unset.",
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string", description: "The agent profile UUID to set as default" },
      },
      required: ["profile_id"],
    },
  },

  // Knowledge Base Documents
  list_knowledge_documents: {
    description: "List knowledge base documents. These are RAG documents used by AI agents for contextual responses.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "processing", "completed", "failed"],
          description: "Filter by processing status",
        },
      },
    },
  },
  get_knowledge_document: {
    description: "Get details of a knowledge base document including processing status and chunk count",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "The document UUID" },
      },
      required: ["document_id"],
    },
  },
  create_knowledge_document: {
    description: "Create a new knowledge base document from text content. The text is uploaded as a .txt file, then automatically chunked and embedded for RAG retrieval. Use get_knowledge_document to check processing status.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Document name (e.g., 'Product FAQ', 'Pricing Guide')" },
        description: { type: "string", description: "Brief description of the document content" },
        content: { type: "string", description: "The full text content of the document. Will be saved as a .txt file and processed for RAG." },
      },
      required: ["name", "content"],
    },
  },
  delete_knowledge_documents: {
    description: "Delete one or more knowledge base documents. Also removes the file from storage and all associated chunks/embeddings.",
    inputSchema: {
      type: "object",
      properties: {
        document_ids: { type: "array", items: { type: "string" }, description: "UUIDs of documents to delete" },
      },
      required: ["document_ids"],
    },
  },

  // Lead Magnet Campaigns
  list_lead_magnet_campaigns: {
    description: "List all lead magnet campaigns (keyword monitoring on LinkedIn/Instagram). Returns campaigns with account info, stats (leads, DMs sent/pending, monitored posts), and linked knowledge documents.",
    inputSchema: { type: "object", properties: {} },
  },
  get_lead_magnet_campaign: {
    description: "Get full details of a lead magnet campaign including account info, stats, and linked knowledge documents",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "The campaign UUID" },
      },
      required: ["campaign_id"],
    },
  },
  create_lead_magnet_campaign: {
    description: "Create a new lead magnet campaign. Monitors LinkedIn/Instagram posts for keyword comments. When a keyword matches, the system can either ask leads to DM you (connection mode) or share the resource link directly in a comment reply (direct mode). Supports ICP scoring, AI chatbot, knowledge base, and agent profiles.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Connected Unipile account UUID (LinkedIn or Instagram)" },
        name: { type: "string", description: "Campaign name" },
        trigger_keywords: { type: "string", description: "Comma-separated keywords to monitor in post comments" },
        dm_template: { type: "string", description: "DM message template (required when AI chatbot disabled). Supports variables like {{commenter_name}}" },
        // ICP scoring
        icp_id: { type: "string", description: "ICP UUID for lead quality scoring. Leads below threshold get skipped." },
        icp_threshold: { type: "number", description: "Minimum ICP score (0-100) to send DM (default: 0 = no filtering)" },
        // AI chatbot
        ai_chatbot_enabled: { type: "boolean", description: "Enable AI chatbot for multi-turn conversations instead of static DM (default: false)" },
        ai_chatbot_instructions: { type: "string", description: "System instructions for the AI chatbot (required when ai_chatbot_enabled)" },
        ai_chatbot_brand_voice_id: { type: "string", description: "Brand voice UUID for tone matching" },
        ai_chatbot_model: { type: "string", description: `AI model ID, an OpenRouter id (default: '${DEFAULT_CHATBOT_MODEL}'). Withdrawn models fall back to the default.` },
        ai_chatbot_max_turns: { type: "number", description: "Max conversation turns before handoff (default: 10)" },
        ai_chatbot_handoff_keywords: { type: "array", items: { type: "string" }, description: "Keywords that trigger human handoff" },
        // Auto-add posts
        auto_add_posts: { type: "boolean", description: "Auto-discover and monitor new posts from selected accounts (default: false)" },
        auto_add_posts_account_ids: { type: "array", items: { type: "string" }, description: "Unipile account UUIDs to auto-monitor posts from" },
        // Knowledge base
        knowledge_document_ids: { type: "array", items: { type: "string" }, description: "Knowledge document UUIDs for AI chatbot RAG context" },
        // Agent profile
        agent_profile_id: { type: "string", description: "AI agent profile UUID for autopilot configuration" },
        // Rate limits
        dm_delay_seconds: { type: "number", description: "Delay before sending DM after keyword match (default: 30)" },
        max_dms_per_hour: { type: "number", description: "Max DMs per hour (default: 10)" },
        max_dms_per_day: { type: "number", description: "Max DMs per day (default: 50)" },
        user_cooldown_hours: { type: "number", description: "Hours before re-DMing same user (default: 24)" },
        // Other
        auto_accept_connections: { type: "boolean", description: "Auto-accept connection requests from leads (default: true)" },
        // Lead magnet delivery
        lead_magnet_url: { type: "string", description: "Resource URL to share with leads (e.g. Notion page, PDF link, landing page)" },
        lead_magnet_title: { type: "string", description: "Display title for the lead magnet resource" },
        require_connection_for_linkedin: { type: "boolean", description: "When true (default), asks leads to DM you a keyword before delivering the resource. When false, the resource link is shared directly in the comment reply." },
        comment_link_mode: { type: "string", enum: ["gated", "direct"], description: "How to deliver the link when require_connection_for_linkedin is false. 'gated' (default) = email capture landing page, 'direct' = raw lead_magnet_url with no gating." },
        comment_reply_templates: { type: "array", items: { type: "string" }, description: "LinkedIn only: the public replies posted under a keyword comment when the commenter must connect first (gated mode, not yet connected). One is picked at random; {name} is the commenter's first name. Instagram campaigns never reply publicly: they DM the commenter directly." },
        ai_mode: { type: "string", enum: ["chatbot_only", "autopilot_only", "chatbot_smart"], description: "Who answers when a lead replies to the DM. 'chatbot_only' (default) = the campaign's AI chatbot (needs ai_chatbot_enabled + ai_chatbot_instructions), 'autopilot_only' = the conversation autopilot (agent_profile_id), 'chatbot_smart' = chatbot with reply classification and follow-up rules." },
        webhook_url: { type: "string", description: "Webhook URL for event notifications" },
      },
      required: ["account_id", "name", "trigger_keywords"],
    },
  },
  update_lead_magnet_campaign: {
    description: "Update a lead magnet campaign. Pass only the fields you want to change. Junction tables (auto_add_posts_account_ids, knowledge_document_ids) are synced when provided.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "The campaign UUID" },
        name: { type: "string" },
        trigger_keywords: { type: "string" },
        dm_template: { type: "string" },
        icp_id: { type: "string", description: "ICP UUID (null to remove)" },
        icp_threshold: { type: "number" },
        ai_chatbot_enabled: { type: "boolean" },
        ai_chatbot_instructions: { type: "string" },
        ai_chatbot_brand_voice_id: { type: "string" },
        ai_chatbot_model: { type: "string" },
        ai_chatbot_max_turns: { type: "number" },
        ai_chatbot_handoff_keywords: { type: "array", items: { type: "string" } },
        auto_add_posts: { type: "boolean" },
        auto_add_posts_account_ids: { type: "array", items: { type: "string" }, description: "Replaces all auto-add account links" },
        knowledge_document_ids: { type: "array", items: { type: "string" }, description: "Replaces all knowledge document links" },
        agent_profile_id: { type: "string" },
        dm_delay_seconds: { type: "number" },
        max_dms_per_hour: { type: "number" },
        max_dms_per_day: { type: "number" },
        user_cooldown_hours: { type: "number" },
        auto_accept_connections: { type: "boolean" },
        lead_magnet_url: { type: "string" },
        lead_magnet_title: { type: "string" },
        require_connection_for_linkedin: { type: "boolean" },
        comment_link_mode: { type: "string", enum: ["gated", "direct"] },
        comment_reply_templates: { type: "array", items: { type: "string" }, description: "LinkedIn only: the public replies posted under a keyword comment when the commenter must connect first (gated mode, not yet connected). One is picked at random; {name} is the commenter's first name. Instagram campaigns never reply publicly: they DM the commenter directly." },
        ai_mode: { type: "string", enum: ["chatbot_only", "autopilot_only", "chatbot_smart"], description: "Who answers when a lead replies to the DM. 'chatbot_only' (default) = the campaign's AI chatbot (needs ai_chatbot_enabled + ai_chatbot_instructions), 'autopilot_only' = the conversation autopilot (agent_profile_id), 'chatbot_smart' = chatbot with reply classification and follow-up rules." },
        webhook_url: { type: "string" },
      },
      required: ["campaign_id"],
    },
  },
  delete_lead_magnet_campaign: {
    description: "Delete a lead magnet campaign. Junction tables (auto-add accounts, knowledge docs) are cascade deleted.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "The campaign UUID" },
      },
      required: ["campaign_id"],
    },
  },
  toggle_lead_magnet_campaign: {
    description: "Activate or deactivate a lead magnet campaign",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "The campaign UUID" },
        is_active: { type: "boolean", description: "true to activate, false to deactivate" },
      },
      required: ["campaign_id", "is_active"],
    },
  },
  list_campaign_leads: {
    description: "List leads captured by a lead magnet campaign. Shows commenter info, matched keyword, status, ICP score, and AI conversation state.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "The campaign UUID" },
        status: {
          type: "string",
          enum: ["pending", "dm_sent", "dm_failed", "replied", "converted", "skipped", "awaiting_connection", "comment_replied", "unresponsive", "scoring", "low_icp", "ai_chatting"],
          description: "Filter leads by status",
        },
        limit: { type: "number", description: "Max results (default 50, max 10000). Use a high limit to fetch all leads at once." },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["campaign_id"],
    },
  },

  // Email Sequences
  list_email_sequences: {
    description: "List all email sequences. Returns compact view with step count and mailbox count.",
    inputSchema: { type: "object", properties: {} },
  },
  get_email_sequence: {
    description: "Get full details of an email sequence including steps, settings, and autopilot config",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string", description: "The sequence UUID" },
      },
      required: ["sequence_id"],
    },
  },
  create_email_sequence: {
    description: "Create a new email sequence. Sensible default settings are applied (stop_on_reply, daily_limit=30, send_window 08:00-18:00 EST, skip_weekends, etc.). Status starts as 'draft'.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Sequence name" },
        tracking_domain_id: { type: "string", description: "Tracking domain UUID (use list of email_tracking_domains). Accepted here or nested in settings — either way it's stored on the sequence's own column, not settings JSON." },
        lead_list_id: { type: "string", description: "Lead list UUID to source enrollments from (use list_lead_lists). Pair with settings.auto_enroll_new_members to continuously top up from the list." },
        steps: {
          type: "array",
          description: "Sequence steps. Each step has a type (email, delay, condition, ab_test) and type-specific fields.",
          items: {
            type: "object",
            properties: {
              order: { type: "number", description: "Step order (0-indexed)" },
              type: { type: "string", enum: ["email", "delay", "condition", "ab_test"], description: "Step type" },
              subject: { type: "string", description: "Email subject (for email steps)" },
              body: { type: "string", description: "Email body HTML (for email steps)" },
              delay_hours: { type: "number", description: "Delay in hours (for delay steps)" },
              condition_type: { type: "string", enum: ["opened", "clicked", "replied", "bounced"], description: "Condition type (for condition steps)" },
              condition_timeout_hours: { type: "number", description: "Timeout before fallback (for condition steps)" },
              variants: {
                type: "array",
                description: "A/B test variants (for ab_test steps). Each variant needs a label, subject, body, and split_percentage. Percentages must total 100.",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", description: "Variant UUID (auto-generated if omitted)" },
                    variant_label: { type: "string", description: "Variant label (A, B, C, or D)" },
                    subject: { type: "string", description: "Email subject line for this variant" },
                    body: { type: "string", description: "Email body HTML for this variant" },
                    split_percentage: { type: "number", description: "Traffic percentage (0-100). All variants must total 100." },
                  },
                  required: ["variant_label", "subject", "body", "split_percentage"],
                },
              },
            },
            required: ["order", "type"],
          },
        },
        settings: {
          type: "object",
          description: "Partial settings — merged over defaults. Only provide fields you want to override.",
          properties: {
            mailbox_ids: { type: "array", items: { type: "string" }, description: "Mailbox UUIDs to send from (use list_email_mailboxes to find IDs)" },
            stop_on_reply: { type: "boolean", description: "Stop sequence when lead replies (default: true)" },
            stop_on_auto_reply: { type: "boolean", description: "Stop on auto-reply/OOO (default: true)" },
            stop_company_on_reply: { type: "boolean", description: "Stop all leads from same company on reply (default: false)" },
            daily_limit: { type: "number", description: "Max emails per day across all mailboxes (default: 30)" },
            max_new_leads_per_day: { type: "number", description: "Max new leads to start per day (null = unlimited)" },
            min_time_gap_minutes: { type: "number", description: "Min minutes between sends (default: 9)" },
            send_window: {
              type: "object",
              properties: {
                start: { type: "string", description: "Send window start HH:MM (default: '08:00')" },
                end: { type: "string", description: "Send window end HH:MM (default: '18:00')" },
              },
            },
            timezone: { type: "string", description: "IANA timezone (default: 'America/New_York')" },
            skip_weekends: { type: "boolean", description: "Skip sending on weekends (default: true)" },
            open_tracking: { type: "boolean", description: "Track email opens (default: false)" },
            click_tracking: { type: "boolean", description: "Track link clicks (default: true)" },
            unsubscribe_header: { type: "boolean", description: "Include the List-Unsubscribe email header (default: true)" },
            unsubscribe_link_footer: { type: "boolean", description: "Auto-append a hyperlinked 'unsubscribe' footer to the body when {{unsubscribe_link}} isn't manually placed (default: true)" },
            unsubscribe_footer_text: { type: "string", description: "Spintax template for the footer wording, e.g. \"{Not interested?|Not a fit?} [{Unsubscribe|Opt out}]\". {a|b|c} picks one per send; [brackets] mark the hyperlinked part (no brackets = whole line is the link). Empty/omitted rotates ACA's defaults." },
            first_email_text_only: { type: "boolean", description: "Send step 0 as plain text with no HTML/tracking (default: false)" },
            variable_defaults: { type: "object", description: "Fallback values for {{variables}} used when a lead is missing that field, e.g. { \"company\": \"there\" }" },
            cc: { type: "array", items: { type: "string" }, description: "CC email addresses" },
            bcc: { type: "array", items: { type: "string" }, description: "BCC email addresses" },
            tags: { type: "array", items: { type: "string" }, description: "Tags for organization" },
          },
        },
        auto_enroll_new_members: { type: "boolean", description: "Continuously enroll newly added members of the attached lead list. Stored on the sequence column, not in settings." },
        campaign_id: { type: "string", description: "Optional campaign UUID to link sequence to" },
      },
      required: ["name"],
    },
  },
  update_email_sequence: {
    description: "Update an email sequence. Settings are merged with existing (partial update) — you only need to pass the settings fields you want to change.",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string", description: "The sequence UUID" },
        name: { type: "string" },
        steps: {
          type: "array",
          description: "Full replacement of steps array. Each step has a type (email, delay, condition, ab_test) and type-specific fields.",
          items: {
            type: "object",
            properties: {
              order: { type: "number", description: "Step order (0-indexed)" },
              type: { type: "string", enum: ["email", "delay", "condition", "ab_test"], description: "Step type" },
              subject: { type: "string", description: "Email subject (for email steps)" },
              body: { type: "string", description: "Email body HTML (for email steps)" },
              delay_hours: { type: "number", description: "Delay in hours (for delay steps)" },
              condition_type: { type: "string", enum: ["opened", "clicked", "replied", "bounced"], description: "Condition type (for condition steps)" },
              condition_timeout_hours: { type: "number", description: "Timeout before fallback (for condition steps)" },
              variants: {
                type: "array",
                description: "A/B test variants (for ab_test steps). Each variant needs a label, subject, body, and split_percentage. Percentages must total 100.",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", description: "Variant UUID (auto-generated if omitted)" },
                    variant_label: { type: "string", description: "Variant label (A, B, C, or D)" },
                    subject: { type: "string", description: "Email subject line for this variant" },
                    body: { type: "string", description: "Email body HTML for this variant" },
                    split_percentage: { type: "number", description: "Traffic percentage (0-100). All variants must total 100." },
                  },
                  required: ["variant_label", "subject", "body", "split_percentage"],
                },
              },
            },
            required: ["order", "type"],
          },
        },
        status: { type: "string", enum: ["draft", "active", "paused", "completed"] },
        settings: { type: "object", description: "Partial settings to merge with existing. tracking_domain_id and lead_list_id are accepted here too (nested) but are stored on the sequence's own columns, not settings JSON." },
        tracking_domain_id: { type: "string", description: "Tracking domain UUID (use list of email_tracking_domains). Accepted here or nested in settings." },
        lead_list_id: { type: "string", description: "Lead list UUID to source enrollments from (use list_lead_lists)." },
        auto_enroll_new_members: { type: "boolean", description: "Continuously enroll newly added members of the attached lead list. Stored on the sequence column, not in settings." },
        autopilot_config: { type: "object", description: "Full autopilot configuration (replaces entire config)" },
      },
      required: ["sequence_id"],
    },
  },
  duplicate_email_sequence: {
    description: "Duplicate an email sequence — copies its steps, settings, mailbox pool, tracking domain and enrollment filter into a NEW sequence. The copy is always created as a draft, so duplicating never starts sending. Optionally carries the audience: copy_lead_lists attaches the same lead lists (with their auto-enroll setup), copy_enrolled_leads re-enrols the leads currently in the source at step 0. Copied leads pass the usual admission guards — unsubscribed/bounced leads and leads already active in another sequence are skipped and reported back.",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string", description: "UUID of the sequence to copy" },
        name: { type: "string", description: "Name for the copy (default: '<source name> (copy)')" },
        copy_lead_lists: { type: "boolean", description: "Attach the same lead lists, auto-enroll setting and enrollment filter (default false)" },
        copy_enrolled_leads: { type: "boolean", description: "Enroll the leads currently in the source sequence into the copy (default false). Runs the full enrollment path, so this call can take a while on a large audience." },
      },
      required: ["sequence_id"],
    },
  },
  delete_email_sequence: {
    description: "Delete an email sequence and all its enrollments",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string", description: "The sequence UUID" },
      },
      required: ["sequence_id"],
    },
  },
  toggle_email_sequence: {
    description: "Activate or pause an email sequence",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string", description: "The sequence UUID" },
        status: { type: "string", enum: ["active", "paused"], description: "'active' to start sending, 'paused' to stop" },
      },
      required: ["sequence_id", "status"],
    },
  },
  list_email_enrollments: {
    description: "List leads enrolled in an email sequence with their status, current step, and contact details",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string", description: "The sequence UUID" },
        status: {
          type: "string",
          enum: ["active", "paused", "completed", "replied", "bounced", "unsubscribed"],
          description: "Filter by enrollment status",
        },
        limit: { type: "number", description: "Max results (default 50, max 10000). Use a high limit to fetch all enrollments at once." },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["sequence_id"],
    },
  },
  enroll_leads: {
    description: "Bulk enroll leads into an email sequence. Accepts either leads.id or crm_contacts.id (e.g. ids from list_contacts/search_contacts_and_leads) — contact ids are auto-resolved to their lead record, creating one if it doesn't exist yet. Duplicates are silently ignored. To continue an existing email thread from the same mailbox (e.g. moving an interested replier into a follow-up sequence), pass continue_from_conversation_id — the follow-up then sends from that conversation's mailbox and threads onto it (Re: + In-Reply-To) instead of rotating a fresh inbox.",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string", description: "The sequence UUID" },
        lead_ids: { type: "array", items: { type: "string" }, description: "Lead or contact UUIDs to enroll (leads.id or crm_contacts.id, either works)" },
        continue_from_conversation_id: { type: "string", description: "Optional. CRM conversation UUID to continue: the follow-up keeps the same mailbox + email thread the prospect already replied to." },
      },
      required: ["sequence_id", "lead_ids"],
    },
  },
  list_conversations: {
    description: "List CRM inbox conversations (the unibox) across channels. Filter by channel, status, lead intent, or unread. Returns each conversation's contact, channel, mailbox, intent, and last-message preview.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Filter by channel: email, linkedin, instagram, whatsapp, sms, telegram" },
        status: { type: "string", description: "Filter by status: open, snoozed, closed, archived (default: all)" },
        lead_intent: { type: "string", description: "Filter by classified intent, e.g. interested, meeting_booked, not_interested, out_of_office" },
        unread_only: { type: "boolean", description: "Only conversations with unread messages" },
        limit: { type: "number", description: "Max results (default 50, max 200)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
  },
  get_conversation: {
    description: "Get a single conversation with its messages (chronological) and the thread context needed to reply in-thread (mailbox, last Message-ID, references, subject). Per-message classification is in each message's metadata.classification.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", description: "The conversation UUID" },
        message_limit: { type: "number", description: "Max messages (newest-first window, returned chronologically; default 50, max 200)" },
      },
      required: ["conversation_id"],
    },
  },
  send_conversation_reply: {
    description: "Send a reply INTO a conversation — in the same email thread and from the same mailbox the prospect is talking to (Re: subject + In-Reply-To/References for email; same chat for LinkedIn/IG/etc.). Use this to reply directly from the unibox instead of, or before, enrolling into a follow-up sequence.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", description: "The conversation UUID to reply in" },
        content: { type: "string", description: "Message body. For content_type 'html', raw HTML — e.g. an `<a href><img></a>` snippet to embed a linked thumbnail (a Loom video preview, for instance)." },
        content_type: { type: "string", enum: ["text", "html"], description: "Defaults to 'text'. Set to 'html' to send raw HTML — only meaningful for email conversations; other channels render it as literal text." },
        subject: { type: "string", description: "Optional email subject; omit to keep the existing thread subject" },
      },
      required: ["conversation_id", "content"],
    },
  },
  update_enrollment_status: {
    description: "Update the status of a single enrollment (pause, resume, complete, or unsubscribe a lead)",
    inputSchema: {
      type: "object",
      properties: {
        enrollment_id: { type: "string", description: "The enrollment UUID" },
        sequence_id: { type: "string", description: "The sequence UUID (for org verification)" },
        status: {
          type: "string",
          enum: ["active", "paused", "completed", "unsubscribed"],
          description: "New enrollment status",
        },
      },
      required: ["enrollment_id", "sequence_id", "status"],
    },
  },
  list_email_mailboxes: {
    description: "List all connected email mailboxes. Use this to find mailbox IDs for configuring sequence settings.mailbox_ids.",
    inputSchema: { type: "object", properties: {} },
  },

  // CRM Contacts
  list_contacts: {
    description: "List CRM contacts with search, filters, and pagination. Returns total count for pagination.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by display name, email, or company" },
        status: { type: "string", enum: ["active", "archived", "bounced", "unsubscribed", "do_not_contact"], description: "Filter by status" },
        pipeline_id: { type: "string", description: "Filter by CRM pipeline ID" },
        stage_id: { type: "string", description: "Filter by pipeline stage ID" },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags (contacts matching ANY of the tags)" },
        source: { type: "string", description: "Filter by source (e.g. 'linkedin', 'manual', 'mcp', 'csv_import')" },
        contact_type: { type: "string", enum: ["prospect", "lead", "contact"], description: "Filter by contact type" },
        outreach_status: { type: "string", enum: ["unreached", "reached", "replied"], description: "Filter by outreach status" },
        min_score: { type: "number", description: "Minimum lead score" },
        max_score: { type: "number", description: "Maximum lead score" },
        sort_by: { type: "string", enum: ["last_activity_at", "display_name", "created_at", "lead_score"], description: "Sort field (default: last_activity_at)" },
        sort_direction: { type: "string", enum: ["asc", "desc"], description: "Sort direction (default: desc)" },
        limit: { type: "number", description: "Max results (default 50, max 10000). Use a high limit to fetch all contacts at once." },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
  },
  get_contact: {
    description: "Get full details of a CRM contact including identities, recent activities (last 20), and notes.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "Contact UUID" },
      },
      required: ["contact_id"],
    },
  },
  create_contact: {
    description: "Create a new CRM contact. Logs a 'contact_created' activity.",
    inputSchema: {
      type: "object",
      properties: {
        display_name: { type: "string", description: "Display name (required)" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        company: { type: "string" },
        job_title: { type: "string" },
        primary_email: { type: "string" },
        primary_phone: { type: "string" },
        primary_linkedin_url: { type: "string" },
        instagram_url: { type: "string", description: "Instagram profile URL or @handle. Instagram campaign steps resolve it to a messaging id." },
        linkedin_bio: { type: "string", description: "Contact's LinkedIn bio/summary. Standard field, usable as {{linkedin_bio}}." },
        home_page_text: { type: "string", description: "Contact's company home page text. Standard field, usable as {{home_page_text}}." },
        company_website: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        country: { type: "string" },
        pipeline_id: { type: "string", description: "CRM pipeline ID" },
        stage_id: { type: "string", description: "Pipeline stage ID (auto-sets stage_entered_at)" },
        tags: { type: "array", items: { type: "string" }, description: "Tags to assign" },
        source: { type: "string", description: "Contact source (default: 'mcp')" },
        custom_fields: { type: "object", description: "Custom field values as key-value pairs" },
        owner_user_id: { type: "string", description: "User ID to assign as owner" },
        discovery_metadata: { type: "object", description: "Discovery-layer signal context: signal_type, signal_detail, signal_outreach_context, signal_date, signal_source_url, ai_signal_* keys. Powers {{ai_signal_*}} email variables." },
        email_verification_status: { type: "string", enum: ["valid", "invalid", "risky", "catch_all", "disposable", "role", "role_only", "unknown"], description: "CRM email verification status. Writes the crm_contacts.email_verification_status column (not a custom field)." },
        email_verification_score: { type: "number", description: "Verification confidence score (0-100)." },
        email_verification_source: { type: "string", description: "Verifier source (e.g. mailtester_ninja, gmaps_scrape, heuristic, tier1)." },
        email_verified_at: { type: "string", description: "ISO timestamp when verifier last checked this email. Defaults to now when email_verification_status is provided without it." },
        email_last_validated_at: { type: "string", description: "ISO timestamp the provider last validated the email (e.g. MoltSets last_validated_at)." },
        email_type: { type: "string", description: "Email type classification (e.g. professional, personal)." },
        email_is_deliverable: { type: "boolean" },
        email_is_catch_all: { type: "boolean" },
        email_is_disposable: { type: "boolean" },
        email_is_free: { type: "boolean" },
        email_is_role: { type: "boolean" },
        email_is_spamtrap: { type: "boolean" },
        email_verifier_raw: { type: "object", description: "Optional raw verifier JSON stored in email_address_verifications" },
      },
      required: ["display_name"],
    },
  },
  update_contact: {
    description: "Update an existing CRM contact. Automatically handles stage_entered_at on stage changes and lead_score_updated_at on score changes.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "Contact UUID" },
        display_name: { type: "string" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        company: { type: "string" },
        job_title: { type: "string" },
        primary_email: { type: "string" },
        primary_phone: { type: "string" },
        primary_linkedin_url: { type: "string" },
        instagram_url: { type: "string", description: "Instagram profile URL or @handle. Instagram campaign steps resolve it to a messaging id." },
        linkedin_bio: { type: "string", description: "Contact's LinkedIn bio/summary. Standard field, usable as {{linkedin_bio}}." },
        home_page_text: { type: "string", description: "Contact's company home page text. Standard field, usable as {{home_page_text}}." },
        company_website: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        country: { type: "string" },
        pipeline_id: { type: "string" },
        stage_id: { type: "string" },
        status: { type: "string", enum: ["active", "archived", "bounced", "unsubscribed", "do_not_contact"] },
        tags: { type: "array", items: { type: "string" }, description: "Full replacement of tags array" },
        lead_score: { type: "number" },
        custom_fields: { type: "object" },
        owner_user_id: { type: "string" },
        discovery_metadata: { type: "object", description: "Discovery-layer signal context. Powers {{ai_signal_*}} email variables." },
        enrichment_data: { type: "object", description: "AI company-analysis fields, merged into the existing record (never replaces it). Powers the {{ai_company_offering}}, {{ai_company_target}}, {{ai_company_niche}}, {{ai_company_tagline}}, {{ai_primary_need}}, {{ai_cold_email_angle}}, {{ai_best_hook}} and other {{ai_*}} email variables — set keys like company_offering, company_target, company_niche, company_tagline, primary_need, primary_need_reasoning, cold_email_angle, best_post_hook (see src/lib/message-variables.ts for the full field→variable map)." },
        email_verification_status: { type: "string", enum: ["valid", "invalid", "risky", "catch_all", "disposable", "role", "role_only", "unknown"], description: "CRM email verification status. Writes the crm_contacts.email_verification_status column (not a custom field)." },
        email_verification_score: { type: "number", description: "Verification confidence score (0-100)." },
        email_verification_source: { type: "string", description: "Verifier source (e.g. mailtester_ninja, gmaps_scrape, heuristic, tier1)." },
        email_verified_at: { type: "string", description: "ISO timestamp when verifier last checked this email. Defaults to now when email_verification_status is provided without it." },
        email_last_validated_at: { type: "string", description: "ISO timestamp the provider last validated the email (e.g. MoltSets last_validated_at)." },
        email_type: { type: "string", description: "Email type classification (e.g. professional, personal)." },
        email_is_deliverable: { type: "boolean" },
        email_is_catch_all: { type: "boolean" },
        email_is_disposable: { type: "boolean" },
        email_is_free: { type: "boolean" },
        email_is_role: { type: "boolean" },
        email_is_spamtrap: { type: "boolean" },
        email_verifier_raw: { type: "object" },
      },
      required: ["contact_id"],
    },
  },
  delete_contacts: {
    description: "Delete one or more CRM contacts permanently.",
    inputSchema: {
      type: "object",
      properties: {
        contact_ids: { type: "array", items: { type: "string" }, description: "Contact UUIDs to delete (max 100)" },
      },
      required: ["contact_ids"],
    },
  },
  bulk_update_contacts: {
    description: "Bulk update status, pipeline, stage, owner, or tags for multiple CRM contacts at once (max 100 per call). For more than 100 contacts, loop this call in batches of 100 over the same contact set — it only updates existing contacts and never touches lists, so it has no effect on how many lists exist.",
    inputSchema: {
      type: "object",
      properties: {
        contact_ids: { type: "array", items: { type: "string" }, description: "Contact UUIDs to update (max 100 per call; loop for more)" },
        status: { type: "string", enum: ["active", "archived", "bounced", "unsubscribed", "do_not_contact"] },
        pipeline_id: { type: "string" },
        stage_id: { type: "string" },
        owner_user_id: { type: "string" },
        tags: { type: "array", items: { type: "string" }, description: "Full replacement of tags array for all contacts" },
      },
      required: ["contact_ids"],
    },
  },
  add_contact_tag: {
    description: "Add a tag to a CRM contact. No-op if the tag already exists on the contact.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "Contact UUID" },
        tag: { type: "string", description: "Tag to add" },
      },
      required: ["contact_id", "tag"],
    },
  },
  remove_contact_tag: {
    description: "Remove a tag from a CRM contact.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "Contact UUID" },
        tag: { type: "string", description: "Tag to remove" },
      },
      required: ["contact_id", "tag"],
    },
  },
  list_crm_pipelines: {
    description: "List all CRM pipelines with their stages. Use this to get pipeline_id and stage_id values for contact operations.",
    inputSchema: { type: "object", properties: {} },
  },
  add_contact_note: {
    description: "Add an internal note to a CRM contact.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "Contact UUID" },
        content: { type: "string", description: "Note content (supports markdown)" },
        is_pinned: { type: "boolean", description: "Pin this note to the top (default: false)" },
      },
      required: ["contact_id", "content"],
    },
  },

  // Public buying-signals feed (the public /signals marketing page)
  push_public_signal: {
    description: "Push a buying signal (with optional decision-makers) onto the public /signals feed. Idempotent on dedup_key (defaults to company|type|source_url). source_url is required. People are stored company-keyed and shown masked (first name + last initial). Set published:false to stage a row without showing it.",
    inputSchema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Company name (required)" },
        signal_type: {
          type: "string",
          enum: ["funding", "acquisition", "hiring", "hiring_demand", "job_change", "executive_hire", "customer_win", "award", "growth"],
          description: "Signal type (required)",
        },
        source_url: { type: "string", description: "Evidence/source URL (required)" },
        domain: { type: "string", description: "Company domain (used for logo)" },
        country: { type: "string" },
        location: { type: "string", description: "Display location (city, country)" },
        title: { type: "string", description: "Short headline for the signal" },
        summary: { type: "string", description: "One-to-two sentence summary" },
        why_it_matters: { type: "string", description: "Why this signal is actionable for outreach" },
        amount_label: { type: "string", description: "Human amount, e.g. '$12M'" },
        amount_usd: { type: "number", description: "Numeric amount in USD" },
        signal_date: { type: "string", description: "YYYY-MM-DD (defaults to today, UTC)" },
        source_key: { type: "string", description: "Machine source key, e.g. 'google_news_rss'" },
        source_label: { type: "string", description: "Human source label, e.g. 'Google News' (defaults to source host)" },
        verified: { type: "boolean", description: "Whether the signal is verified (default false)" },
        quality_score: { type: "number", description: "0..1 quality/relevance score for ranking" },
        published: { type: "boolean", description: "Show on the public feed (default true)" },
        company_linkedin_url: { type: "string" },
        logo_url: { type: "string", description: "Explicit logo URL (else derived from domain)" },
        dedup_key: { type: "string", description: "Override the idempotency key" },
        people: {
          type: "array",
          description: "Decision-makers at the company (stored company-keyed, shown masked on public page; email shown only in authenticated library)",
          items: {
            type: "object",
            properties: {
              full_name: { type: "string", description: "Full name (required; shown masked)" },
              linkedin_url: { type: "string", description: "LinkedIn URL (required; uniqueness key, never shown)" },
              title: { type: "string" },
              photo_url: { type: "string", description: "Headshot URL (shown blurred)" },
              seniority_rank: { type: "number", description: "0..100; higher = more senior (auto-derived from title if omitted)" },
              email: { type: "string", description: "Verified business email (authenticated library only; never shown on public marketing page)" },
              email_status: { type: "string", description: "verified | valid | catch_all" },
            },
            required: ["full_name", "linkedin_url"],
          },
        },
        company: {
          type: "object",
          description: "Company firmographics (stored company-keyed; what the auto-add employee/revenue gates read). Only the keys you send are written — omitted keys keep whatever is already stored.",
          properties: {
            employee_count: { type: "number", description: "EXACT headcount, not a band — the size gates derive bands from it" },
            employee_range: { type: "string", description: "e.g. '51-200'" },
            revenue_range: { type: "string", description: "e.g. '$10M-$50M'" },
            industry: { type: "string" },
            linkedin_industries: { type: "array", items: { type: "string" } },
            naics_titles: { type: "array", items: { type: "string" } },
            country: { type: "string" },
            state: { type: "string" },
            city: { type: "string" },
            domain: { type: "string", description: "Defaults to the signal's domain" },
            source: { type: "string", description: "Provenance, e.g. 'moltsets' (default 'push')" },
          },
        },
      },
      required: ["company_name", "signal_type", "source_url"],
    },
  },

  // Email Leads
  list_leads: {
    description: "List email leads with search and filtering. Use this to find lead IDs needed for enroll_leads.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by email, name, or company" },
        source: { type: "string", description: "Filter by source (e.g. 'crm_contact', 'campaign', 'manual', 'mcp')" },
        email_status: { type: "string", enum: ["valid", "risky", "invalid", "catch_all", "unknown"], description: "Filter by email verification status" },
        limit: { type: "number", description: "Max results (default 50, max 10000). Use a high limit to fetch all leads at once." },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
  },
  get_lead: {
    description: "Get full details of an email lead including their active sequence enrollments.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "Lead UUID" },
      },
      required: ["lead_id"],
    },
  },
  create_lead: {
    description: "Create a single email lead. Idempotent — if a lead with the same email already exists in this org, returns the existing lead with created=false.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address (required)" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        company: { type: "string" },
        job_title: { type: "string" },
        linkedin_url: { type: "string" },
        source: { type: "string", description: "Lead source (default: 'mcp')" },
        source_id: { type: "string", description: "Reference UUID (e.g. crm_contacts.id)" },
        assigned_mailbox_id: { type: "string", description: "Sticky mailbox assignment for email sequences" },
      },
      required: ["email"],
    },
  },
  bulk_create_leads: {
    description: "Create multiple email leads at once (max 100). Leads with emails that already exist in this org are skipped automatically.",
    inputSchema: {
      type: "object",
      properties: {
        leads: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string", description: "Email address (required)" },
              first_name: { type: "string" },
              last_name: { type: "string" },
              company: { type: "string" },
              job_title: { type: "string" },
              linkedin_url: { type: "string" },
              source: { type: "string" },
              source_id: { type: "string" },
            },
            required: ["email"],
          },
          description: "Array of leads to create (max 100)",
        },
      },
      required: ["leads"],
    },
  },
  bulk_create_contacts: {
    description: "Create multiple CRM contacts at once (max 100). When dedupe_on_email is on (default), contacts whose primary_email already exists in this org — or is duplicated within the batch — are skipped. Contacts without an email are always inserted. display_name is derived from first/last name, company, or email when omitted. Returns { created, skipped, total_submitted, contact_ids }. Uploading more than 100 contacts into one list is normal: loop this call in batches of 100, collecting contact_ids from each response, then feed all of them into add_contacts_to_list against a single list_id (create it once with create_lead_list). Never create a separate list per batch.",
    inputSchema: {
      type: "object",
      properties: {
        contacts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              display_name: { type: "string", description: "Display name (derived from first/last name, company, or email if omitted)" },
              first_name: { type: "string" },
              last_name: { type: "string" },
              company: { type: "string" },
              job_title: { type: "string" },
              primary_email: { type: "string" },
              primary_phone: { type: "string" },
              primary_linkedin_url: { type: "string" },
              instagram_url: { type: "string", description: "Instagram profile URL or @handle. Instagram campaign steps resolve it to a messaging id." },
              linkedin_bio: { type: "string", description: "Contact's LinkedIn bio/summary. Standard field, usable as {{linkedin_bio}}." },
              home_page_text: { type: "string", description: "Contact's company home page text. Standard field, usable as {{home_page_text}}." },
              company_website: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              country: { type: "string" },
              pipeline_id: { type: "string", description: "CRM pipeline ID" },
              stage_id: { type: "string", description: "Pipeline stage ID (auto-sets stage_entered_at)" },
              tags: { type: "array", items: { type: "string" } },
              source: { type: "string", description: "Per-contact source override" },
              custom_fields: { type: "object", description: "Custom field values as key-value pairs" },
              owner_user_id: { type: "string" },
            },
          },
          description: "Array of contacts to create (max 100)",
        },
        dedupe_on_email: { type: "boolean", description: "Skip contacts whose primary_email already exists in the org (default true)" },
        log_activity: { type: "boolean", description: "Log a 'contact_created' activity per contact (default true)" },
        source: { type: "string", description: "Default source for contacts that don't set their own (default 'mcp')" },
      },
      required: ["contacts"],
    },
  },

  // Unified Search
  search_contacts_and_leads: {
    description: "Search across both CRM contacts and email leads in one call. Returns matches from both systems, useful when you don't know which system a person is in.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (matches name, email, company)" },
        limit: { type: "number", description: "Max results per system (default 10, max 25)" },
      },
      required: ["query"],
    },
  },

  // Lead Lists
  list_lead_lists: {
    description: "List lead lists (manual and smart lists) with optional filtering. Smart lists have dynamic filter criteria that auto-compute matching contacts.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by list name" },
        status: { type: "string", enum: ["active", "archived"], description: "Filter by status" },
        source_type: { type: "string", enum: ["manual", "csv", "linkedin_search", "event", "post_reactors", "smart"], description: "Filter by source type" },
        include_smart: { type: "boolean", description: "Include smart lists (default: true). Set to false to only show static lists." },
        limit: { type: "number", description: "Max results (default 50, max 10000). Use a high limit to fetch all lists at once." },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
  },
  get_lead_list: {
    description: "Get a lead list with its members. Returns the list details and paginated contact members with their CRM data.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "Lead list UUID" },
        include_members: { type: "boolean", description: "Include list members (default: true)" },
        members_limit: { type: "number", description: "Max members to return (default 50, max 10000). Use a high limit for large lists." },
        members_offset: { type: "number", description: "Members pagination offset (default 0)" },
      },
      required: ["list_id"],
    },
  },
  create_lead_list: {
    description: "Create a new lead list. Optionally add initial contacts by providing contact_ids (max 500). IMPORTANT for bulk uploads larger than 500 or 100 contacts: call this ONCE to create the list, then call add_contacts_to_list repeatedly with the SAME list_id for the remaining contacts in batches of up to 500 (and bulk_create_contacts in batches of up to 100 if you still need to create the contacts first). Never call create_lead_list again per batch — that fragments one upload into multiple lists.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "List name (required)" },
        description: { type: "string", description: "List description" },
        source_type: { type: "string", enum: ["manual", "csv", "linkedin_search", "event", "post_reactors"], description: "Source type (default: 'manual')" },
        contact_ids: { type: "array", items: { type: "string" }, description: "Contact UUIDs to add as initial members (max 500 — use add_contacts_to_list with this list's id for the rest, not another create_lead_list call)" },
      },
      required: ["name"],
    },
  },
  update_lead_list: {
    description: "Update a lead list's name, description, or status.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "Lead list UUID" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["active", "archived"] },
      },
      required: ["list_id"],
    },
  },
  delete_lead_list: {
    description: "Delete a lead list and all its memberships permanently.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "Lead list UUID" },
      },
      required: ["list_id"],
    },
  },
  add_contacts_to_list: {
    description: "Add CRM contacts to a lead list. Skips contacts already in the list. Updates the list's lead_count. For an upload with more than 500 contacts, call this repeatedly with the SAME list_id, one batch of up to 500 at a time — do not create a new list per batch, they all belong on one list.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "Lead list UUID — reuse the same id across every batch of one bulk upload" },
        contact_ids: { type: "array", items: { type: "string" }, description: "Contact UUIDs to add (max 500 per call; loop with the same list_id for more)" },
      },
      required: ["list_id", "contact_ids"],
    },
  },
  remove_contacts_from_list: {
    description: "Remove CRM contacts from a lead list. Updates the list's lead_count.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "Lead list UUID" },
        contact_ids: { type: "array", items: { type: "string" }, description: "Contact UUIDs to remove" },
      },
      required: ["list_id", "contact_ids"],
    },
  },

  // Lead Processing Setup (automated qualify → enrich → verify → route policy)
  get_lead_processing_setup: {
    description: "Get the automated lead-processing setup (qualification, email enrichment/verification, and outcome routing) for a lead list. Returns configured:false when no setup exists yet.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "Lead list UUID" },
      },
      required: ["list_id"],
    },
  },
  configure_lead_processing_setup: {
    description: "Create or update the automated processing setup for a lead list (the same configuration as the app's 'Processing setup' dialog). Defines how contacts in the list are qualified by ICP, enriched/verified for a usable email, and routed to a destination. Upserts one policy per list. Set enabled=true to auto-process new contacts entering the list; existing contacts are processed separately via the app's Actions menu. Referenced destination IDs must belong to the same organization.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "Lead list UUID (required)" },
        enabled: { type: "boolean", description: "Automatically process new contacts entering this list (default false)" },

        // Step 1 — Qualify contacts by ICP fit
        analyze_icp: { type: "boolean", description: "Score contacts against an ICP before enrichment (default false)" },
        icp_product_id: { type: "string", description: "library_products UUID for product context (optional)" },
        icp_ids: { type: "array", items: { type: "string" }, description: "library_icps UUIDs to score against. Omit to use the product's linked ICPs." },
        min_icp_score: { type: "number", description: "0-100 minimum ICP score to continue. Omit for no threshold." },
        icp_llm_provider: { type: "string", description: "LLM provider slug for ICP scoring (e.g. 'anthropic', 'openai', 'ollama'). Omit for workspace default." },
        icp_llm_model: { type: "string", description: "Model id for the chosen LLM provider (required when icp_llm_provider is set)." },
        analyze_when: { type: "string", enum: ["always", "if_stale"], description: "'if_stale' (default) reuses a company analysis newer than analysis_freshness_days instead of re-crawling the site and re-running the LLM — only when that analysis was scoped to the same product + ICPs. 'always' re-analyzes every contact." },
        analysis_freshness_days: { type: "number", description: "1-3650. How recent a stored analysis must be for analyze_when='if_stale' to reuse it (default 30)." },

        // Step 2 — Get a usable email
        email_strategy: { type: "string", enum: ["none", "find_only", "verify_only", "find_then_verify", "verify_then_recover"], description: "Email workflow. 'none' skips email steps; 'find_only' finds a work email; 'verify_only' verifies the current email; 'find_then_verify' finds then verifies; 'verify_then_recover' verifies existing and finds a replacement when missing/invalid. Default 'none'." },
        email_provider_chain: { type: "array", items: { type: "string", enum: ["apollo", "hunter", "prospeo", "moltsets"] }, description: "Ordered email-finding providers (fallbacks run in order). Required when email_strategy finds an email." },
        verification_provider_chain: { type: "array", items: { type: "string", enum: ["lite", "apify_million_verifier", "mailtester_ninja"] }, description: "Ordered email-verification providers. Required when email_strategy verifies an email." },
        require_valid_email: { type: "boolean", description: "Only deliverable emails may continue to an email sequence (default true). Not applied for 'verify_then_recover'." },

        // Outcome routing (each type pairs with its _id; type 'none' keeps the contact in this list)
        low_icp_destination_type: { type: "string", enum: ["none", "list", "linkedin_campaign"], description: "Where to route contacts below min_icp_score." },
        low_icp_destination_id: { type: "string", description: "Destination lead_lists or linkedin_campaigns UUID for low_icp_destination_type." },
        no_source_data_destination_type: { type: "string", enum: ["none", "list", "linkedin_campaign"], description: "Where to route contacts with no company/LinkedIn data." },
        no_source_data_destination_id: { type: "string", description: "Destination UUID for no_source_data_destination_type." },
        no_email_destination_type: { type: "string", enum: ["none", "list", "linkedin_campaign"], description: "Where to route contacts when no work email is found." },
        no_email_destination_id: { type: "string", description: "Destination UUID for no_email_destination_type." },
        unverified_email_destination_type: { type: "string", enum: ["none", "list", "linkedin_campaign"], description: "Where to route contacts with no deliverable email." },
        unverified_email_destination_id: { type: "string", description: "Destination UUID for unverified_email_destination_type." },

        // Step 3 — Ready-contact destination
        approved_destination_type: { type: "string", enum: ["none", "email_sequence", "linkedin_campaign"], description: "Where ready contacts are enrolled as soon as they pass the enabled checks." },
        approved_destination_id: { type: "string", description: "email_sequences or linkedin_campaigns UUID for approved_destination_type." },

        // Step 4 — AI-written emails (email_sequence destinations only)
        write_message: { type: "boolean", description: "Write a personalized email sequence per contact with AI just before enrolling, exposed to the sequence as {{email_subject_1}}/{{email_body_1}}… The number of emails is taken from the destination sequence's email steps. Requires approved_destination_type='email_sequence' and analyze_icp=true." },
        message_prompt: { type: "string", description: "Creative brief for the AI writer. Supports {{variables}} resolved per contact ({{first_name}}, {{company}}, {{job_title}}, {{ai_primary_need}}, {{ai_company_niche}}, {{product_name}}…). Required when write_message is true." },
        message_llm_model: { type: "string", description: "Model id for the writer (e.g. 'anthropic/claude-sonnet-4.5', or an 'ollama:'-prefixed id). Omit for the workspace default." },
        message_temperature: { type: "number", description: "0-1 creativity for the writer (default 0.7)." },
        message_product_id: { type: "string", description: "library_products UUID injected as product context into the brief (optional)." },

        // Step 4b — AI icebreaker into a contact custom field (any destination)
        write_icebreaker: { type: "boolean", description: "Write a ONE-LINE icebreaker per contact into crm_contacts.custom_fields, referenced in any copy as {{custom_<icebreaker_field_key>}}. Unlike write_message this works with any destination and leaves the sequence normally enrollable — a missing icebreaker resolves to '' instead of blocking. Requires analyze_icp=true." },
        icebreaker_prompt: { type: "string", description: "Creative brief for the icebreaker. Same {{variables}} as message_prompt. Ask for one sentence, no greeting and no CTA — it is dropped into copy the user wrote. Required when write_icebreaker is true." },
        icebreaker_field_key: { type: "string", description: "Custom field key to store it under (default 'icebreaker' → {{custom_icebreaker}}). Lowercase letters, digits and underscores." },
        icebreaker_llm_model: { type: "string", description: "Model id for the icebreaker writer. Omit for the workspace default." },
        icebreaker_temperature: { type: "number", description: "0-1 creativity for the icebreaker writer." },

        // Step 6 — Fetch home page text via QuickEnrich
        fetch_home_page_text: { type: "boolean", description: "Look up each contact's company home page text via QuickEnrich Company Finder (include_full_text) and store it on crm_contacts.home_page_text, a standard field usable as {{home_page_text}}. Costs 1 QuickEnrich credit per company looked up. Requires QuickEnrich configured as an API key for the org. Fails soft — never blocks enrollment." },
      },
      required: ["list_id"],
    },
  },

  // LinkedIn Network Connections
  list_linkedin_connections: {
    description: "List LinkedIn network connections (people connected via Unipile-linked LinkedIn accounts). Supports search by name/company/headline and filtering by account.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by name, company, headline, or job title" },
        account_id: { type: "string", description: "Filter by Unipile account UUID" },
        limit: { type: "number", description: "Max results (default 50, max 10000). Use a high limit to fetch all connections at once." },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
  },
  get_linkedin_connection: {
    description: "Get full details of a LinkedIn connection including whether it's linked to a CRM contact.",
    inputSchema: {
      type: "object",
      properties: {
        connection_id: { type: "string", description: "LinkedIn connection UUID" },
      },
      required: ["connection_id"],
    },
  },

  // LinkedIn Lead Import
  search_linkedin_parameters: {
    description: "Look up LinkedIn search filter IDs (locations, industries, companies, etc.) by keyword. Use this to resolve human-readable names like 'San Francisco' or 'Software Development' into IDs required by start_linkedin_import. Supported types: location, industry, company, school, skill, function, seniority.",
    inputSchema: {
      type: "object",
      properties: {
        parameter_type: { type: "string", enum: ["location", "industry", "company", "school", "skill", "function", "seniority"], description: "Type of parameter to search" },
        keywords: { type: "string", description: "Search term (e.g. 'San Francisco', 'Software', 'Google')" },
        account_id: { type: "string", description: "Unipile LinkedIn account UUID. If omitted, uses the first active LinkedIn account." },
      },
      required: ["parameter_type", "keywords"],
    },
  },
  build_linkedin_search_url: {
    description: "Build a LinkedIn search URL from keywords and filters. Returns a URL that can be opened in a browser or passed to start_linkedin_import. Supports LinkedIn classic search, Sales Navigator, and Recruiter URL formats.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: { type: "string", description: "Search keywords (e.g. 'CEO', 'Marketing Director')" },
        platform: { type: "string", enum: ["linkedin", "sales_navigator", "recruiter"], description: "Which LinkedIn platform (default: linkedin)" },
        geo_urns: { type: "array", items: { type: "string" }, description: "Location URN IDs from search_linkedin_parameters" },
        network: { type: "array", items: { type: "string", enum: ["F", "S", "O"] }, description: "Connection degrees: F=1st, S=2nd, O=3rd+" },
        industry_urns: { type: "array", items: { type: "string" }, description: "Industry URN IDs" },
        company_urns: { type: "array", items: { type: "string" }, description: "Company URN IDs" },
      },
      required: ["keywords"],
    },
  },
  start_linkedin_import: {
    description: "Start importing leads from LinkedIn search results into a lead list. Supports two modes: (1) URL mode — pass a LinkedIn/Sales Nav/Recruiter search URL, or (2) Parameter mode — provide structured filters (keywords, location IDs, industry IDs, etc.). Creates a background import job. Use get_linkedin_import_job to check progress.",
    inputSchema: {
      type: "object",
      properties: {
        list_name: { type: "string", description: "Name for the lead list. Creates a new list if no list_id is provided." },
        list_id: { type: "string", description: "Existing lead list UUID. If provided, list_name is ignored." },
        max_leads: { type: "number", description: "Maximum leads to import (1-2500, default 100)" },
        account_id: { type: "string", description: "Unipile LinkedIn account UUID. If omitted, uses the first active LinkedIn account." },
        search_url: { type: "string", description: "LinkedIn search URL to import from (URL mode). Supports linkedin.com/search/results/people, /sales/search/, /talent/search/" },
        keywords: { type: "string", description: "Search keywords (parameter mode). e.g. 'CEO', 'VP Sales'" },
        location_ids: { type: "array", items: { type: "string" }, description: "Location IDs from search_linkedin_parameters" },
        industry_ids: { type: "array", items: { type: "string" }, description: "Industry IDs from search_linkedin_parameters" },
        company_ids: { type: "array", items: { type: "string" }, description: "Company IDs from search_linkedin_parameters" },
        network_distance: { type: "array", items: { type: "number", enum: [1, 2, 3] }, description: "Connection degrees: 1=1st, 2=2nd, 3=3rd+" },
        api_type: { type: "string", enum: ["classic", "sales_navigator"], description: "LinkedIn API to use. 'sales_navigator' requires an active Sales Navigator subscription. Default: 'classic'" },
      },
      required: ["list_name"],
    },
  },
  get_linkedin_import_job: {
    description: "Check the status and progress of a LinkedIn import job. Returns current progress percentage, leads found/imported/skipped, and any errors.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Import job UUID from start_linkedin_import" },
      },
      required: ["job_id"],
    },
  },
  list_linkedin_import_jobs: {
    description: "List recent LinkedIn import jobs with their status and results. Useful for checking what imports have been run and their outcomes.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "running", "completed", "failed", "cancelled"], description: "Filter by status" },
        limit: { type: "number", description: "Max results (default 10, max 50)" },
      },
    },
  },
  cancel_linkedin_import: {
    description: "Cancel a pending or running LinkedIn import job.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Import job UUID to cancel" },
      },
      required: ["job_id"],
    },
  },

  // ============================================================================
  // Apify B2B Lead Finder Tools
  // ============================================================================

  start_apify_leads_import: {
    description: "Start importing B2B leads with verified emails using Apify Leads Finder (Apollo alternative). Filters by job title, industry, company keywords, location, seniority, and company size. Creates a background import job with automatic batching for large imports. Use get_apify_leads_import_job to check progress.",
    inputSchema: {
      type: "object",
      properties: {
        list_name: { type: "string", description: "Name for the new lead list (required if no list_id)" },
        list_id: { type: "string", description: "Existing lead list UUID (alternative to list_name)" },
        contact_job_title: { type: "array", items: { type: "string" }, description: "Job title filters (e.g. ['CEO', 'Founder', 'CTO'])" },
        contact_location: { type: "array", items: { type: "string" }, description: "Location filters (e.g. ['United States', 'United Kingdom'])" },
        company_industry: { type: "array", items: { type: "string" }, description: "Industry filters (e.g. ['Information Technology & Services'])" },
        company_keywords: { type: "array", items: { type: "string" }, description: "Company keyword filters" },
        company_not_industry: { type: "array", items: { type: "string" }, description: "Industries to exclude" },
        company_not_keywords: { type: "array", items: { type: "string" }, description: "Company keywords to exclude" },
        contact_not_job_title: { type: "array", items: { type: "string" }, description: "Job titles to exclude" },
        email_status: { type: "array", items: { type: "string", enum: ["validated", "any"] }, description: "Email verification status (default: ['validated'])" },
        seniority_level: { type: "array", items: { type: "string", enum: ["founder", "owner", "c_suite", "director", "partner", "vp", "manager", "senior", "entry"] }, description: "Seniority level filters" },
        functional_level: { type: "array", items: { type: "string", enum: ["c_suite", "owner", "partner", "vp", "director", "manager", "senior", "entry", "training"] }, description: "Functional level filters" },
        size: { type: "array", items: { type: "string", enum: ["1-10", "11-20", "21-50", "51-100", "101-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"] }, description: "Company size ranges" },
        fetch_count: { type: "number", description: "Total leads to import (default 1000, max 30000)" },
        batch_size: { type: "number", description: "Leads per batch (default 2500, max 5000)" },
      },
      required: ["list_name"],
    },
  },
  get_apify_leads_import_job: {
    description: "Check the status and progress of an Apify leads import job. Returns progress %, leads found/imported/skipped, batch details, and estimated cost.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Import job UUID from start_apify_leads_import" },
      },
      required: ["job_id"],
    },
  },
  list_apify_leads_import_jobs: {
    description: "List recent Apify leads import jobs with their status and results.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "running", "completed", "failed", "cancelled"], description: "Filter by status" },
        limit: { type: "number", description: "Max results (default 10, max 50)" },
      },
    },
  },
  cancel_apify_leads_import: {
    description: "Cancel a pending or running Apify leads import job.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Import job UUID to cancel" },
      },
      required: ["job_id"],
    },
  },

  // ============================================================================
  // B2B Lead Pool Tools (123M-row pre-enriched pool)
  // ============================================================================

  search_lead_pool: {
    description: "Preview matches in the 123M-row B2B lead pool by SIC code, free-text keyword, geography, company size, seniority, and email status. Returns up to `limit` sample rows plus an exact total count of distinct matches. Use this before build_lead_pool_list to validate the filter narrows to a reasonable set. Filters with neither industry nor a 2-character keyword are rejected to avoid full-pool scans. Geography is US-state-level only: there is no country filter (the pool has no country column), so a non-US target cannot be expressed here — use state or city.",
    inputSchema: {
      type: "object",
      properties: {
        sic_code_in: { type: "array", items: { type: "string" }, description: "List of 4-digit SIC codes (e.g. ['1711','1731'] for HVAC/electrical contractors)" },
        keyword: { type: "string", description: "Free-text keyword (matches title / company / company_keywords / company_short_description). Comma-separated for OR (e.g. 'plumbing, HVAC')" },
        match_combinator: { type: "string", enum: ["and", "or"], description: "How to combine sic_code_in with keyword (default 'and')" },
        state: { type: "string", description: "US 2-letter state code (e.g. 'CA'). The only working geography bound — see country." },
        city: { type: "string" },
        employees_min: { type: "number" },
        employees_max: { type: "number" },
        seniority_in: { type: "array", items: { type: "string", enum: ["cxo","partner","vp","head","director","manager"] } },
        email_status: { type: "string", enum: ["any","valid","catch_all","verified_or_catch_all"], description: "Filter by email verification status" },
        has_linkedin: { type: "boolean" },
        has_phone: { type: "boolean" },
        limit: { type: "number", description: "Sample rows to return (default 25, max 1000)" },
      },
    },
  },

  build_lead_pool_list: {
    description: "Build a lead list from the 123M-row B2B lead pool. Runs the same filter as search_lead_pool but enqueues a background job that paginates the full match set, upserts contacts (email-then-LinkedIn dedup), and inserts them as members of the target list. Returns {job_id} immediately — poll get_lead_pool_build_job for progress. Either pass an existing list_id or list_name to create a new list.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "Existing lead_lists.id to add into" },
        list_name: { type: "string", description: "Create a new list with this name (alternative to list_id)" },
        sic_code_in: { type: "array", items: { type: "string" } },
        keyword: { type: "string" },
        match_combinator: { type: "string", enum: ["and", "or"] },
        state: { type: "string", description: "US 2-letter state code. The only working geography bound; country is rejected." },
        city: { type: "string" },
        employees_min: { type: "number" },
        employees_max: { type: "number" },
        seniority_in: { type: "array", items: { type: "string" } },
        email_status: { type: "string" },
        has_linkedin: { type: "boolean" },
        has_phone: { type: "boolean" },
      },
    },
  },

  get_lead_pool_build_job: {
    description: "Check progress of a build_lead_pool_list job. Returns status, processed, errors, total, current_offset.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job UUID returned by build_lead_pool_list" },
      },
      required: ["job_id"],
    },
  },

  // ============================================================================
  // Outreach Campaign Tools
  // ============================================================================

  list_sender_accounts: {
    description: "List available sender accounts (LinkedIn, email, WhatsApp, etc.) for campaign use. Returns active connected accounts.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["linkedin", "email", "whatsapp", "instagram", "telegram"], description: "Filter by channel type" },
      },
    },
  },
  list_messaging_senders: {
    description: "List the org's Twilio senders: SMS numbers / sender names and WhatsApp Business senders, with country, two-way support, daily new-contact cap, status and (WhatsApp) quality rating and messaging limit. Separate from list_sender_accounts (Unipile).",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["sms", "whatsapp_business"], description: "Filter by channel" },
      },
    },
  },
  list_whatsapp_templates: {
    description: "List WhatsApp Business templates with approval status, category, language, body and variable mapping. Use the id as template_id in a whatsapp_template step.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["approved", "pending", "submitted", "rejected", "draft", "paused", "disabled"], description: "Filter by approval status" },
      },
    },
  },
  get_messaging_funnel: {
    description: "SMS / WhatsApp Business campaign funnel in leads: sent → delivered → replied → positive → booked, with step conversion rates (replied % of delivered, positive % of replies, booked % of positive). Out-of-office and auto-replies are kept out of replies and counted separately.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "One campaign (omit for every campaign)" },
        days: { type: "number", description: "Look-back window in days (default 90)" },
      },
    },
  },
  create_dbr_campaign: {
    description: "Create a draft database reactivation campaign: optional WhatsApp Business template, then two SMS (a reply stops it). Pick the lead list here or later in the app.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Campaign name (default 'Database reactivation')" },
        lead_list_id: { type: "string", description: "Lead list UUID" },
        whatsapp_template_id: { type: "string", description: "Approved WhatsApp template (list_whatsapp_templates). Omit for SMS only." },
        first_sms: { type: "string", description: "First text (default provided). Supports {{first_name}} etc." },
        last_sms: { type: "string", description: "Last nudge (default provided)" },
        days_after_whatsapp: { type: "number", description: "Days between the WhatsApp template and the first SMS (default 2)" },
        days_between_sms: { type: "number", description: "Days between the two SMS (default 3)" },
        agent_profile_id: { type: "string", description: "AI agent that answers replies (list_agent_profiles). Omit to answer from the inbox yourself." },
      },
    },
  },
  list_campaigns: {
    description: "List outreach campaigns with optional filtering. Returns compact list (no sequence data). Use get_campaign for full details.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "active", "paused", "completed"], description: "Filter by status" },
        search: { type: "string", description: "Search by campaign name" },
        limit: { type: "number", description: "Max results (default 20)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
  },
  get_campaign: {
    description: "Get full details of a campaign including its sequence, human-readable summary, and lead progress.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "Campaign UUID" },
        include_sequence: { type: "boolean", description: "Include raw sequence nodes/edges (default: true)" },
        include_leads_summary: { type: "boolean", description: "Include lead progress count by status (default: true)" },
      },
      required: ["campaign_id"],
    },
  },
  create_campaign: {
    description: "Create a new outreach campaign with a high-level sequence definition. Call get_help(topic='campaigns') first for full step type documentation and examples. The server compiles steps into React Flow nodes/edges with auto-layout. Campaign is created in 'draft' status.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Campaign name (3-255 chars, required)" },
        description: { type: "string", description: "Campaign description" },
        lead_list_id: { type: "string", description: "Lead list UUID (use list_lead_lists to find)" },
        sender_account_ids: { type: "array", items: { type: "string" }, description: "Sender account UUIDs (use list_sender_accounts to find)" },
        exclusion_list_ids: { type: "array", items: { type: "string" }, description: "Lead list UUIDs to exclude" },
        exclude_other_campaigns: { type: "boolean", description: "Exclude leads in other active campaigns (default: true)" },
        exclude_same_sender: { type: "boolean", description: "Exclude leads already contacted by same sender (default: true)" },
        steps: {
          type: "array",
          description: "Sequence steps in high-level DSL format. See get_help(topic='campaigns') for full documentation.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "Step type (e.g. 'connection_request', 'delay', 'if_connected')" },
              message: { type: "string" },
              message_variations: { type: "array", items: { type: "string" } },
              subject: { type: "string" },
              body: { type: "string" },
              subject_variations: { type: "array", items: { type: "string" } },
              body_variations: { type: "array", items: { type: "string" } },
              message_mode: { type: "string", enum: ["manual", "prompt"] },
              prompt: { type: "string" },
              prompt_variations: { type: "array", items: { type: "string" } },
              llm_model: { type: "string" },
              llm_temperature: { type: "number" },
              days: { type: "number" },
              hours: { type: "number" },
              minutes: { type: "number" },
              withdraw_after_days: { type: "number" },
              within_days: { type: "number" },
              branches: { type: "object", description: "Branch steps for condition nodes" },
              provider: { type: "string" },
              skip_if_has_email: { type: "boolean" },
              product_id: { type: "string" },
              like_count: { type: "number" },
              track_opens: { type: "boolean" },
              track_clicks: { type: "boolean" },
              engagement_type: { type: "string" },
              reaction_type: { type: "string" },
              comment_templates: { type: "array", items: { type: "string" } },
              continue_on_failure: { type: "boolean" },
              connection_id: { type: "string" },
              database_id: { type: "string" },
              blueprint_ids: { type: "array", items: { type: "string" } },
              target_channel: { type: "string" },
              check: { type: "string", enum: [...CONTACT_CHECKS], description: "if_channel_available: what to check" },
              channel: { type: "string", description: "if_channel_available: channel for the senderConnected or enteredOnChannel check" },
              channels: { type: "array", items: { type: "string", enum: [...ROUTE_CHANNELS] }, description: "route_by_channel: channels in priority order" },
              require_sender: { type: "boolean", description: "route_by_channel: skip channels the campaign has no sender on (default true)" },
              verify_on_unipile: { type: "boolean", description: "route_by_channel: confirm LinkedIn/Instagram/WhatsApp on Unipile (default false)" },
              entry_channel_first: { type: "boolean", description: "route_by_channel: try the channel a triggered lead reached out on first (default false)" },
              trigger_id: { type: "string", description: "if_channel_available: entry trigger id for the enteredViaTrigger check (omit for any trigger)" },
              email_subject: { type: "string" },
              email_body: { type: "string" },
              enrollment_mode: { type: "string" },
            },
            required: ["type"],
          },
        },
        stop_on_reply: { type: "boolean", description: "Stop sequence for a lead when they reply (default: true)" },
        campaign_type: { type: "string", enum: ["linkedin_only", "email_only", "multi_channel"], description: "Campaign type (default: linkedin_only)" },
        primary_channel: { type: "string", enum: ["linkedin", "email", "whatsapp", "instagram", "telegram"], description: "Primary channel (default: linkedin)" },
        campaign_settings: { type: "object", description: "Power settings: { stop_on_auto_reply, stop_company_on_reply, ai_filter_unlikely_reply, ai_filter_hostile }" },
      },
      required: ["name"],
    },
  },
  update_campaign: {
    description: "Update an existing campaign. Only draft or paused campaigns can be updated. If steps are provided, the entire sequence is recompiled.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "Campaign UUID (required)" },
        name: { type: "string" },
        description: { type: "string" },
        lead_list_id: { type: "string" },
        sender_account_ids: { type: "array", items: { type: "string" } },
        exclusion_list_ids: { type: "array", items: { type: "string" } },
        steps: {
          type: "array",
          description: "Full replacement of steps array. See get_help(topic='campaigns') for full documentation.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "Step type (e.g. 'connection_request', 'delay', 'if_connected')" },
              message: { type: "string" },
              message_variations: { type: "array", items: { type: "string" } },
              subject: { type: "string" },
              body: { type: "string" },
              subject_variations: { type: "array", items: { type: "string" } },
              body_variations: { type: "array", items: { type: "string" } },
              message_mode: { type: "string", enum: ["manual", "prompt"] },
              prompt: { type: "string" },
              prompt_variations: { type: "array", items: { type: "string" } },
              llm_model: { type: "string" },
              llm_temperature: { type: "number" },
              days: { type: "number" },
              hours: { type: "number" },
              minutes: { type: "number" },
              withdraw_after_days: { type: "number" },
              within_days: { type: "number" },
              branches: { type: "object", description: "Branch steps for condition nodes" },
              provider: { type: "string" },
              skip_if_has_email: { type: "boolean" },
              product_id: { type: "string" },
              like_count: { type: "number" },
              track_opens: { type: "boolean" },
              track_clicks: { type: "boolean" },
              engagement_type: { type: "string" },
              reaction_type: { type: "string" },
              comment_templates: { type: "array", items: { type: "string" } },
              continue_on_failure: { type: "boolean" },
              connection_id: { type: "string" },
              database_id: { type: "string" },
              blueprint_ids: { type: "array", items: { type: "string" } },
              target_channel: { type: "string" },
              check: { type: "string", enum: [...CONTACT_CHECKS], description: "if_channel_available: what to check" },
              channel: { type: "string", description: "if_channel_available: channel for the senderConnected or enteredOnChannel check" },
              channels: { type: "array", items: { type: "string", enum: [...ROUTE_CHANNELS] }, description: "route_by_channel: channels in priority order" },
              require_sender: { type: "boolean", description: "route_by_channel: skip channels the campaign has no sender on (default true)" },
              verify_on_unipile: { type: "boolean", description: "route_by_channel: confirm LinkedIn/Instagram/WhatsApp on Unipile (default false)" },
              entry_channel_first: { type: "boolean", description: "route_by_channel: try the channel a triggered lead reached out on first (default false)" },
              trigger_id: { type: "string", description: "if_channel_available: entry trigger id for the enteredViaTrigger check (omit for any trigger)" },
              email_subject: { type: "string" },
              email_body: { type: "string" },
              enrollment_mode: { type: "string" },
            },
            required: ["type"],
          },
        },
        stop_on_reply: { type: "boolean" },
        campaign_type: { type: "string", enum: ["linkedin_only", "email_only", "multi_channel"] },
        primary_channel: { type: "string" },
        campaign_settings: { type: "object" },
      },
      required: ["campaign_id"],
    },
  },
  update_campaign_status: {
    description: "Change campaign status. Use 'active' to start/resume, 'paused' to pause, 'draft' to move back to draft. Cannot activate without lead list, sender accounts, and at least one action node.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "Campaign UUID" },
        status: { type: "string", enum: ["active", "paused", "draft"], description: "Target status" },
      },
      required: ["campaign_id", "status"],
    },
  },
  delete_campaigns: {
    description: "Delete one or more campaigns. Only draft and paused campaigns can be deleted.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_ids: { type: "array", items: { type: "string" }, description: "Campaign UUIDs to delete" },
      },
      required: ["campaign_ids"],
    },
  },

  // ── Video Editor ───────────────────────────────────────────────
  push_remotion_code: {
    description:
      "🎬 Push a Remotion TSX composition into a video editor project. The code is compiled and previewed live in the editor. Use this to create or update a programmatic video composition from external code generation. The code must be self-contained (no imports — deps are pre-injected as globals) and must include // @aspect, // @duration, and // @fps metadata comments at the top plus an export default at the end.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "UUID of the video editor project to update. Omit to create a new project.",
        },
        code: {
          type: "string",
          description:
            "Complete Remotion TSX composition. No import statements. Must include metadata comments (// @aspect portrait|landscape|square, // @duration Xs, // @fps 30) and end with: export default ComponentName",
        },
        title: {
          type: "string",
          description: "Project title (used when creating a new project or renaming an existing one)",
        },
      },
      required: ["code"],
    },
  },

  list_video_projects: {
    description: "📹 List video editor projects for the current organization.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },

  get_video_project: {
    description:
      "📹 Get a video editor project by ID, including its Remotion composition code. Use this to pull an existing composition for editing.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "UUID of the video project to retrieve",
        },
      },
      required: ["project_id"],
    },
  },

  set_video_sound_effects: {
    description:
      "🔊 Set sound effects on a video project. Replaces the entire sound_effects array. Each SFX needs a calculated timestamp (seconds from video start), URL, and volume.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "UUID of the video project",
        },
        sound_effects: {
          type: "array",
          description: "Array of sound effect objects",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique ID (e.g. sfx-hook-impact)" },
              url: { type: "string", description: "URL to the audio file" },
              name: { type: "string", description: "Human-readable name (e.g. Hook Impact)" },
              timestamp: { type: "number", description: "Start time in seconds from video start" },
              duration: { type: "number", description: "Duration in seconds" },
              volume: { type: "number", description: "Volume 0.0-1.0" },
            },
            required: ["id", "url", "name", "timestamp", "duration", "volume"],
          },
        },
      },
      required: ["project_id", "sound_effects"],
    },
  },

  set_video_music: {
    description:
      "🎵 Set background music on a video project. Provide a URL to an audio file (from generate-music edge function, Mixkit CDN, or any public URL).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "UUID of the video project",
        },
        url: { type: "string", description: "URL to the music audio file" },
        title: { type: "string", description: "Track title/description" },
        volume: { type: "number", description: "Volume 0.0-1.0 (default 0.2 with voiceover, 0.35 without)" },
        source: { type: "string", description: "Source identifier (e.g. ai, mixkit, upload)" },
      },
      required: ["project_id", "url"],
    },
  },

  set_video_voiceover: {
    description:
      "🎙️ Set voiceover audio on a video project. Use this after generating TTS externally, or use generate_video_tts for an all-in-one approach.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "UUID of the video project",
        },
        url: { type: "string", description: "URL to the voiceover audio file" },
        script: { type: "string", description: "The voiceover script text" },
        voice_id: { type: "string", description: "ElevenLabs voice ID used" },
        word_timestamps: {
          type: "array",
          description: "Word-level timestamps for captions",
          items: {
            type: "object",
            properties: {
              word: { type: "string" },
              start: { type: "number", description: "Start time in seconds" },
              end: { type: "number", description: "End time in seconds" },
            },
            required: ["word", "start", "end"],
          },
        },
      },
      required: ["project_id", "url"],
    },
  },

  generate_video_tts: {
    description:
      "🗣️ Generate text-to-speech voiceover and attach it to a video project. Uses ElevenLabs via the video-editor-tts edge function. Returns word-level timestamps for caption sync.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "UUID of the video project to attach voiceover to",
        },
        text: {
          type: "string",
          description: "The voiceover script text",
        },
        voice_id: {
          type: "string",
          description: "ElevenLabs voice ID. Omit to use org default or Rachel.",
        },
      },
      required: ["project_id", "text"],
    },
  },

  generate_video_music: {
    description:
      "🎶 Generate AI background music and attach it to a video project. Uses ElevenLabs music generation. Provide a mood/style prompt and duration.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "UUID of the video project to attach music to",
        },
        prompt: {
          type: "string",
          description: "Music style/mood description (e.g. 'dark ambient electronic with subtle synth pads')",
        },
        duration_seconds: {
          type: "number",
          description: "Music duration in seconds (default: matches video duration or 30s)",
        },
        volume: {
          type: "number",
          description: "Volume 0.0-1.0 (default 0.2 with voiceover, 0.35 without)",
        },
      },
      required: ["project_id", "prompt"],
    },
  },
};

const RESOURCE_DEFINITIONS = [
  { uri: "aca://brand-voices", name: "Brand Voices", description: "All brand voice configurations" },
  { uri: "aca://products", name: "Products", description: "All products with details" },
  { uri: "aca://icps", name: "ICPs", description: "All Ideal Customer Profiles" },
  { uri: "aca://characters", name: "Characters", description: "All AI characters/personas" },
  { uri: "aca://tags", name: "Tags", description: "All idea tags" },
  { uri: "aca://blueprints", name: "Blueprints", description: "All content blueprints" },
  { uri: "aca://prompt-templates", name: "Prompt Templates", description: "All prompt templates" },
  { uri: "aca://blocks", name: "Blocks", description: "All content blocks (hooks, angles, CTAs, story elements)" },
  { uri: "aca://strategy-documents", name: "Strategy Documents", description: "All strategy documents" },
  { uri: "aca://pipelines", name: "Pipelines", description: "Available content generation pipelines" },
  { uri: "aca://agent-profiles", name: "AI Agent Profiles", description: "All AI agent profiles (reusable autopilot configurations)" },
  { uri: "aca://knowledge-documents", name: "Knowledge Documents", description: "All knowledge base documents for RAG" },
  { uri: "aca://lead-magnet-campaigns", name: "Lead Magnet Campaigns", description: "All lead magnet campaigns with stats" },
  { uri: "aca://outreach-campaigns", name: "Outreach Campaigns", description: "All outreach campaigns (LinkedIn, email, multi-channel) with status and metrics" },
  { uri: "aca://email-sequences", name: "Email Sequences", description: "All email sequences with status and step count" },
  { uri: "aca://email-mailboxes", name: "Email Mailboxes", description: "All connected email mailboxes with status" },
  { uri: "aca://contacts", name: "CRM Contacts", description: "All CRM contacts (compact list with pagination)" },
  { uri: "aca://leads", name: "Email Leads", description: "All email leads for sequence enrollment" },
  { uri: "aca://crm-pipelines", name: "CRM Pipelines", description: "All CRM pipelines with their stages" },
  { uri: "aca://lead-lists", name: "Lead Lists", description: "All lead lists with names, counts, and types" },
  { uri: "aca://linkedin-connections", name: "LinkedIn Connections", description: "LinkedIn network connections (first 100)" },
];

// ── Video Editor helpers ────────────────────────────────────────────

/** Parse metadata comments and extract settings from Remotion code */
function parseRemotionCodeMeta(code: string) {
  const aspectMatch = code.match(/\/\/\s*@aspect\s+(portrait|landscape|square)/i);
  const durationMatch = code.match(/\/\/\s*@duration\s+(\d+)s/i);
  const fpsMatch = code.match(/\/\/\s*@fps\s+(\d+)/i);
  return {
    aspect_ratio: aspectMatch?.[1]?.toLowerCase() || "landscape",
    duration: durationMatch ? parseInt(durationMatch[1]) : undefined,
    fps: fpsMatch ? parseInt(fpsMatch[1]) : 30,
  };
}

/** Extract scenes from Remotion code for timeline/assets panel sync */
function extractScenesFromRemotionCode(code: string) {
  const meta = parseRemotionCodeMeta(code);
  const fps = meta.fps;
  const scenes: Array<Record<string, unknown>> = [];

  function resolveDuration(expr: string): number {
    const roundMatch = expr.match(/Math\.round\((.+)\)/);
    if (roundMatch) return resolveDuration(roundMatch[1]);
    const mathMatch = expr.match(/^([\d.]+)\s*\*\s*(\w+|\d+)$/);
    if (mathMatch) {
      const left = parseFloat(mathMatch[1]);
      const right = mathMatch[2] === "fps" ? fps : parseInt(mathMatch[2]);
      return (left * right) / fps;
    }
    const literalMatch = expr.match(/^(\d+)$/);
    if (literalMatch) return parseInt(literalMatch[1]) / fps;
    return 5;
  }

  function findComponentBody(componentName: string): string {
    const pattern = new RegExp(`const\\s+${componentName}\\s*=`);
    const startMatch = pattern.exec(code);
    if (!startMatch) return "";
    const startIdx = startMatch.index;
    // Find the next top-level const declaration or end of code as the boundary
    const nextConst = code.indexOf("\nconst ", startIdx + 10);
    const endIdx = nextConst > startIdx ? nextConst : Math.min(code.length, startIdx + 8000);
    return code.substring(startIdx, endIdx);
  }

  function extractImageUrl(body: string): { type: string; url: string; source: string } {
    // Check if this component uses Img or BgImage at all
    const usesImage = /<(?:Img|BgImage)\s/.test(body);
    if (!usesImage) return { type: "color", url: "#0a0a1a", source: "stock" };

    // 1. Direct string URL: src="https://..."
    const directMatch = body.match(/<(?:Img|BgImage)\s+[^>]*src=["']([^"']+)["']/);
    if (directMatch && directMatch[1].startsWith("http")) {
      return { type: "image", url: directMatch[1], source: "ai_image" };
    }

    // 2. Template literal: src={`${VAR}/path.ext`}
    const templateMatch = body.match(/<(?:Img|BgImage)\s+[^>]*src=\{`\$\{(\w+)\}\/([^`]+)`\}/);
    if (templateMatch) {
      const varName = templateMatch[1];
      const path = templateMatch[2];
      const varValMatch = code.match(new RegExp(`const\\s+${varName}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`));
      if (varValMatch) {
        return { type: "image", url: `${varValMatch[1]}/${path}`, source: "ai_image" };
      }
    }

    // 3. Object property: src={IMAGES.hook}
    const objMatch = body.match(/<(?:Img|BgImage)\s+[^>]*src=\{(\w+)\.(\w+)\}/);
    if (objMatch) {
      const key = objMatch[2];
      const valMatch = code.match(new RegExp(`${key}:\\s*['"\`]([^'"\`]+)['"\`]`));
      if (valMatch && valMatch[1].startsWith("http")) {
        return { type: "image", url: valMatch[1], source: "ai_image" };
      }
    }

    // 4. Fallback: find any http URL near Img/BgImage usage in the body
    const urlInBody = body.match(/(?:Img|BgImage)[^]*?['"`](https?:\/\/[^'"`\s]+)['"`]/);
    if (urlInBody) {
      return { type: "image", url: urlInBody[1], source: "ai_image" };
    }

    // 5. Resolve variable references: find any variable used as src and resolve it
    const varSrcMatch = body.match(/<(?:Img|BgImage)\s+[^>]*src=\{([A-Z_]\w*(?:\.\w+)?)\}/);
    if (varSrcMatch) {
      const ref = varSrcMatch[1];
      // Try OBJECT.key
      const parts = ref.split(".");
      if (parts.length === 2) {
        const valMatch = code.match(new RegExp(`${parts[1]}:\\s*['"\`]([^'"\`]+)['"\`]`));
        if (valMatch && valMatch[1].startsWith("http")) {
          return { type: "image", url: valMatch[1], source: "ai_image" };
        }
      }
      // Try direct const
      const constMatch = code.match(new RegExp(`const\\s+${ref}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`));
      if (constMatch && constMatch[1].startsWith("http")) {
        return { type: "image", url: constMatch[1], source: "ai_image" };
      }
    }

    // Has Img/BgImage but couldn't resolve URL - mark as image with placeholder
    return { type: "image", url: "#pending", source: "ai_image" };
  }

  // Parse TransitionSeries.Sequence blocks
  const tsRegex = /TransitionSeries\.Sequence\s+durationInFrames=\{([^}]+)\}[^>]*>\s*<(\w+)/g;
  let match;
  while ((match = tsRegex.exec(code)) !== null) {
    const duration = resolveDuration(match[1].trim());
    const componentName = match[2];
    let transition = scenes.length === 0 ? "none" : "fade";
    const beforeSeq = code.substring(0, match.index);
    const lastTransition = beforeSeq.match(/presentation=\{(fade|slide|wipe)\(\)/g);
    if (lastTransition) {
      const t = lastTransition[lastTransition.length - 1];
      if (t.includes("slide")) transition = "slide";
      else if (t.includes("wipe")) transition = "wipe";
    }

    const body = findComponentBody(componentName);
    const media = extractImageUrl(body);

    scenes.push({
      id: `scene_code_${scenes.length}_${Date.now()}`,
      order: scenes.length,
      duration,
      media,
      transition,
      text: { content: componentName.replace(/([A-Z])/g, " $1").trim(), position: "center", fontSize: 48, color: "#FFFFFF" },
    });
  }

  return { scenes, meta };
}

async function pushRemotionCode(
  supabase: SupabaseClient,
  ctx: AuthContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const code = args.code as string;
  const title = (args.title as string) || "Untitled Video";
  const projectId = args.project_id as string | undefined;

  if (!code?.trim()) throw new Error("code is required");

  // Extract scenes and metadata from the code
  const { scenes, meta } = extractScenesFromRemotionCode(code);

  const projectData: Record<string, unknown> = {
    organization_id: ctx.effectiveOrgId,
    user_id: ctx.userId,
    title,
    remotion_code: code,
    updated_at: new Date().toISOString(),
    settings: { aspect_ratio: meta.aspect_ratio, caption_style: "none" },
  };

  // Only set scenes if we successfully extracted them
  if (scenes.length > 0) {
    projectData.scenes = scenes;
  }

  if (projectId) {
    const { error } = await supabase
      .from("video_projects")
      .update(projectData)
      .eq("id", projectId)
      .eq("organization_id", ctx.effectiveOrgId);

    if (error) throw new Error(`Failed to update project: ${error.message}`);

    const imageCount = scenes.filter((s: Record<string, unknown>) => (s.media as Record<string, unknown>)?.type === "image").length;
    return {
      success: true,
      project_id: projectId,
      scenes_synced: scenes.length,
      images_detected: imageCount,
      aspect_ratio: meta.aspect_ratio,
      message: `Composition pushed to project "${title}". ${scenes.length} scenes synced (${imageCount} with images). Open the video editor to see it rendered.`,
    };
  } else {
    const { data, error } = await supabase
      .from("video_projects")
      .insert({ ...projectData, created_at: new Date().toISOString() })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create project: ${error.message}`);

    return {
      success: true,
      project_id: data.id,
      scenes_synced: scenes.length,
      aspect_ratio: meta.aspect_ratio,
      message: `New video project "${title}" created. Open /editor/${data.id} to preview it.`,
    };
  }
}

async function listVideoProjects(
  supabase: SupabaseClient,
  ctx: AuthContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const limit = (args.limit as number) || 20;

  const { data, error } = await supabase
    .from("video_projects")
    .select("id, title, created_at, updated_at")
    .eq("organization_id", ctx.effectiveOrgId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to list projects: ${error.message}`);

  return {
    projects: data || [],
    count: data?.length || 0,
  };
}

async function getVideoProject(
  supabase: SupabaseClient,
  ctx: AuthContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const projectId = args.project_id as string;
  if (!projectId) throw new Error("project_id is required");

  const { data, error } = await supabase
    .from("video_projects")
    .select("id, title, remotion_code, scenes, settings, created_at, updated_at")
    .eq("id", projectId)
    .eq("organization_id", ctx.effectiveOrgId)
    .single();

  if (error) throw new Error(`Failed to get project: ${error.message}`);

  return data;
}

async function setVideoSoundEffects(
  supabase: SupabaseClient,
  ctx: AuthContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const projectId = args.project_id as string;
  const soundEffects = args.sound_effects as Array<Record<string, unknown>>;
  if (!projectId) throw new Error("project_id is required");
  if (!soundEffects) throw new Error("sound_effects is required");

  const { error } = await supabase
    .from("video_projects")
    .update({ sound_effects: soundEffects, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("organization_id", ctx.effectiveOrgId);

  if (error) throw new Error(`Failed to set sound effects: ${error.message}`);

  return {
    success: true,
    project_id: projectId,
    sound_effects_count: soundEffects.length,
    message: `${soundEffects.length} sound effect(s) set on project. They will play at the specified timestamps in the editor.`,
  };
}

async function setVideoMusic(
  supabase: SupabaseClient,
  ctx: AuthContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const projectId = args.project_id as string;
  const url = args.url as string;
  if (!projectId) throw new Error("project_id is required");
  if (!url) throw new Error("url is required");

  const music = {
    url,
    title: (args.title as string) || "Background Music",
    volume: (args.volume as number) ?? 0.2,
    source: (args.source as string) || "external",
  };

  const { error } = await supabase
    .from("video_projects")
    .update({ music, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("organization_id", ctx.effectiveOrgId);

  if (error) throw new Error(`Failed to set music: ${error.message}`);

  return {
    success: true,
    project_id: projectId,
    music,
    message: `Background music "${music.title}" set at volume ${music.volume}.`,
  };
}

async function setVideoVoiceover(
  supabase: SupabaseClient,
  ctx: AuthContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const projectId = args.project_id as string;
  const url = args.url as string;
  if (!projectId) throw new Error("project_id is required");
  if (!url) throw new Error("url is required");

  const voiceover: Record<string, unknown> = {
    url,
    source: "external",
  };
  if (args.script) voiceover.script = args.script;
  if (args.voice_id) voiceover.voice_id = args.voice_id;
  if (args.word_timestamps) voiceover.word_timestamps = args.word_timestamps;

  const { error } = await supabase
    .from("video_projects")
    .update({ voiceover, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("organization_id", ctx.effectiveOrgId);

  if (error) throw new Error(`Failed to set voiceover: ${error.message}`);

  const hasTimestamps = Array.isArray(args.word_timestamps) && (args.word_timestamps as unknown[]).length > 0;
  return {
    success: true,
    project_id: projectId,
    has_word_timestamps: hasTimestamps,
    message: `Voiceover set on project.${hasTimestamps ? ` ${(args.word_timestamps as unknown[]).length} word timestamps attached for caption sync.` : ""}`,
  };
}

async function generateVideoTts(
  supabase: SupabaseClient,
  ctx: AuthContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const projectId = args.project_id as string;
  const text = args.text as string;
  const voiceId = args.voice_id as string | undefined;
  if (!projectId) throw new Error("project_id is required");
  if (!text?.trim()) throw new Error("text is required");

  // Verify project exists and belongs to org
  const { data: project, error: projectError } = await supabase
    .from("video_projects")
    .select("id, organization_id")
    .eq("id", projectId)
    .eq("organization_id", ctx.effectiveOrgId)
    .single();

  if (projectError || !project) throw new Error("Project not found or access denied");

  // Call the video-editor-tts edge function
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const ttsResponse = await fetch(`${supabaseUrl}/functions/v1/video-editor-tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      organization_id: ctx.effectiveOrgId,
      with_timestamps: true,
    }),
  });

  if (!ttsResponse.ok) {
    const errText = await ttsResponse.text();
    throw new Error(`TTS generation failed: ${errText}`);
  }

  const ttsResult = await ttsResponse.json();

  // Write voiceover to the project
  const voiceover = {
    url: ttsResult.audio_url,
    word_timestamps: ttsResult.word_timestamps || [],
    voice_id: voiceId || "default",
    source: "ai",
    script: text,
  };

  const { error: updateError } = await supabase
    .from("video_projects")
    .update({ voiceover, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("organization_id", ctx.effectiveOrgId);

  if (updateError) throw new Error(`TTS generated but failed to save: ${updateError.message}`);

  return {
    success: true,
    project_id: projectId,
    audio_url: ttsResult.audio_url,
    duration: ttsResult.duration,
    word_count: ttsResult.word_timestamps?.length || 0,
    message: `Voiceover generated (${ttsResult.duration}s, ${ttsResult.word_timestamps?.length || 0} words) and attached to project.`,
  };
}

async function generateVideoMusic(
  supabase: SupabaseClient,
  ctx: AuthContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const projectId = args.project_id as string;
  const prompt = args.prompt as string;
  const durationSeconds = (args.duration_seconds as number) || 30;
  const volume = (args.volume as number) ?? 0.2;
  if (!projectId) throw new Error("project_id is required");
  if (!prompt?.trim()) throw new Error("prompt is required");

  // Verify project exists and belongs to org
  const { data: project, error: projectError } = await supabase
    .from("video_projects")
    .select("id, organization_id")
    .eq("id", projectId)
    .eq("organization_id", ctx.effectiveOrgId)
    .single();

  if (projectError || !project) throw new Error("Project not found or access denied");

  // Call the generate-music edge function
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const musicResponse = await fetch(`${supabaseUrl}/functions/v1/generate-music`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      prompt,
      duration_ms: durationSeconds * 1000,
      organization_id: ctx.effectiveOrgId,
    }),
  });

  if (!musicResponse.ok) {
    const errText = await musicResponse.text();
    throw new Error(`Music generation failed: ${errText}`);
  }

  const musicResult = await musicResponse.json();

  // Write music to the project
  const music = {
    url: musicResult.audio_url,
    title: musicResult.title || prompt,
    volume,
    source: "ai",
    duration: musicResult.duration,
  };

  const { error: updateError } = await supabase
    .from("video_projects")
    .update({ music, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("organization_id", ctx.effectiveOrgId);

  if (updateError) throw new Error(`Music generated but failed to save: ${updateError.message}`);

  return {
    success: true,
    project_id: projectId,
    audio_url: musicResult.audio_url,
    duration: musicResult.duration,
    volume,
    message: `Background music generated (${musicResult.duration}s) and attached to project at volume ${volume}.`,
  };
}

async function handleMcpRequest(
  supabase: SupabaseClient,
  ctx: AuthContext,
  request: McpRequest
): Promise<McpResponse> {
  const { id, method, params } = request;

  try {
    let result: unknown;

    switch (method) {
      // MCP Protocol Methods
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            resources: {},
          },
          serverInfo: {
            name: "aca",
            version: "1.0.0",
          },
        };
        break;

      case "tools/list":
        result = {
          tools: Object.entries(TOOL_DEFINITIONS).map(([name, def]) => ({
            name,
            description: def.description,
            inputSchema: def.inputSchema,
          })),
        };
        break;

      case "tools/call":
        const toolName = (params as { name: string }).name;
        const toolArgs = (params as { arguments?: Record<string, unknown> }).arguments || {};

        switch (toolName) {
          // Help & Documentation
          case "get_help":
            result = getHelp(toolArgs);
            break;

          // Ideas
          case "list_ideas":
            result = await listIdeas(supabase, ctx, toolArgs);
            break;
          case "get_idea":
            result = await getIdea(supabase, ctx, toolArgs);
            break;
          case "create_idea":
            result = await createIdea(supabase, ctx, toolArgs);
            break;
          case "bulk_create_ideas":
            result = await bulkCreateIdeas(supabase, ctx, toolArgs);
            break;
          case "update_idea":
            result = await updateIdea(supabase, ctx, toolArgs);
            break;
          case "delete_ideas":
            result = await deleteIdeas(supabase, ctx, toolArgs);
            break;
          case "list_tags":
            result = await listTags(supabase, ctx);
            break;
          case "create_tag":
            result = await createTag(supabase, ctx, toolArgs);
            break;
          case "assign_tags":
            result = await assignTags(supabase, ctx, toolArgs);
            break;
          case "list_brand_voices":
            result = await listBrandVoices(supabase, ctx);
            break;
          case "create_brand_voice":
            result = await createBrandVoice(supabase, ctx, toolArgs);
            break;
          case "get_brand_voice":
            result = await getBrandVoice(supabase, ctx, toolArgs);
            break;
          case "update_brand_voice":
            result = await updateBrandVoice(supabase, ctx, toolArgs);
            break;
          case "delete_brand_voices":
            result = await deleteBrandVoices(supabase, ctx, toolArgs);
            break;
          case "list_products":
            result = await listProducts(supabase, ctx);
            break;
          case "create_product":
            result = await createProduct(supabase, ctx, toolArgs);
            break;
          case "get_product":
            result = await getProduct(supabase, ctx, toolArgs);
            break;
          case "update_product":
            result = await updateProduct(supabase, ctx, toolArgs);
            break;
          case "delete_products":
            result = await deleteProducts(supabase, ctx, toolArgs);
            break;
          case "list_icps":
            result = await listICPs(supabase, ctx);
            break;
          case "create_icp":
            result = await createICP(supabase, ctx, toolArgs);
            break;
          case "update_icp":
            result = await updateICP(supabase, ctx, toolArgs);
            break;
          case "delete_icps":
            result = await deleteICPs(supabase, ctx, toolArgs);
            break;
          // Character tools
          case "list_characters":
            result = await listCharacters(supabase, ctx);
            break;
          case "create_character":
            result = await createCharacter(supabase, ctx, toolArgs);
            break;
          case "get_character":
            result = await getCharacter(supabase, ctx, toolArgs);
            break;
          case "update_character":
            result = await updateCharacter(supabase, ctx, toolArgs);
            break;
          case "delete_characters":
            result = await deleteCharacters(supabase, ctx, toolArgs);
            break;
          // Pipeline & Model reference tools
          case "list_pipelines":
            result = listPipelines();
            break;
          case "list_available_models":
            result = await listAvailableModels(supabase, ctx, toolArgs);
            break;
          case "get_blueprint_schema":
            result = getBlueprintSchema();
            break;
          case "list_voices":
            result = await listVoices(supabase, ctx);
            break;
          case "list_blueprints":
            result = await listBlueprints(supabase, ctx, toolArgs);
            break;
          case "get_blueprint":
            result = await getBlueprint(supabase, ctx, toolArgs);
            break;
          case "create_blueprint":
            result = await createBlueprint(supabase, ctx, toolArgs);
            break;
          case "update_blueprint":
            result = await updateBlueprint(supabase, ctx, toolArgs);
            break;
          case "delete_blueprint":
            result = await deleteBlueprint(supabase, ctx, toolArgs);
            break;
          // Block tools
          case "list_blocks":
            result = await listBlocks(supabase, ctx, toolArgs);
            break;
          case "create_block":
            result = await createBlock(supabase, ctx, toolArgs);
            break;
          case "bulk_create_blocks":
            result = await bulkCreateBlocks(supabase, ctx, toolArgs);
            break;
          case "delete_blocks":
            result = await deleteBlocks(supabase, ctx, toolArgs);
            break;
          // Strategy Document tools
          case "list_strategy_documents":
            result = await listStrategyDocuments(supabase, ctx, toolArgs);
            break;
          case "get_strategy_document":
            result = await getStrategyDocument(supabase, ctx, toolArgs);
            break;
          case "create_strategy_document":
            result = await createStrategyDocument(supabase, ctx, toolArgs);
            break;
          case "update_strategy_document":
            result = await updateStrategyDocument(supabase, ctx, toolArgs);
            break;
          case "delete_strategy_documents":
            result = await deleteStrategyDocuments(supabase, ctx, toolArgs);
            break;
          // Fit Scoring tools
          case "set_product_icp_fit":
            result = await setProductICPFit(supabase, ctx, toolArgs);
            break;
          case "get_suggested_icps":
            result = await getSuggestedICPs(supabase, ctx, toolArgs);
            break;
          case "list_contact_product_scores":
            result = await listContactProductScores(supabase, ctx, toolArgs);
            break;
          case "set_contact_product_score":
            result = await setContactProductScore(supabase, ctx, toolArgs);
            break;
          case "list_prompt_templates":
            result = await listPromptTemplates(supabase, ctx, toolArgs);
            break;
          case "create_prompt_template":
            result = await createPromptTemplate(supabase, ctx, toolArgs);
            break;
          case "get_prompt_template":
            result = await getPromptTemplate(supabase, ctx, toolArgs);
            break;
          // Content Generation tools
          case "trigger_content_generation":
            result = await triggerContentGeneration(supabase, ctx, toolArgs);
            break;
          case "create_carousel":
            result = await createCarousel(supabase, ctx, toolArgs);
            break;
          case "list_generation_jobs":
            result = await listGenerationJobs(supabase, ctx, toolArgs);
            break;
          case "get_generation_job":
            result = await getGenerationJob(supabase, ctx, toolArgs);
            break;
          // Autopilot tools
          case "list_autopilots":
            result = await listAutopilots(supabase, ctx, toolArgs);
            break;
          case "get_autopilot":
            result = await getAutopilot(supabase, ctx, toolArgs);
            break;
          case "trigger_autopilot":
            result = await triggerAutopilot(supabase, ctx, toolArgs);
            break;
          case "create_autopilot":
            result = await createAutopilot(supabase, ctx, toolArgs);
            break;
          case "update_autopilot":
            result = await updateAutopilot(supabase, ctx, toolArgs);
            break;
          case "delete_autopilot":
            result = await deleteAutopilot(supabase, ctx, toolArgs);
            break;
          case "toggle_autopilot_status":
            result = await toggleAutopilotStatus(supabase, ctx, toolArgs);
            break;
          case "list_publishing_accounts":
            result = await listPublishingAccounts(supabase, ctx, toolArgs);
            break;
          case "sync_autopilot_pool":
            result = await syncAutopilotPool(supabase, ctx, toolArgs);
            break;
          case "add_ideas_to_pool":
            result = await addIdeasToPool(supabase, ctx, toolArgs);
            break;
          case "list_pool_entries":
            result = await listPoolEntries(supabase, ctx, toolArgs);
            break;
          case "recycle_autopilot_pool":
            result = await recycleAutopilotPool(supabase, ctx, toolArgs);
            break;
          // GHL (LeadConnector) Publishing
          case "list_ghl_accounts":
            result = await listGHLAccounts(supabase, ctx, toolArgs);
            break;
          case "push_to_ghl":
            result = await pushToGHL(supabase, ctx, toolArgs);
            break;
          case "list_accessible_organizations":
            result = await listAccessibleOrganizations(supabase, ctx);
            break;
          case "switch_organization":
            result = await switchOrganization(supabase, ctx, toolArgs);
            break;
          // AI Agent Profiles
          case "list_agent_profiles":
            result = await listAgentProfiles(supabase, ctx);
            break;
          case "get_agent_profile":
            result = await getAgentProfile(supabase, ctx, toolArgs);
            break;
          case "create_agent_profile":
            result = await createAgentProfile(supabase, ctx, toolArgs);
            break;
          case "update_agent_profile":
            result = await updateAgentProfile(supabase, ctx, toolArgs);
            break;
          case "delete_agent_profiles":
            result = await deleteAgentProfiles(supabase, ctx, toolArgs);
            break;
          case "set_default_agent_profile":
            result = await setDefaultAgentProfile(supabase, ctx, toolArgs);
            break;
          // Knowledge Base Documents
          case "list_knowledge_documents":
            result = await listKnowledgeDocuments(supabase, ctx, toolArgs);
            break;
          case "get_knowledge_document":
            result = await getKnowledgeDocument(supabase, ctx, toolArgs);
            break;
          case "create_knowledge_document":
            result = await createKnowledgeDocument(supabase, ctx, toolArgs);
            break;
          case "delete_knowledge_documents":
            result = await deleteKnowledgeDocuments(supabase, ctx, toolArgs);
            break;
          // Lead Magnet Campaigns
          case "list_lead_magnet_campaigns":
            result = await listLeadMagnetCampaigns(supabase, ctx);
            break;
          case "get_lead_magnet_campaign":
            result = await getLeadMagnetCampaign(supabase, ctx, toolArgs);
            break;
          case "create_lead_magnet_campaign":
            result = await createLeadMagnetCampaign(supabase, ctx, toolArgs);
            break;
          case "update_lead_magnet_campaign":
            result = await updateLeadMagnetCampaign(supabase, ctx, toolArgs);
            break;
          case "delete_lead_magnet_campaign":
            result = await deleteLeadMagnetCampaign(supabase, ctx, toolArgs);
            break;
          case "toggle_lead_magnet_campaign":
            result = await toggleLeadMagnetCampaign(supabase, ctx, toolArgs);
            break;
          case "list_campaign_leads":
            result = await listCampaignLeads(supabase, ctx, toolArgs);
            break;
          case "list_email_sequences":
            result = await listEmailSequences(supabase, ctx, toolArgs);
            break;
          case "get_email_sequence":
            result = await getEmailSequence(supabase, ctx, toolArgs);
            break;
          case "create_email_sequence":
            result = await createEmailSequence(supabase, ctx, toolArgs);
            break;
          case "update_email_sequence":
            result = await updateEmailSequence(supabase, ctx, toolArgs);
            break;
          case "duplicate_email_sequence":
            result = await duplicateEmailSequence(supabase, ctx, toolArgs);
            break;
          case "delete_email_sequence":
            result = await deleteEmailSequence(supabase, ctx, toolArgs);
            break;
          case "toggle_email_sequence":
            result = await toggleEmailSequence(supabase, ctx, toolArgs);
            break;
          case "list_email_enrollments":
            result = await listEmailEnrollments(supabase, ctx, toolArgs);
            break;
          case "enroll_leads":
            result = await enrollLeads(supabase, ctx, toolArgs);
            break;
          case "update_enrollment_status":
            result = await updateEnrollmentStatus(supabase, ctx, toolArgs);
            break;
          case "list_conversations":
            result = await listConversations(supabase, ctx, toolArgs);
            break;
          case "get_conversation":
            result = await getConversation(supabase, ctx, toolArgs);
            break;
          case "send_conversation_reply":
            result = await sendConversationReply(supabase, ctx, toolArgs);
            break;
          case "list_email_mailboxes":
            result = await listEmailMailboxes(supabase, ctx, toolArgs);
            break;
          case "list_contacts":
            result = await listContacts(supabase, ctx, toolArgs);
            break;
          case "get_contact":
            result = await getContact(supabase, ctx, toolArgs);
            break;
          case "create_contact":
            result = await createContact(supabase, ctx, toolArgs);
            break;
          case "push_public_signal":
            result = await pushPublicSignal(supabase, ctx, toolArgs);
            break;
          case "update_contact":
            result = await updateContact(supabase, ctx, toolArgs);
            break;
          case "delete_contacts":
            result = await deleteContacts(supabase, ctx, toolArgs);
            break;
          case "bulk_update_contacts":
            result = await bulkUpdateContacts(supabase, ctx, toolArgs);
            break;
          case "add_contact_tag":
            result = await addContactTag(supabase, ctx, toolArgs);
            break;
          case "remove_contact_tag":
            result = await removeContactTag(supabase, ctx, toolArgs);
            break;
          case "list_crm_pipelines":
            result = await listCrmPipelines(supabase, ctx);
            break;
          case "add_contact_note":
            result = await addContactNote(supabase, ctx, toolArgs);
            break;
          case "list_leads":
            result = await listLeads(supabase, ctx, toolArgs);
            break;
          case "get_lead":
            result = await getLead(supabase, ctx, toolArgs);
            break;
          case "create_lead":
            result = await createLead(supabase, ctx, toolArgs);
            break;
          case "bulk_create_leads":
            result = await bulkCreateLeads(supabase, ctx, toolArgs);
            break;
          case "bulk_create_contacts":
            result = await bulkCreateContacts(supabase, ctx, toolArgs);
            break;
          case "search_contacts_and_leads":
            result = await searchContactsAndLeads(supabase, ctx, toolArgs);
            break;
          case "list_lead_lists":
            result = await listLeadLists(supabase, ctx, toolArgs);
            break;
          case "get_lead_list":
            result = await getLeadList(supabase, ctx, toolArgs);
            break;
          case "create_lead_list":
            result = await createLeadList(supabase, ctx, toolArgs);
            break;
          case "update_lead_list":
            result = await updateLeadList(supabase, ctx, toolArgs);
            break;
          case "delete_lead_list":
            result = await deleteLeadList(supabase, ctx, toolArgs);
            break;
          case "add_contacts_to_list":
            result = await addContactsToList(supabase, ctx, toolArgs);
            break;
          case "remove_contacts_from_list":
            result = await removeContactsFromList(supabase, ctx, toolArgs);
            break;
          case "get_lead_processing_setup":
            result = await getLeadProcessingSetup(supabase, ctx, toolArgs);
            break;
          case "configure_lead_processing_setup":
            result = await configureLeadProcessingSetup(supabase, ctx, toolArgs);
            break;
          case "list_linkedin_connections":
            result = await listLinkedInConnections(supabase, ctx, toolArgs);
            break;
          case "get_linkedin_connection":
            result = await getLinkedInConnection(supabase, ctx, toolArgs);
            break;
          // LinkedIn Lead Import
          case "search_linkedin_parameters":
            result = await searchLinkedInParameters(supabase, ctx, toolArgs);
            break;
          case "build_linkedin_search_url":
            result = buildLinkedInSearchUrl(toolArgs);
            break;
          case "start_linkedin_import":
            result = await startLinkedInImport(supabase, ctx, toolArgs);
            break;
          case "get_linkedin_import_job":
            result = await getLinkedInImportJob(supabase, ctx, toolArgs);
            break;
          case "list_linkedin_import_jobs":
            result = await listLinkedInImportJobs(supabase, ctx, toolArgs);
            break;
          case "cancel_linkedin_import":
            result = await cancelLinkedInImport(supabase, ctx, toolArgs);
            break;
          // Apify B2B Lead Finder
          case "start_apify_leads_import":
            result = await startApifyLeadsImport(supabase, ctx, toolArgs);
            break;
          case "get_apify_leads_import_job":
            result = await getApifyLeadsImportJob(supabase, ctx, toolArgs);
            break;
          case "list_apify_leads_import_jobs":
            result = await listApifyLeadsImportJobs(supabase, ctx, toolArgs);
            break;
          case "cancel_apify_leads_import":
            result = await cancelApifyLeadsImport(supabase, ctx, toolArgs);
            break;
          case "search_lead_pool":
            result = await searchLeadPool(supabase, ctx, toolArgs);
            break;
          case "build_lead_pool_list":
            result = await buildLeadPoolList(supabase, ctx, toolArgs);
            break;
          case "get_lead_pool_build_job":
            result = await getLeadPoolBuildJob(supabase, ctx, toolArgs);
            break;
          // Outreach Campaigns
          case "list_sender_accounts":
            result = await listSenderAccounts(supabase, ctx, toolArgs);
            break;
          case "list_campaigns":
            result = await listCampaigns(supabase, ctx, toolArgs);
            break;
          case "list_messaging_senders":
            result = await listMessagingSenders(supabase, ctx, toolArgs);
            break;
          case "list_whatsapp_templates":
            result = await listWhatsAppTemplates(supabase, ctx, toolArgs);
            break;
          case "get_messaging_funnel":
            result = await getMessagingFunnel(supabase, ctx, toolArgs);
            break;
          case "create_dbr_campaign":
            result = await createDbrCampaign(supabase, ctx, toolArgs);
            break;
          case "get_campaign":
            result = await getCampaign(supabase, ctx, toolArgs);
            break;
          case "create_campaign":
            result = await createCampaign(supabase, ctx, toolArgs);
            break;
          case "update_campaign":
            result = await updateCampaign(supabase, ctx, toolArgs);
            break;
          case "update_campaign_status":
            result = await updateCampaignStatus(supabase, ctx, toolArgs);
            break;
          case "delete_campaigns":
            result = await deleteCampaigns(supabase, ctx, toolArgs);
            break;

          // ── Video Editor ────────────────────────────────────────
          case "push_remotion_code":
            result = await pushRemotionCode(supabase, ctx, toolArgs);
            break;
          case "list_video_projects":
            result = await listVideoProjects(supabase, ctx, toolArgs);
            break;
          case "get_video_project":
            result = await getVideoProject(supabase, ctx, toolArgs);
            break;
          case "set_video_sound_effects":
            result = await setVideoSoundEffects(supabase, ctx, toolArgs);
            break;
          case "set_video_music":
            result = await setVideoMusic(supabase, ctx, toolArgs);
            break;
          case "set_video_voiceover":
            result = await setVideoVoiceover(supabase, ctx, toolArgs);
            break;
          case "generate_video_tts":
            result = await generateVideoTts(supabase, ctx, toolArgs);
            break;
          case "generate_video_music":
            result = await generateVideoMusic(supabase, ctx, toolArgs);
            break;

          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }

        result = {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
        break;

      case "resources/list":
        result = { resources: RESOURCE_DEFINITIONS };
        break;

      case "resources/read":
        const resourceUri = (params as { uri: string }).uri;
        const resourceData = await getResource(supabase, ctx, resourceUri);
        result = {
          contents: [
            {
              uri: resourceUri,
              mimeType: "application/json",
              text: JSON.stringify(resourceData, null, 2),
            },
          ],
        };
        break;

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }

    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    console.error(`[MCP] Error handling ${method}:`, error);
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}

// ============================================================================
// Main Server
// ============================================================================

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Extract API key from header OR query param (for Claude Cloud compatibility)
  const url = new URL(req.url);
  const authHeader = req.headers.get("Authorization");
  const apiKeyFromHeader = authHeader?.replace("Bearer ", "");
  const apiKeyFromQuery = url.searchParams.get("api_key");
  const apiKey = apiKeyFromHeader || apiKeyFromQuery;

  // Handle GET requests (Streamable HTTP SSE transport used by Claude Cloud)
  if (req.method === "GET") {
    // Unauthenticated GET = health check (used by MCP registries/crawlers)
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          name: "ACA MCP Server",
          status: "ok",
          auth: "required",
          docs: "https://screenshotperfect.com/mcp",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase and validate key for GET as well
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const targetOrgHeader = req.headers.get("X-Target-Organization");
    const authContext = await validateApiKey(supabase, apiKey, targetOrgHeader);

    if (!authContext) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[MCP] SSE GET authenticated: org=${authContext.organizationId}`);

    // Return an SSE stream that stays open for server-initiated messages.
    // For a stateless edge function we send an initial endpoint event then close,
    // which tells the client to use POST for all further requests.
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        // Send a comment to keep the connection alive briefly
        controller.enqueue(encoder.encode(": ok\n\n"));
        // Close the stream — the client will fall back to POST-only mode
        controller.close();
      },
    });

    return new Response(body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // Handle DELETE requests (session termination in Streamable HTTP)
  if (req.method === "DELETE") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Only POST allowed beyond this point
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "API key required. Use ?api_key=cf_live_xxx or Authorization: Bearer cf_live_xxx" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Initialize Supabase
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get optional target organization header (for agency users)
  const targetOrgHeader = req.headers.get("X-Target-Organization");

  // Validate API key
  const authContext = await validateApiKey(supabase, apiKey, targetOrgHeader);
  if (!authContext) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired API key" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  console.log(`[MCP] Authenticated: org=${authContext.organizationId}, isAgency=${authContext.isAgency}, target=${authContext.targetOrganizationId || "none"}`);

  try {
    const mcpRequest = await req.json() as McpRequest;
    const mcpResponse = await handleMcpRequest(supabase, authContext, mcpRequest);

    return new Response(JSON.stringify(mcpResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[MCP] Request error:", error);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
        },
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
