/**
 * Shared secret for calls from edge functions to the Fly job workers
 * (aca-company-analyzer, aca-email-sequence-generator, aca-notion-generator).
 * Their job endpoints used to accept anyone who knew the worker URL and a job id.
 *
 * The secret is derived from the service-role key (HMAC with a fixed label), which the
 * edge functions and the workers already hold: no new secret has to be stored on either
 * side (the project is at Supabase's 100-secret cap) and the raw key never goes over
 * the wire. The workers compute the same value in isAuthorizedWorkerCall().
 */
export const FLY_WORKER_AUTH_HEADER = 'X-Aca-Worker-Auth';

async function workerSecret(): Promise<string | null> {
  const base = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(base), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('aca-fly-worker-v1'));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function flyWorkerAuthHeaders(): Promise<Record<string, string>> {
  const secret = await workerSecret();
  return secret ? { [FLY_WORKER_AUTH_HEADER]: secret } : {};
}
