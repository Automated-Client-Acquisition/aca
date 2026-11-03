/**
 * BYO Job Enqueue Helper
 *
 * Inserts a row into infra_byo_jobs. The AFTER INSERT trigger fires
 * pg_notify('infra_byo_job_created'), which the Fly.io deployer service is
 * LISTENing on. The deployer claims the job via an atomic UPDATE on locked_until.
 *
 * For urgent jobs we ALSO post to the deployer's HMAC-protected /jobs/run-now
 * endpoint to wake it without waiting for the next NOTIFY round-trip — useful
 * when the deployer just reconnected or is otherwise idle.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export type SupabaseServiceClient = SupabaseClient<any>;

export interface EnqueueByoJobInput {
  organization_id: string;
  job_type:
    | 'connect'
    | 'deploy_base'
    | 'provision_domain'
    | 'provision_mailbox'
    | 'attach_ip'
    | 'detach_ip'
    | 'verify_dns'
    | 'test_port25'
    | 'rotate_ssh_key'
    | 'install_tls'
    | 'deprovision_mailbox'
    | 'deprovision_domain'
    | 'deprovision_server';
  target_kind: 'server' | 'domain' | 'mailbox' | 'ip';
  target_id: string | null;
  input?: Record<string, unknown>;
  max_attempts?: number;
  created_by?: string | null;
}

export interface EnqueueByoJobResult {
  job_id: string;
}

/**
 * Insert a job row. Returns the inserted job's id.
 */
export async function enqueueByoJob(
  supabase: SupabaseServiceClient,
  input: EnqueueByoJobInput,
): Promise<EnqueueByoJobResult> {
  const { data, error } = await supabase
    .from('infra_byo_jobs')
    .insert({
      organization_id: input.organization_id,
      job_type: input.job_type,
      target_kind: input.target_kind,
      target_id: input.target_id,
      input: input.input ?? {},
      max_attempts: input.max_attempts ?? 3,
      status: 'pending',
      created_by: input.created_by ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`enqueueByoJob: ${error.message}`);
  return { job_id: (data as { id: string }).id };
}

/**
 * Optional: nudge the deployer to wake immediately on top of the pg_notify path.
 * Silently no-ops if BYO_DEPLOYER_URL or BYO_DEPLOYER_TRIGGER_SECRET are unset
 * (e.g. local dev without a deployer running).
 */
export async function pingByoDeployer(jobId: string): Promise<void> {
  const url = Deno.env.get('BYO_DEPLOYER_URL');
  const secret = Deno.env.get('BYO_DEPLOYER_TRIGGER_SECRET');
  if (!url || !secret) return;

  const body = JSON.stringify({ job_id: jobId, ts: Date.now() });
  const signature = await hmacHexSha256(secret, body);

  try {
    await fetch(`${url.replace(/\/+$/, '')}/jobs/run-now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ACA-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Best-effort. The job will still be picked up on the next NOTIFY or poll.
  }
}

async function hmacHexSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
