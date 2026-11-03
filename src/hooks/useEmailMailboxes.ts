import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { EmailMailbox, MailboxStatus } from "@/types/email";
import { isStillWarming } from "@/lib/mailbox-status";

// ============================================================================
// Queries
// ============================================================================

export function useEmailMailboxes() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-mailboxes", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      // PostgREST caps responses at 1000 rows by default. Drive the loop off
      // the exact count returned with the first page so a short final batch
      // can't be mistaken for "we got everything" before we actually have.
      const PAGE_SIZE = 1000;
      const MAX_PAGES = 50;
      const all: EmailMailbox[] = [];

      const first = await supabase
        .from("email_mailboxes")
        .select("*", { count: "exact" })
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (first.error) throw first.error;
      all.push(...((first.data || []) as unknown as EmailMailbox[]));
      const total = first.count ?? all.length;

      let pages = 1;
      while (all.length < total && pages < MAX_PAGES) {
        const from = all.length;
        const { data, error } = await supabase
          .from("email_mailboxes")
          .select("*")
          .eq("organization_id", currentOrganization.id)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        const batch = (data || []) as unknown as EmailMailbox[];
        if (batch.length === 0) {
          console.warn(
            `[useEmailMailboxes] Pagination stalled at ${all.length}/${total} rows`,
          );
          break;
        }
        all.push(...batch);
        pages += 1;
      }

      return all;
    },
    enabled: !!currentOrganization,
  });
}

export function useEmailMailbox(id: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-mailboxes", currentOrganization?.id, id],
    queryFn: async () => {
      if (!id || !currentOrganization) return null;

      const { data, error } = await supabase
        .from("email_mailboxes")
        .select("*")
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .single();

      if (error) throw error;
      return data as unknown as EmailMailbox;
    },
    enabled: !!id && !!currentOrganization,
  });
}

export function useEmailMailboxStats() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-mailbox-stats", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) {
        return { total: 0, ready: 0, readySending: 0, warming: 0, paused: 0, burned: 0, disconnected: 0 };
      }

      // PostgREST caps responses at 1000 rows by default. Drive the loop off
      // the exact count returned with the first page so a short final batch
      // can't be mistaken for "we got everything" before we actually have.
      const PAGE_SIZE = 1000;
      const MAX_PAGES = 50;
      type StatusRow = Pick<EmailMailbox, "status" | "warmup_enabled" | "warmup_day" | "health_score">;
      const statuses: StatusRow[] = [];
      const columns = "status, warmup_enabled, warmup_day, health_score";

      const first = await supabase
        .from("email_mailboxes")
        .select(columns, { count: "exact" })
        .eq("organization_id", currentOrganization.id)
        .range(0, PAGE_SIZE - 1);

      if (first.error) throw first.error;
      statuses.push(...((first.data || []) as unknown as StatusRow[]));
      const total = first.count ?? statuses.length;

      let pages = 1;
      while (statuses.length < total && pages < MAX_PAGES) {
        const from = statuses.length;
        const { data, error } = await supabase
          .from("email_mailboxes")
          .select(columns)
          .eq("organization_id", currentOrganization.id)
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        const batch = (data || []) as unknown as StatusRow[];
        if (batch.length === 0) break;
        statuses.push(...batch);
        pages += 1;
      }

      return {
        total: statuses.length,
        ready: statuses.filter((m) => m.status === "ready").length,
        // status='ready' alone overstates the sendable fleet: a warmup mailbox
        // stays 'ready' while it warms, and the sender skips it until it
        // graduates. readySending is what can take campaign mail today.
        readySending: statuses.filter((m) => m.status === "ready" && !isStillWarming(m)).length,
        warming: statuses.filter((m) => m.status === "warming" || (m.status === "ready" && isStillWarming(m))).length,
        paused: statuses.filter((m) => m.status === "paused").length,
        burned: statuses.filter((m) => m.status === "burned").length,
        disconnected: statuses.filter((m) => m.status === "disconnected").length,
      };
    },
    enabled: !!currentOrganization,
  });
}

