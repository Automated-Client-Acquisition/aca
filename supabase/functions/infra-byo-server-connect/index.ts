/**
 * BYO Server Connect — Step 1 of the wizard.
 *
 * Inserts a byo_servers row, generates a fresh Ed25519 SSH keypair, encrypts
 * the private half, returns the public key + the one-line install command for
 * the user to paste into ~/.ssh/authorized_keys on their server.
 *
 * Status after this call: 'pending'. The user runs the install command, then
 * calls infra-byo-server-validate which enqueues a 'connect' job for the
 * deployer to actually SSH in and verify.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { encryptValue } from '../_shared/encryption.ts';
import { generateByoKeypair } from '../_shared/byo/ssh-keypair.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface ConnectBody {
  organization_id: string;
  name: string;
  hostname: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_username?: string;
  provider_hint?: string;
}

const VALID_PROVIDER_HINTS = new Set([
  'hetzner', 'ovh', 'ionos', 'contabo', 'vultr', 'linode', 'webdock',
  'digitalocean', 'aws', 'gcp', 'azure', 'other',
]);

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,253}[a-zA-Z0-9])?$/;

function generateAgentSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: ConnectBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const {
    organization_id,
    name,
    hostname,
    ssh_host,
    ssh_port = 22,
    ssh_username = 'root',
    provider_hint,
  } = body;

  if (!organization_id) return jsonResponse({ success: false, error: 'organization_id is required' }, 400);
  if (!name?.trim()) return jsonResponse({ success: false, error: 'name is required' }, 400);
  if (!hostname?.trim()) return jsonResponse({ success: false, error: 'hostname is required' }, 400);

  const normalizedHostname = hostname.trim().toLowerCase();
  if (!HOSTNAME_RE.test(normalizedHostname)) {
    return jsonResponse({ success: false, error: 'hostname must be a valid FQDN or IP' }, 400);
  }
  if (!Number.isInteger(ssh_port) || ssh_port < 1 || ssh_port > 65535) {
    return jsonResponse({ success: false, error: 'ssh_port must be 1-65535' }, 400);
  }
  if (provider_hint && !VALID_PROVIDER_HINTS.has(provider_hint)) {
    return jsonResponse({ success: false, error: 'invalid provider_hint' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ success: false, error: 'Server is not configured' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Auth check: ensure caller belongs to organization_id.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ success: false, error: 'Missing Authorization header' }, 401);
  }
  const { data: userRes, error: userErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

  const { data: membership, error: memErr } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', organization_id)
    .eq('user_id', userRes.user.id)
    .maybeSingle();
  if (memErr || !membership) {
    return jsonResponse({ success: false, error: 'Forbidden: not a member of this organization' }, 403);
  }

  // Generate keypair + agent secret.
  let keypair;
  try {
    keypair = await generateByoKeypair(`aca-${name.replace(/\s+/g, '-').toLowerCase()}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'keygen failed';
    return jsonResponse({ success: false, error: `Failed to generate SSH keypair: ${msg}` }, 500);
  }

  const agentSecret = generateAgentSecret();
  const [encryptedPrivate, encryptedAgent] = await Promise.all([
    encryptValue(keypair.privateKeyPem),
    encryptValue(agentSecret),
  ]);

  const { data: server, error: insertErr } = await supabase
    .from('byo_servers')
    .insert({
      organization_id,
      name: name.trim(),
      hostname: normalizedHostname,
      ssh_host: (ssh_host || normalizedHostname).trim().toLowerCase(),
      ssh_port,
      ssh_username,
      ssh_private_key_encrypted: encryptedPrivate,
      ssh_public_key: keypair.publicKey,
      ssh_fingerprint: keypair.fingerprint,
      agent_secret_encrypted: encryptedAgent,
      provider_hint: provider_hint ?? null,
      status: 'pending',
    })
    .select('id, name, hostname, ssh_host, ssh_port, ssh_username, ssh_public_key, ssh_fingerprint, status, created_at')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return jsonResponse({ success: false, error: 'A server with that hostname already exists in this organization' }, 409);
    }
    return jsonResponse({ success: false, error: `Failed to create server: ${insertErr.message}` }, 500);
  }

  const installCommand =
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && ` +
    `echo '${keypair.publicKey}' >> ~/.ssh/authorized_keys && ` +
    `chmod 600 ~/.ssh/authorized_keys`;

  return jsonResponse({
    success: true,
    server,
    public_key: keypair.publicKey,
    fingerprint: keypair.fingerprint,
    install_command: installCommand,
  });
});
