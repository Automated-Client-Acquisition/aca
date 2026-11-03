import { useMemo } from "react";
import { Filter, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { AdvancedFilters } from "@/components/contacts/AdvancedFilters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useInheritedProcessingFilters } from "@/hooks/useInheritedProcessingFilters";
import {
  SMARTLIST_HIDDEN_FIELDS,
  criteriaToEnrichment,
  mergeEnrichmentIntoCriteria,
} from "@/lib/smart-list-criteria";
import type { SmartListFilterCriteria } from "@/hooks/useLeadLists";

/**
 * "Only enrol leads matching…" — the filter step between an attached lead list
 * and a campaign / email sequence.
 *
 * Deliberately NOT a new filter language: it stores the same
 * SmartListFilterCriteria a smart list stores, renders the same AdvancedFilters
 * panel, and is evaluated server-side by the same engine
 * (smart_list_eligible_contacts_for_criteria via filter_contact_ids_by_criteria).
 * So a filter set here means exactly what the identical filter means on a list.
 *
 * The live count comes from enrollment_filter_preview, which runs that same
 * gate. It previews source members matching this filter, before campaign
 * exclusions or ICP targeting apply.
 */
export function EnrollmentFilterStep({
  criteria,
  onChange,
  listIds,
  disabled,
  context,
}: {
  criteria: SmartListFilterCriteria;
  onChange: (next: SmartListFilterCriteria) => void;
  /** Lists currently attached — drives the "N of M" preview. */
  listIds: string[];
  disabled?: boolean;
  context?: "campaign" | "sequence";
}) {
  const { currentOrganization } = useAuth();
  const enrichment = useMemo(
    () => criteriaToEnrichment(criteria ?? {}),
    [criteria],
  );
  const activeCount = Object.keys(criteria ?? {}).length;
  const inherited = useInheritedProcessingFilters(listIds);

  const debouncedKey = useDebouncedValue(
    JSON.stringify([listIds, criteria ?? {}]),
    400,
  );

  const preview = useQuery({
    queryKey: [
      "enrollment-filter-preview",
      currentOrganization?.id,
      debouncedKey,
    ],
    enabled: !!currentOrganization && listIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const [ids, crit] = JSON.parse(debouncedKey) as [
        string[],
        SmartListFilterCriteria,
      ];
      const { data, error } = await supabase.rpc(
        // @ts-expect-error Generated Supabase types update alongside the migration.
        "enrollment_filter_preview",
        { p_org: currentOrganization!.id, p_list_ids: ids, p_criteria: crit },
      );
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { total_in_lists: number; matching: number }
        | undefined;
      return row ?? { total_in_lists: 0, matching: 0 };
    },
  });

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">Additional enrollment filters</span>
          {activeCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        {activeCount > 0 && !disabled && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onChange({})}
          >
            Clear
          </Button>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Source membership rules define the audience. These optional filters narrow enrollment from directly connected sources.
      </p>

      {/* Gates the lists' processing pipelines already apply. Read-only: this
          is the other filter language, restated here so nobody re-applies an
          ICP threshold that is already enforced upstream. */}
      {(inherited.data ?? []).length > 0 && (
        <div className="space-y-1 rounded-md bg-muted/50 p-2">
          {(inherited.data ?? []).map((entry) => (
            <div
              key={entry.listId}
              className="flex flex-wrap items-center gap-1 text-xs"
            >
              <span className="text-muted-foreground">
                Configured processing on{" "}
                <span className="font-medium text-foreground">
                  {entry.listName}
                </span>{" "}
                uses:
              </span>
              {entry.rules.map((rule) => (
                <Badge
                  key={rule}
                  variant="outline"
                  className="text-[10px] py-0 h-4 font-normal"
                >
                  {rule}
                </Badge>
              ))}
            </div>
          ))}
          <p className="text-xs leading-relaxed text-muted-foreground">Processing routes use these source rules. Direct sources use the destination’s audience rules.</p>
        </div>
      )}

      <fieldset disabled={disabled} className="min-w-0" aria-label="Additional enrollment filters">
        <AdvancedFilters
          filters={enrichment}
          hiddenFields={SMARTLIST_HIDDEN_FIELDS}
          onChange={(next) =>
            !disabled && onChange(mergeEnrichmentIntoCriteria(criteria ?? {}, next))
          }
        />
      </fieldset>

      <PreviewLine
        loading={preview.isPending || preview.isFetching}
        error={preview.isError}
        hasLists={listIds.length > 0}
        hasFilters={activeCount > 0}
        total={preview.data?.total_in_lists}
        matching={preview.data?.matching}
        context={context}
        onRetry={() => void preview.refetch()}
      />
    </div>
  );
}

function PreviewLine({
  loading,
  error,
  hasLists,
  hasFilters,
  total,
  matching,
  context,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  hasLists: boolean;
  hasFilters: boolean;
  total?: number;
  matching?: number;
  context?: "campaign" | "sequence";
  onRetry: () => void;
}) {
  if (!hasLists) {
    return (
      <p className="text-xs text-muted-foreground">
        Add an audience source to preview matching members.
      </p>
    );
  }
  if (error)
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <span>Couldn't check how many source members match.</span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={loading}
          onClick={onRetry}
        >
          {loading ? "Checking…" : "Retry preview"}
        </Button>
      </div>
    );
  if (loading || total === undefined || matching === undefined) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking how many leads
        match…
      </p>
    );
  }
  return (
      <div
        className="space-y-1 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {matching === 0 && hasFilters ? (
          <p className="text-amber-700 dark:text-amber-400">
            No source members match this filter. Adjust the criteria to include
            leads.
          </p>
        ) : !hasFilters ? (
          <p>
            No enrollment filter ·{" "}
            <span className="font-medium tabular-nums text-foreground">
              {total.toLocaleString()}
            </span>{" "}
            unique source members available for eligibility checks.
          </p>
        ) : (
          <p>
            <span className="font-medium tabular-nums text-foreground">
              {matching.toLocaleString()}
            </span>{" "}
            of {total.toLocaleString()} unique source members match this filter
            {total > matching && (
              <> · {(total - matching).toLocaleString()} do not match</>
            )}
            .
          </p>
        )}
        <p>
          Members in overlapping sources are counted once. {context === "campaign"
            ? "Exclusions and product fit rules still apply before enrollment."
            : "Suppression rules and email availability still apply before enrollment."}
        </p>
      </div>
  );
}