// ============================================================================
// Mutations
// ============================================================================

interface ConnectResult {
  imported: number;
  updated: number;
  mailboxes: Array<{ email: string; status: string }>;
  errors: string[];
}

export function useConnectMailbox() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      zapmail_api_key?: string;
      key_id?: string;
      workspace_id?: string;
    }): Promise<ConnectResult> => {
      if (!currentOrganization) throw new Error("No organization context");

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("zapmail-connect", {
        body: {
          api_key: input.zapmail_api_key,
          key_id: input.key_id,
          organization_id: currentOrganization.id,
          workspace_id: input.workspace_id,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Failed to connect mailboxes");
      }

      return response.data as ConnectResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["zapmail-api-keys", currentOrganization?.id] });
      const parts: string[] = [];
      if (data.imported > 0) parts.push(`${data.imported} imported`);
      if (data.updated > 0) parts.push(`${data.updated} updated`);
      if (parts.length > 0) {
        toast.success(`Mailboxes: ${parts.join(", ")}`);
      } else {
        toast.info("No new mailboxes to import");
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to connect: ${error.message}`);
    },
  });
}

export function useUpdateMailboxStatus() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: MailboxStatus;
    }) => {
      const updateData: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      };

      // Clear the stored failure when the operator puts a mailbox back in play,
      // so a stale auto-pause message can't linger on a healthy row.
      if (status !== "paused") updateData.last_error = null;

      const { data, error } = await supabase
        .from("email_mailboxes")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      // Record WHY, key-scoped so we never clobber a concurrent metadata write.
      // A manual pause must be distinguishable from an automatic one — otherwise
      // the tick can't tell what it's allowed to release. Resuming clears the
      // reason so the next pause can't inherit a stale one.
      const { error: metaError } =
        status === "paused"
          ? await supabase.rpc("apply_mailbox_metadata_patch", {
              p_id: id,
              p_set: { paused_reason: "manual", paused_at: new Date().toISOString() },
              p_unset: [],
            })
          : await supabase.rpc("apply_mailbox_metadata_patch", {
              p_id: id,
              p_set: {},
              p_unset: ["paused_reason", "paused_at", "paused_stats", "bounce_spike_stats"],
            });
      if (metaError) console.warn("Failed to record pause reason:", metaError.message);

      return data as unknown as EmailMailbox;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", currentOrganization?.id] });
      toast.success(`Mailbox ${data.status === "paused" ? "paused" : "updated"}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update mailbox: ${error.message}`);
    },
  });
}

export function useDisconnectMailbox() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_mailboxes")
        .update({ status: "disconnected", updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", currentOrganization?.id] });
      toast.success("Mailbox disconnected");
    },
    onError: (error: Error) => {
      toast.error(`Failed to disconnect mailbox: ${error.message}`);
    },
  });
}

// Each mailbox delete unlinks its conversations/leads (up to ~1.2k rows, a few
// seconds), so a direct PostgREST delete blows the 8s role timeout on bulk
// selections. The RPC carries a 55s budget; chunking keeps a large selection
// well inside it.
const DELETE_MAILBOX_CHUNK = 5;

/**
 * Permanently delete mailboxes (bulk). Send history is kept (email_send_log
 * holds a soft reference), so unsubscribe links in already-sent mail keep working.
 */
export function useDeleteMailboxes() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      let deleted = 0;
      for (let i = 0; i < ids.length; i += DELETE_MAILBOX_CHUNK) {
        const { data, error } = await supabase.rpc("delete_email_mailboxes", {
          p_ids: ids.slice(i, i + DELETE_MAILBOX_CHUNK),
        });
        if (error) {
          throw new Error(deleted > 0 ? `${error.message} (${deleted} deleted before the failure)` : error.message);
        }
        deleted += data ?? 0;
      }
      return deleted;
    },
    onSettled: () => {
      // Also on error: earlier chunks may already be gone.
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", currentOrganization?.id] });
    },
    onSuccess: (deleted) => {
      toast.success(`${deleted} mailbox${deleted === 1 ? "" : "es"} deleted`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete mailboxes: ${error.message}`);
    },
  });
}

