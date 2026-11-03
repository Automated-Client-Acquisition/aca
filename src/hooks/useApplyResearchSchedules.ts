import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getNextResearchScheduleRun, type ResearchScheduleDraft } from "@/lib/research-schedule";

export interface BulkScheduleTarget {
  id: string;
  name: string;
  organizationId: string;
}

export interface ApplyResearchSchedulesParams {
  type: "creator" | "search_term";
  targets: BulkScheduleTarget[];
  schedule: ResearchScheduleDraft;
  onProgress?: (completed: number, total: number) => void;
}

export interface ApplyResearchSchedulesResult {
  createdIds: string[];
  updatedIds: string[];
  failures: { id: string; name: string; message: string }[];
}

interface ExistingSchedule {
  id: string;
  targetId: string;
  frequency_type: string;
  scrape_config: Json | null;
}

function errorMessage(cause: unknown): string {
  return cause && typeof cause === "object" && "message" in cause
    ? String(cause.message) : "Could not save this schedule. Please try again.";
}

export function useApplyResearchSchedules() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ type, targets, schedule, onProgress }: ApplyResearchSchedulesParams): Promise<ApplyResearchSchedulesResult> => {
      const organizationId = currentOrganization?.id;
      if (!organizationId) throw new Error("Select an organization before applying schedules.");
      if (targets.some(target => target.organizationId !== organizationId)) {
        throw new Error("Your organization changed. Return to the selected sources' organization before applying schedules.");
      }
      const maxItems = Number(schedule.maxItems);
      if (!schedule.enabled || !["hourly", "daily", "weekly"].includes(schedule.frequency)) {
        throw new Error("Choose an hourly, daily, or weekly scraping schedule.");
      }
      if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 1000) {
        throw new Error("Enter a whole number from 1 to 1,000 posts per scheduled run.");
      }
      const selected = [...new Map(targets.map(target => [target.id, target])).values()];
      if (selected.length === 0) throw new Error("Select at least one creator or search term.");
      onProgress?.(0, selected.length);
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again before applying schedules.");

      const sourcePlatforms = new Map<string, string>();
      const existing = new Map<string, ExistingSchedule[]>();
      const isCreator = type === "creator";

      const readSchedules = async (ids: string[]): Promise<ExistingSchedule[]> => {
        if (isCreator) {
          const { data, error } = await supabase.from("scrape_schedules")
            .select("id,creator_id,frequency_type,scrape_config")
            .eq("organization_id", organizationId).in("creator_id", ids);
          if (error) throw error;
          return (data || []).map(row => ({ ...row, targetId: row.creator_id }));
        }
        const { data, error } = await supabase.from("search_schedules")
          .select("id,search_term_id,frequency_type,scrape_config")
          .eq("organization_id", organizationId).in("search_term_id", ids);
        if (error) throw error;
        return (data || []).map(row => ({ ...row, targetId: row.search_term_id }));
      };

      // Read all selected sources before writing so a failed preflight cannot leave a partial batch.
      for (let offset = 0; offset < selected.length; offset += 50) {
        const ids = selected.slice(offset, offset + 50).map(target => target.id);
        const { data, error } = await supabase.from(isCreator ? "research_creators" : "research_search_terms")
          .select("id,platform").eq("organization_id", organizationId).in("id", ids);
        if (error) throw new Error(`Could not load selected sources: ${errorMessage(error)}`);
        for (const row of data || []) sourcePlatforms.set(row.id, row.platform);
        let rows: ExistingSchedule[];
        try {
          rows = await readSchedules(ids);
        } catch (cause) {
          throw new Error(`Could not load existing schedules: ${errorMessage(cause)}`);
        }
        for (const row of rows) {
          existing.set(row.targetId, [...(existing.get(row.targetId) || []), row]);
        }
      }

      const nextRun = getNextResearchScheduleRun(schedule.frequency);
      const updatedAt = new Date().toISOString();
      const updateRows = async (targetId: string, rows: ExistingSchedule[]) => {
        for (const row of rows) {
          const config = row.scrape_config && typeof row.scrape_config === "object" && !Array.isArray(row.scrape_config)
            ? row.scrape_config : {};
          const changes = {
            scrape_config: { ...config, maxItems },
            auto_pause_on_failure: schedule.autoPause,
            is_active: true,
            consecutive_failures: 0,
            next_run_at: nextRun,
            updated_at: updatedAt,
          };
          const query = isCreator
            ? supabase.from("scrape_schedules").update(changes).eq("creator_id", targetId)
            : supabase.from("search_schedules").update(changes).eq("search_term_id", targetId);
          const { data, error } = await query.eq("organization_id", organizationId)
            .eq("id", row.id).eq("frequency_type", schedule.frequency).select("id");
          if (error) throw error;
          if (!data?.length) throw new Error("This schedule changed or was deleted. Retry to reload its current settings.");
        }
      };

      const applyToTarget = async (target: BulkScheduleTarget): Promise<"created" | "updated"> => {
        if (!sourcePlatforms.has(target.id)) throw new Error("This source was deleted or is no longer available in your organization.");
        let matching = (existing.get(target.id) || []).filter(row => row.frequency_type === schedule.frequency);
        if (!matching.length) {
          // A previous request or another browser may have created this cadence since preflight.
          matching = (await readSchedules([target.id])).filter(row => row.frequency_type === schedule.frequency);
        }
        if (matching.length) {
          await updateRows(target.id, matching);
          return "updated";
        }

        const scheduleId = crypto.randomUUID();
        const values = {
          id: scheduleId,
          organization_id: organizationId,
          frequency_type: schedule.frequency,
          cron_expression: null,
          scrape_config: { maxItems },
          auto_pause_on_failure: schedule.autoPause,
          is_active: true,
          consecutive_failures: 0,
          next_run_at: nextRun,
        };
        try {
          const query = isCreator
            ? supabase.from("scrape_schedules").insert({ ...values, creator_id: target.id, platform: sourcePlatforms.get(target.id)! })
            : supabase.from("search_schedules").insert({ ...values, search_term_id: target.id });
          const { data, error } = await query.select("id").single();
          if (error) throw error;
          if (!data) throw new Error("The schedule save could not be confirmed.");
          return "created";
        } catch (cause) {
          // Reconcile a duplicate constraint or a response lost after the insert committed.
          const current = (await readSchedules([target.id])).filter(row => row.frequency_type === schedule.frequency);
          if (!current.length) throw cause;
          await updateRows(target.id, current);
          return current.some(row => row.id === scheduleId) ? "created" : "updated";
        }
      };

      const result: ApplyResearchSchedulesResult = { createdIds: [], updatedIds: [], failures: [] };
      let cursor = 0;
      let completed = 0;
      const worker = async () => {
        while (cursor < selected.length) {
          const target = selected[cursor++];
          try {
            const outcome = await applyToTarget(target);
            (outcome === "created" ? result.createdIds : result.updatedIds).push(target.id);
          } catch (cause) {
            result.failures.push({ id: target.id, name: target.name, message: errorMessage(cause) });
          }
          completed++;
          onProgress?.(completed, selected.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker));
      return result;
    },
    onSuccess: () => {
      for (const queryKey of [
        ["schedules"], ["schedule-status"], ["scrape-schedules"], ["creator-schedules"],
        ["search-term-schedules"], ["upcoming-schedules"], ["scraping-activity"],
      ]) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
