/**
 * Job dispatcher.
 *
 * Routes infra_byo_jobs.job_type to the right handler. Each handler receives
 * the org_id, target_id, and a log function that flushes lines into
 * infra_byo_jobs.log so the frontend can stream progress via Realtime.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { runConnectJob } from './connect.js';
import { runDeployBaseJob } from './deploy-base.js';
import { runProvisionDomainJob } from './provision-domain.js';
import { runProvisionMailboxJob } from './provision-mailbox.js';
import { runAttachIpJob } from './attach-ip.js';
import { runDetachIpJob } from './detach-ip.js';
import { runDeprovisionDomainJob } from './deprovision-domain.js';
import { runDeprovisionMailboxJob } from './deprovision-mailbox.js';
import { runInstallTlsJob } from './install-tls.js';
import { runTestPort25Job } from './test-port25.js';

export type JobLogFn = (line: string) => Promise<void>;

export interface DispatchInput {
  job_id: string;
  job_type: string;
  organization_id: string;
  target_kind: string;
  target_id: string | null;
  input: Record<string, unknown>;
}

export interface DispatchResult {
  ok: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export async function dispatchJob(
  supabase: SupabaseClient,
  job: DispatchInput,
  log: JobLogFn,
): Promise<DispatchResult> {
  switch (job.job_type) {
    case 'connect': {
      if (!job.target_id) return { ok: false, error: 'connect job requires target_id' };
      const r = await runConnectJob(
        supabase,
        { organization_id: job.organization_id, target_id: job.target_id },
        log,
      );
      return r.ok
        ? { ok: true, output: { ...r } }
        : { ok: false, error: r.message ?? 'connect job failed', output: { ...r } };
    }
    case 'deploy_base': {
      if (!job.target_id) return { ok: false, error: 'deploy_base job requires target_id' };
      const r = await runDeployBaseJob(
        supabase,
        {
          organization_id: job.organization_id,
          target_id: job.target_id,
          admin_email: (job.input?.admin_email as string | undefined) ?? null,
        },
        log,
      );
      return r.ok
        ? { ok: true, output: { ...r } }
        : { ok: false, error: r.message ?? 'deploy_base failed', output: { ...r } };
    }
    case 'provision_domain': {
      if (!job.target_id) return { ok: false, error: 'provision_domain job requires target_id' };
      const r = await runProvisionDomainJob(
        supabase,
        { organization_id: job.organization_id, target_id: job.target_id },
        log,
      );
      return r.ok
        ? { ok: true, output: { domain: r.domain, dkim_selector: r.dkim_selector, dns_records: r.dns_records } }
        : { ok: false, error: r.message ?? 'provision_domain failed' };
    }
    case 'provision_mailbox': {
      if (!job.target_id) return { ok: false, error: 'provision_mailbox job requires target_id' };
      const r = await runProvisionMailboxJob(
        supabase,
        {
          organization_id: job.organization_id,
          target_id: job.target_id,
          sticky_ip_id: job.input?.sticky_ip_id as string | undefined,
          sticky_ip_address: job.input?.sticky_ip_address as string | undefined,
        },
        log,
      );
      return r.ok
        ? { ok: true, output: { mailbox_id: r.mailbox_id, email_address: r.email_address } }
        : { ok: false, error: r.message ?? 'provision_mailbox failed' };
    }
    case 'attach_ip': {
      if (!job.target_id) return { ok: false, error: 'attach_ip job requires target_id' };
      const r = await runAttachIpJob(
        supabase,
        { organization_id: job.organization_id, target_id: job.target_id },
        log,
      );
      return r.ok
        ? { ok: true, output: { ip_address: r.ip_address, transport_name: r.transport_name, helo_name: r.helo_name } }
        : { ok: false, error: r.message ?? 'attach_ip failed' };
    }
    case 'detach_ip': {
      if (!job.target_id) return { ok: false, error: 'detach_ip job requires target_id' };
      const r = await runDetachIpJob(
        supabase,
        { organization_id: job.organization_id, target_id: job.target_id },
        log,
      );
      return r.ok
        ? { ok: true, output: { ip_address: r.ip_address } }
        : { ok: false, error: r.message ?? 'detach_ip failed' };
    }
    case 'deprovision_domain': {
      if (!job.target_id) return { ok: false, error: 'deprovision_domain job requires target_id' };
      const r = await runDeprovisionDomainJob(
        supabase,
        {
          organization_id: job.organization_id,
          target_id: job.target_id,
          delete_keys: !!job.input?.delete_keys,
        },
        log,
      );
      return r.ok
        ? { ok: true, output: { domain: r.domain } }
        : { ok: false, error: r.message ?? 'deprovision_domain failed' };
    }
    case 'deprovision_mailbox': {
      if (!job.target_id) return { ok: false, error: 'deprovision_mailbox job requires target_id' };
      const r = await runDeprovisionMailboxJob(
        supabase,
        {
          organization_id: job.organization_id,
          target_id: job.target_id,
          delete_maildir: !!job.input?.delete_maildir,
        },
        log,
      );
      return r.ok
        ? { ok: true, output: { email_address: r.email_address } }
        : { ok: false, error: r.message ?? 'deprovision_mailbox failed' };
    }
    case 'install_tls': {
      if (!job.target_id) return { ok: false, error: 'install_tls job requires target_id' };
      const adminEmail = job.input?.admin_email as string | undefined;
      if (!adminEmail) return { ok: false, error: 'admin_email required in input' };
      const r = await runInstallTlsJob(
        supabase,
        { organization_id: job.organization_id, target_id: job.target_id, admin_email: adminEmail },
        log,
      );
      return r.ok
        ? { ok: true, output: { helo: r.helo, not_after: r.not_after, issuer: r.issuer } }
        : { ok: false, error: r.message ?? 'install_tls failed' };
    }
    case 'test_port25': {
      if (!job.target_id) return { ok: false, error: 'test_port25 job requires target_id' };
      const r = await runTestPort25Job(
        supabase,
        { organization_id: job.organization_id, target_id: job.target_id },
        log,
      );
      return r.ok
        ? { ok: true, output: { port25_verified: r.port25_verified, banner: r.banner } }
        : { ok: false, error: r.message ?? 'test_port25 failed', output: { port25_verified: r.port25_verified } };
    }
    // Remaining stubs. verify_dns is intentionally one: DNS verification runs
    // over DoH in the infra-byo-domain-verify edge function, with no SSH needed.
    case 'verify_dns':
    case 'rotate_ssh_key':
    case 'deprovision_server':
      await log(`[dispatcher] job type "${job.job_type}" is not implemented yet`);
      return { ok: false, error: `job_type "${job.job_type}" not implemented` };
    default:
      return { ok: false, error: `unknown job_type: ${job.job_type}` };
  }
}