// ============================================================================
// Owner Assignment
// ============================================================================

/**
 * Assign or remove an owner user from an email mailbox.
 * When a mailbox has an owner, new inbound conversations on that
 * mailbox will be auto-assigned to the owner via DB trigger.
 */
export function useUpdateMailboxOwner() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      mailboxId,
      userId,
    }: {
      mailboxId: string;
      userId: string | null;
    }) => {
      const { data, error } = await supabase
        .from("email_mailboxes")
        .update({
          owner_user_id: userId,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", mailboxId)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as EmailMailbox;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      toast.success(vars.userId ? "Mailbox owner assigned" : "Mailbox owner removed");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update owner: ${error.message}`);
    },
  });
}

/**
 * Assign (or clear) an owner across many mailboxes in a single round-trip.
 */
export function useBulkUpdateMailboxOwner() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      ids,
      userId,
    }: {
      ids: string[];
      userId: string | null;
    }) => {
      // @ts-ignore - RPC exists after migration 20260522000000
      const { data, error } = await supabase.rpc("bulk_update_mailbox_owner", {
        p_ids: ids,
        p_user_id: userId,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (count, vars) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      toast.success(
        vars.userId
          ? `${count} mailbox${count !== 1 ? "es" : ""} assigned`
          : `Owner removed from ${count} mailbox${count !== 1 ? "es" : ""}`
      );
    },
    onError: (error: Error) => {
      toast.error(`Bulk owner update failed: ${error.message}`);
    },
  });
}

// ============================================================================
// SMTP Mutations
// ============================================================================

export function useTestSMTPConnection() {
  return useMutation({
    mutationFn: async (input: {
      smtp_host: string;
      smtp_port: number;
      smtp_username: string;
      smtp_password: string;
    }) => {
      const response = await supabase.functions.invoke("mailbox-connect", {
        body: { action: "smtp_test", ...input },
      });

      if (response.error) {
        throw new Error(response.error.message || "Connection test failed");
      }

      if (!response.data.success) {
        throw new Error(response.data.error || "SMTP connection failed");
      }

      return response.data;
    },
    onError: (error: Error) => {
      toast.error(`SMTP test failed: ${error.message}`);
    },
  });
}

export function useTestIMAPConnection() {
  return useMutation({
    mutationFn: async (input: {
      imap_host: string;
      imap_port: number;
      imap_username: string;
      imap_password: string;
    }) => {
      const response = await supabase.functions.invoke("mailbox-connect", {
        body: { action: "imap_test", ...input },
      });

      if (response.error) {
        throw new Error(response.error.message || "IMAP connection test failed");
      }

      if (!response.data.success) {
        throw new Error(response.data.error || "IMAP connection failed");
      }

      return response.data;
    },
    onError: (error: Error) => {
      toast.error(`IMAP test failed: ${error.message}`);
    },
  });
}

export function useAddSMTPMailbox() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      from_name: string;
      from_email: string;
      smtp_host: string;
      smtp_port: number;
      smtp_username: string;
      smtp_password: string;
      imap_host: string;
      imap_port: number;
      imap_username: string;
      imap_password: string;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const response = await supabase.functions.invoke("mailbox-connect", {
        body: {
          action: "smtp_add",
          organization_id: currentOrganization.id,
          ...input,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Failed to add mailbox");
      }

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", currentOrganization?.id] });
      toast.success("SMTP mailbox connected");
    },
    onError: (error: Error) => {
      toast.error(`Failed to add mailbox: ${error.message}`);
    },
  });
}

