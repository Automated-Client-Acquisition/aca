
export function sequenceRequiresGeneratedContent(steps: unknown): boolean {
  return /\{\{\s*(?:custom_)?email_(?:subject|body)_\d+\s*\}\}|\{\{\s*custom_email_\d+_(?:subject|body)\s*\}\}/.test(JSON.stringify(steps ?? []));
}

export function hasEnrollmentContent(data?: Record<string, string>): boolean {
  return !!data?.custom_email_1_subject && !!data?.custom_email_1_body;
}

export function enrollmentRequestBody(body: Record<string, any>): Record<string, any> {
  if (body.dryRun !== true) return body;
  if (['contactIds', 'listId', 'listIds', 'sourceSequenceId'].some((key) => key in body)) {
    throw new Error('dryRun audiences must be provided in previewSource');
  }
  return { ...body, ...(body.previewSource ?? {}), sequenceId: body.sequenceId, organizationId: body.organizationId };
}

/** Reads only. In particular, never resolve the auto mailbox pool: it can write. */
export async function previewEnrollment(
  supabase: any,
  options: {
    organizationId: string;
    sequenceId: string;
    contactIds: string[];
    listIds: string[];
    sequence: { steps?: unknown; enroll_filter_criteria?: Record<string, unknown> };
    enforceExclusivity: boolean;
    customDataByContactId?: Record<string, Record<string, string>>;
    leadsWithoutContact?: number;
  },
) {
  const { organizationId, sequenceId, listIds, sequence, enforceExclusivity } = options;
  // One set-based RPC instead of chunked .in() lookups: a 52k-member list was
  // ~4,200 PostgREST calls and never finished inside the edge budget.
  const ids = [...new Set(options.contactIds)];

  const criteria = sequence.enroll_filter_criteria;
  let criteriaKept: string[] | null = null;
  if (ids.length && criteria && Object.keys(criteria).length) {
    const { data, error } = await supabase.rpc('filter_contact_ids_by_criteria', {
      p_org: organizationId, p_ids: ids, p_criteria: criteria,
    });
    if (error) throw error;
    criteriaKept = Array.isArray(data) ? data : [];
  }
  let gateKept: string[] | null = null;
  const afterCriteria = criteriaKept ?? ids;
  if (afterCriteria.length && listIds.length) {
    const { data, error } = await supabase.rpc('filter_contact_ids_by_pipeline_gate', {
      p_org: organizationId, p_list_ids: listIds,
      p_dest_type: 'email_sequence', p_dest_id: sequenceId, p_ids: afterCriteria,
    });
    if (error) throw error;
    if (Array.isArray(data)) gateKept = data;
  }

  const requiresContent = sequenceRequiresGeneratedContent(sequence.steps);
  const contentOk = requiresContent
    ? Object.entries(options.customDataByContactId ?? {})
      .filter(([, data]) => hasEnrollmentContent(data)).map(([id]) => id)
    : null;

  // Disjoint slices summed. ~1k ids is ~1s on a cold cache, well inside the
  // 8s PostgREST statement timeout; a 5k slice measured 5.2s under load.
  const SLICE = 1000;
  const CONCURRENCY = 4;
  const criteriaSet = criteriaKept ? new Set(criteriaKept) : null;
  const gateSet = gateKept ? new Set(gateKept) : null;
  const contentSet = contentOk ? new Set(contentOk) : null;
  const within = (set: Set<string> | null, slice: string[]) => set ? slice.filter((id) => set.has(id)) : null;
  const slices: string[][] = [];
  for (let i = 0; i < ids.length; i += SLICE) slices.push(ids.slice(i, i + SLICE));
  const totals: Record<string, number> = {};
  const conflictCounts = new Map<string, { id: string; name: string; count: number }>();
  for (let i = 0; i < slices.length; i += CONCURRENCY) {
    const batch = await Promise.all(slices.slice(i, i + CONCURRENCY).map(async (slice) => {
      const { data, error } = await supabase.rpc('preview_email_enrollment_counts', {
        p_org: organizationId,
        p_sequence_id: sequenceId,
        p_ids: slice,
        // Only this slice's share of each gate, not the whole audience per call.
        p_criteria_kept: within(criteriaSet, slice),
        p_gate_kept: within(gateSet, slice),
        p_content_ok: within(contentSet, slice),
        p_requires_content: requiresContent,
        p_enforce_exclusivity: enforceExclusivity,
      });
      if (error) throw error;
      return data ?? {};
    }));
    for (const counts of batch) {
      for (const [key, value] of Object.entries(counts)) {
        if (typeof value === 'number') totals[key] = (totals[key] ?? 0) + value;
      }
      for (const row of (counts.conflictingSequences ?? []) as Array<{ id: string; name: string; count: number }>) {
        const prev = conflictCounts.get(row.id);
        conflictCounts.set(row.id, { ...row, count: (prev?.count ?? 0) + row.count });
      }
    }
  }
  const n = (key: string) => totals[key] ?? 0;

  const result = {
    dryRun: true as const,
    totalContacts: n('totalContacts'),
    eligible: n('passed') - n('alreadyInAnotherSequence') - n('duplicates'),
    skipped: n('filteredOut') + n('awaitingPipeline') + n('duplicates'),
    noEmail: n('noEmail'),
    suppressed: n('suppressed'),
    alreadyInAnotherSequence: n('alreadyInAnotherSequence'),
    filteredOut: n('filteredOut'),
    awaitingPipeline: n('awaitingPipeline'),
    missingContent: n('missingContent'),
    leadsWithoutContact: options.leadsWithoutContact ?? 0,
    conflictingSequences: [...conflictCounts.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
  return result;
}