interface CSVImportResult {
  imported: number;
  /** Mailboxes that passed the SMTP + IMAP connection test (resolved post-import). */
  verified?: number;
  /** Mailboxes whose connection test failed (status: disconnected). */
  failed?: number;
  /** Mailboxes still awaiting verification (status: pending). At response time this equals `imported`. */
  unverified?: number;
  /** True when imported mailboxes are being verified in the background. */
  verifying?: boolean;
  skipped: number;
  mailboxes: Array<{ email: string; status: string; verified?: boolean; error?: string }>;
  errors: string[];
}

export function useImportCSVMailboxes() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: { csv_data: string }): Promise<CSVImportResult> => {
      if (!currentOrganization) throw new Error("No organization context");

      const response = await supabase.functions.invoke("mailbox-connect", {
        body: {
          action: "csv_import",
          organization_id: currentOrganization.id,
          csv_data: input.csv_data,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "CSV import failed");
      }

      return response.data as CSVImportResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", currentOrganization?.id] });
      if (data.imported > 0) {
        toast.success(
          `${data.imported} mailbox${data.imported !== 1 ? "es" : ""} imported — verifying connections in the background`
        );
      } else {
        toast.info("No new mailboxes to import");
      }
    },
    onError: (error: Error) => {
      toast.error(`CSV import failed: ${error.message}`);
    },
  });
}

// ============================================================================
// Connection Retest (SMTP + IMAP for existing mailboxes)
// ============================================================================

export function useRetestConnection() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const response = await supabase.functions.invoke("mailbox-connect", {
        body: { action: "connection_retest", mailbox_id: mailboxId },
      });

      if (response.error) {
        throw new Error(response.error.message || "Connection test failed");
      }

      if (!response.data.success) {
        throw new Error(response.data.error || "Connection failed");
      }

      return response.data as { success: boolean; smtp_ok: boolean; imap_ok: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      toast.success("Connection verified");
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      toast.error(`Connection test failed: ${error.message}`);
    },
  });
}

export type ConnectionTestStatus = "testing" | "passed" | "failed";

export function useBulkRetestConnection() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const [testStatuses, setTestStatuses] = useState<Map<string, ConnectionTestStatus>>(new Map());

  const mutation = useMutation({
    mutationFn: async (mailboxIds: string[]) => {
      const results: { id: string; success: boolean; error?: string }[] = [];

      // Mark all as testing
      setTestStatuses(new Map(mailboxIds.map((id) => [id, "testing" as const])));

      const testOne = async (id: string) => {
        try {
          const response = await supabase.functions.invoke("mailbox-connect", {
            body: { action: "connection_retest", mailbox_id: id },
          });

          const success = !response.error && response.data?.success;
          const error = response.error?.message || response.data?.error;
          results.push({ id, success, error });

          setTestStatuses((prev) => {
            const next = new Map(prev);
            next.set(id, success ? "passed" : "failed");
            return next;
          });
        } catch (err) {
          results.push({ id, success: false, error: err instanceof Error ? err.message : "Unknown error" });
          setTestStatuses((prev) => {
            const next = new Map(prev);
            next.set(id, "failed");
            return next;
          });
        }
      };

      // Run with bounded concurrency so 1k+ mailboxes finish in minutes, not
      // hours, but we don't fan out far enough to trip SMTP/IMAP rate limits.
      const CONCURRENCY = 8;
      const queue = [...mailboxIds];
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          const id = queue.shift();
          if (!id) break;
          await testOne(id);
        }
      });
      await Promise.all(workers);

      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      const passed = results.filter((r) => r.success).length;
      const failed = results.length - passed;
      if (failed === 0) {
        toast.success(`All ${passed} connections verified`);
      } else if (passed === 0) {
        toast.error(`All ${failed} connection tests failed`);
      } else {
        toast.warning(`${passed} passed, ${failed} failed`);
      }
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      toast.error(`Bulk connection test failed: ${error.message}`);
    },
  });

  const clearTestStatuses = () => setTestStatuses(new Map());

  return { ...mutation, testStatuses, clearTestStatuses };
}

// ============================================================================
// Update Mailbox Credentials
// ============================================================================

export function useUpdateMailboxCredentials() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      mailboxId,
      smtp_host,
      smtp_port,
      smtp_username,
      smtp_password,
      imap_host,
      imap_port,
      imap_username,
      imap_password,
    }: {
      mailboxId: string;
      smtp_host?: string;
      smtp_port?: number;
      smtp_username?: string;
      smtp_password?: string;
      imap_host?: string;
      imap_port?: number;
      imap_username?: string;
      imap_password?: string;
    }) => {
      const response = await supabase.functions.invoke("mailbox-connect", {
        body: {
          action: "update_credentials",
          mailbox_id: mailboxId,
          smtp_host,
          smtp_port,
          smtp_username,
          smtp_password,
          imap_host,
          imap_port,
          imap_username,
          imap_password,
        },
      });

      if (response.error) throw new Error(response.error.message);
      const data = response.data;
      if (!data.success) throw new Error(data.error || "Credential update failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      toast.success("Credentials updated and connection verified");
    },
    onError: (error: Error) => {
      toast.error(`Credential update failed: ${error.message}`);
    },
  });
}

// ============================================================================
// Single Mailbox Update (columns + metadata merge)
// ============================================================================

export function useUpdateMailbox() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      columnUpdates,
      metadataUpdates,
    }: {
      id: string;
      columnUpdates?: Record<string, unknown>;
      metadataUpdates?: Record<string, unknown>;
    }) => {
      const payload: Record<string, unknown> = {
        ...columnUpdates,
        updated_at: new Date().toISOString(),
      };

      // A manual daily_limit edit must also become the warmup ceiling and the
      // engagement baseline — otherwise email-warmup-tick (daily_limit :=
      // warmup_max_daily) and infra-mailbox-engagement-recompute (daily_limit
      // := daily_limit_baseline) silently revert the edit on their next run.
      // bulk_update_mailboxes mirrors these server-side for the bulk path.
      if (columnUpdates && columnUpdates.daily_limit !== undefined) {
        payload.warmup_max_daily = columnUpdates.daily_limit;
        payload.daily_limit_baseline = columnUpdates.daily_limit;
      }

      if (metadataUpdates && Object.keys(metadataUpdates).length > 0) {
        const { data: current } = await supabase
          .from("email_mailboxes")
          .select("metadata")
          .eq("id", id)
          .single();

        payload.metadata = {
          ...((current?.metadata as Record<string, unknown>) || {}),
          ...metadataUpdates,
        };
      }

      const { data, error } = await supabase
        .from("email_mailboxes")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as EmailMailbox;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", currentOrganization?.id] });
      toast.success("Mailbox settings updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update: ${error.message}`);
    },
  });
}

// ============================================================================
// Tag Mutations
// ============================================================================

/**
 * Get all unique tags used across mailboxes in the organization.
 * Derives from the main mailboxes query to avoid extra network calls.
 */
export function useMailboxTags() {
  const { data: mailboxes } = useEmailMailboxes();

  const tags = (() => {
    if (!mailboxes) return [];
    const set = new Set<string>();
    mailboxes.forEach((m) => m.tags?.forEach((t: string) => set.add(t)));
    return Array.from(set).sort();
  })();

  return tags;
}

export function useUpdateMailboxTags() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, tags }: { id: string; tags: string[] }) => {
      const { data, error } = await supabase
        .from("email_mailboxes")
        .update({ tags, updated_at: new Date().toISOString() } as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as EmailMailbox;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      toast.success("Tags updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update tags: ${error.message}`);
    },
  });
}

export function useBulkUpdateMailboxTags() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      ids,
      tags,
      mode = "add",
    }: {
      ids: string[];
      tags: string[];
      mode?: "add" | "remove" | "set";
    }) => {
      // Single atomic RPC — applies the add/remove/set operation server-side.
      // @ts-ignore - RPC exists after migration 20260522000000
      const { data, error } = await supabase.rpc("bulk_update_mailbox_tags", {
        p_ids: ids,
        p_tags: tags,
        p_mode: mode,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (count, variables) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      const action = variables.mode === "remove" ? "removed from" : variables.mode === "set" ? "set for" : "added to";
      toast.success(`Tags ${action} ${count} mailbox${count !== 1 ? "es" : ""}`);
    },
    onError: (error: Error) => {
      toast.error(`Bulk tag update failed: ${error.message}`);
    },
  });
}

// ============================================================================
// Bulk Mailbox Update
// ============================================================================

export function useBulkUpdateMailboxes() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      ids,
      columnUpdates,
      metadataUpdates,
    }: {
      ids: string[];
      columnUpdates?: Record<string, unknown>;
      metadataUpdates?: Record<string, unknown>;
    }) => {
      // Single atomic RPC — merges metadata via jsonb || and updates columns in one transaction.
      // @ts-ignore - RPC exists after migration 20260401000007
      const { data, error } = await supabase.rpc("bulk_update_mailboxes", {
        p_ids: ids,
        p_column_updates:
          columnUpdates && Object.keys(columnUpdates).length > 0
            ? columnUpdates
            : null,
        p_metadata_merge:
          metadataUpdates && Object.keys(metadataUpdates).length > 0
            ? metadataUpdates
            : null,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", currentOrganization?.id] });
      toast.success(`${count} mailbox${count !== 1 ? "es" : ""} updated`);
    },
    onError: (error: Error) => {
      toast.error(`Bulk update failed: ${error.message}`);
    },
  });
}

// ============================================================================
// Export for Mailflow
// ============================================================================

export type MailboxExportSkippedReason = "missing_credentials" | "decryption_failed";

export interface MailboxExportSkipped {
  email: string;
  reason: MailboxExportSkippedReason;
}

interface MailboxExportEnvelope {
  csv: string;
  exported_count: number;
  skipped_count: number;
  skipped: MailboxExportSkipped[];
}

export function useExportMailboxesForMailflow(options?: {
  onSkipped?: (skipped: MailboxExportSkipped[]) => void;
}) {
  const { currentOrganization } = useAuth();
  const onSkipped = options?.onSkipped;

  return useMutation({
    mutationFn: async (mailboxIds?: string[]): Promise<MailboxExportEnvelope> => {
      if (!currentOrganization) throw new Error("No organization");

      const { data, error } = await supabase.functions.invoke<MailboxExportEnvelope>(
        "mailbox-export",
        {
          body: {
            organization_id: currentOrganization.id,
            mailbox_ids: mailboxIds?.length ? mailboxIds : undefined,
          },
        }
      );

      if (error) throw error;
      if (!data || typeof data !== "object" || typeof data.csv !== "string") {
        throw new Error("Unexpected response from mailbox-export");
      }

      if (data.csv.length > 0) {
        const blob = new Blob([data.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "mailboxes-export.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      return data;
    },
    onSuccess: (envelope) => {
      const { exported_count, skipped_count, skipped } = envelope;

      if (skipped_count === 0) {
        const label = exported_count === 1 ? "mailbox" : "mailboxes";
        toast.success(`Exported ${exported_count} ${label}`);
        return;
      }

      const action = onSkipped
        ? { label: "View skipped", onClick: () => onSkipped(skipped) }
        : undefined;

      if (exported_count === 0) {
        toast.error(
          `None of the ${skipped_count} selected mailbox${skipped_count === 1 ? "" : "es"} had usable SMTP credentials`,
          action ? { action } : undefined
        );
        return;
      }

      toast.warning(
        `Exported ${exported_count}, skipped ${skipped_count}`,
        action ? { action } : undefined
      );
    },
    onError: (error: Error) => {
      toast.error(`Export failed: ${error.message}`);
    },
  });
}
