import { enrollmentRequestBody, previewEnrollment } from './enrollment-preview.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

type Row = Record<string, any>;

// JS twin of public.preview_email_enrollment_counts, so these scenarios keep
// pinning the bucketing rules the SQL implements.
function previewCounts(tables: Record<string, Row[]>, a: any) {
  const SUPPRESSED = ['unsubscribed', 'do_not_contact', 'bounced'];
  const has = (arr: string[] | null, id: string) => arr === null || arr.includes(id);
  const c = (tables.crm_contacts ?? []).filter((r) => r.organization_id === a.p_org && a.p_ids.includes(r.id))
    .map((r): Row => ({ ...r, crit: has(a.p_criteria_kept, r.id), gate: has(a.p_gate_kept, r.id),
      content: !a.p_requires_content || (a.p_content_ok ?? []).includes(r.id) }));
  const okStatus = (r: Row) => !SUPPRESSED.includes(r.status ?? '');
  const passed = c.filter((r) => r.crit && r.gate && r.content && okStatus(r) && r.primary_email);
  const seqs = tables.email_sequences ?? [];
  const enr = tables.email_sequence_enrollments ?? [];
  const conf: Array<{ contact: string; seq: string }> = [];
  let duplicates = 0;
  for (const p of passed) {
    const leadId = (tables.leads ?? []).find((l) => l.source_id === p.id && l.organization_id === a.p_org && l.source === 'crm_contact')?.id;
    if (!leadId) continue;
    const mine = a.p_enforce_exclusivity ? enr.filter((e) => e.lead_id === leadId && e.status === 'active' && e.sequence_id !== a.p_sequence_id
      && seqs.some((s) => s.id === e.sequence_id && s.organization_id === a.p_org && s.status === 'active')) : [];
    for (const e of mine) if (!conf.some((x) => x.contact === p.id && x.seq === e.sequence_id)) conf.push({ contact: p.id, seq: e.sequence_id });
    if (!mine.length && enr.some((e) => e.sequence_id === a.p_sequence_id && e.lead_id === leadId)) duplicates++;
  }
  const bySeq = new Map<string, number>();
  for (const x of conf) bySeq.set(x.seq, (bySeq.get(x.seq) ?? 0) + 1);
  return {
    totalContacts: c.length,
    filteredOut: c.filter((r) => !r.crit).length,
    awaitingPipeline: c.filter((r) => r.crit && !r.gate).length,
    suppressed: c.filter((r) => r.crit && r.gate && !okStatus(r)).length,
    noEmail: c.filter((r) => r.crit && r.gate && okStatus(r) && !r.primary_email).length,
    missingContent: c.filter((r) => r.crit && r.gate && !r.content && okStatus(r) && r.primary_email).length,
    passed: passed.length,
    alreadyInAnotherSequence: new Set(conf.map((x) => x.contact)).size,
    duplicates,
    conflictingSequences: [...bySeq].map(([id, count]) => ({ id, name: seqs.find((s) => s.id === id)?.name || 'Another sequence', count }))
      .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)),
  };
}
function readOnlyClient(tables: Record<string, Row[]>, gates: Record<string, string[] | Error> = {}) {
  const reads: string[] = [];
  const mutation = () => { throw new Error('Preview attempted a database mutation'); };
  return {
    reads,
    from(table: string) {
      reads.push(table);
      let rows = tables[table] ?? [];
      const q: any = {
        select() { return q; },
        in(column: string, ids: string[]) { rows = rows.filter((row) => ids.includes(row[column])); return q; },
        eq(column: string, value: any) { rows = rows.filter((row) => row[column] === value); return q; },
        neq(column: string, value: any) { rows = rows.filter((row) => row[column] !== value); return q; },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        then(resolve: any) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
        insert: mutation, upsert: mutation, update: mutation, delete: mutation,
      };
      return q;
    },
    async rpc(name: string, args: any) {
      if (name === 'preview_email_enrollment_counts') return { data: previewCounts(tables, args), error: null };
      if (!['filter_contact_ids_by_criteria', 'filter_contact_ids_by_pipeline_gate'].includes(name)) mutation();
      equal(args.p_org, 'org');
      const gate = gates[name];
      return gate instanceof Error ? { data: null, error: gate } : { data: gate ?? args.p_ids, error: null };
    },
  };
}

const contact = (id: string, extra: Row = {}) => ({ id, organization_id: 'org', primary_email: `${id}@example.com`, status: 'active', ...extra });
const lead = (id: string) => ({ id: `lead-${id}`, source_id: id, source: 'crm_contact', organization_id: 'org' });
const enrollment = (id: string, sequence_id = 'cyberscore', status = 'active') => ({ lead_id: `lead-${id}`, sequence_id, status });
const options = (contactIds: string[], extra: Row = {}) => ({
  organizationId: 'org', sequenceId: 'target', contactIds, listIds: [], sequence: { steps: [] }, enforceExclusivity: true, ...extra,
});

Deno.test('964 active contacts preview zero ready and name the conflicting sequence without writes', async () => {
  const ids = Array.from({ length: 964 }, (_, index) => `contact-${index}`);
  const client = readOnlyClient({
    crm_contacts: ids.map((id) => contact(id)), leads: ids.map(lead),
    email_sequence_enrollments: ids.map((id) => enrollment(id)),
    email_sequences: [{ id: 'cyberscore', name: 'cyberscore', organization_id: 'org', status: 'active' }],
  });
  const result = await previewEnrollment(client, options([...ids, ...ids]));
  equal(result, {
    dryRun: true, totalContacts: 964, eligible: 0, skipped: 0, noEmail: 0, suppressed: 0,
    alreadyInAnotherSequence: 964, filteredOut: 0, awaitingPipeline: 0, missingContent: 0,
    leadsWithoutContact: 0, conflictingSequences: [{ id: 'cyberscore', name: 'cyberscore', count: 964 }],
  });
  equal(client.reads.some((table) => table.includes('mailbox')), false);
});

Deno.test('partial audience counts are disjoint and a contact without a lead can be ready', async () => {
  const ids = ['filtered', 'pipeline', 'suppressed', 'no-email', 'busy', 'duplicate', 'ready', 'new'];
  const client = readOnlyClient({
    crm_contacts: ids.map((id) => contact(id, id === 'suppressed' ? { status: 'bounced' } : id === 'no-email' ? { primary_email: null } : {})),
    leads: ids.filter((id) => id !== 'new').map(lead),
    email_sequence_enrollments: [enrollment('busy'), enrollment('duplicate', 'target', 'completed'), enrollment('suppressed'), enrollment('no-email')],
    email_sequences: [{ id: 'cyberscore', name: 'cyberscore', organization_id: 'org', status: 'active' }],
  }, {
    filter_contact_ids_by_criteria: ids.filter((id) => id !== 'filtered'),
    filter_contact_ids_by_pipeline_gate: ids.filter((id) => !['filtered', 'pipeline'].includes(id)),
  });
  const result = await previewEnrollment(client, options(ids, { listIds: ['list'], sequence: { enroll_filter_criteria: { company: 'hvac' } } }));
  equal(result.totalContacts, 8);
  equal(result.eligible, 2);
  equal(result.skipped, 3); // filter + pipeline + existing target enrollment
  equal([result.filteredOut, result.awaitingPipeline, result.suppressed, result.noEmail, result.alreadyInAnotherSequence], [1, 1, 1, 1, 1]);
  equal(result.conflictingSequences, [{ id: 'cyberscore', name: 'cyberscore', count: 1 }]);
});

Deno.test('generated content uses the actual admission guard before conflicts and duplicates', async () => {
  const ids = ['missing', 'subject-only', 'written', 'new-written'];
  const client = readOnlyClient({
    crm_contacts: ids.map((id) => contact(id)), leads: ids.slice(0, 3).map(lead),
    email_sequence_enrollments: [enrollment('missing'), enrollment('subject-only', 'target')],
  });
  const result = await previewEnrollment(client, options(ids, {
    sequence: { steps: [{ subject: '{{email_subject_1}}', body: '{{custom_email_1_body}}' }] },
    customDataByContactId: {
      'subject-only': { custom_email_1_subject: 'Subject' },
      written: { custom_email_1_subject: 'Subject', custom_email_1_body: 'Body' },
      'new-written': { custom_email_1_subject: 'Subject', custom_email_1_body: 'Body' },
    },
  }));
  equal([result.eligible, result.missingContent, result.alreadyInAnotherSequence, result.skipped], [2, 2, 0, 0]);
});

Deno.test('overlapping conflicts count each contact once overall and once per sequence', async () => {
  const client = readOnlyClient({
    crm_contacts: [contact('one'), contact('foreign', { organization_id: 'other-org' })], leads: [lead('one')],
    email_sequence_enrollments: [enrollment('one'), enrollment('one'), enrollment('one', 'other'), enrollment('one', 'target')],
    email_sequences: [
      { id: 'cyberscore', name: 'cyberscore', organization_id: 'org', status: 'active' },
      { id: 'other', name: 'Other', organization_id: 'org', status: 'active' },
    ],
  });
  const result = await previewEnrollment(client, options(['one', 'one', 'foreign']));
  equal([result.totalContacts, result.alreadyInAnotherSequence, result.skipped], [1, 1, 0]);
  equal(result.conflictingSequences.map((sequence) => sequence.count), [1, 1]);
  const concurrent = await previewEnrollment(client, options(['one'], { enforceExclusivity: false }));
  equal([concurrent.eligible, concurrent.alreadyInAnotherSequence, concurrent.skipped], [0, 0, 1]);
  equal(concurrent.conflictingSequences, []);
});

Deno.test('preview surfaces gate and query failures instead of reporting zero ready', async () => {
  const client = readOnlyClient({ crm_contacts: [contact('one')] }, { filter_contact_ids_by_criteria: new Error('Gate unavailable') });
  let message = '';
  try {
    await previewEnrollment(client, options(['one'], { sequence: { enroll_filter_criteria: { tag: 'hvac' } } }));
  } catch (error) {
    message = (error as Error).message;
  }
  equal(message, 'Gate unavailable');
  let queryFailed = false;
  try {
    await previewEnrollment({ rpc() { return Promise.resolve({ data: null, error: new Error('Database unavailable') }); } }, options(['one']));
  } catch (error) {
    queryFailed = (error as Error).message === 'Database unavailable';
  }
  equal(queryFailed, true);
});

Deno.test('safe nested preview contract cannot supply an audience to a legacy enrollment handler', () => {
  const request = { sequenceId: 'target', organizationId: 'org', dryRun: true, previewSource: { listIds: ['list'], contactIds: ['one'], organizationId: 'other', sequenceId: 'other' } };
  equal(['contactIds', 'listIds', 'listId', 'sourceSequenceId'].some((key) => key in request), false);
  const parsed = enrollmentRequestBody(request);
  equal([parsed.organizationId, parsed.sequenceId, parsed.listIds], ['org', 'target', ['list']]);
  for (const field of ['contactIds', 'listIds', 'listId', 'sourceSequenceId']) {
    let rejected = false;
    try { enrollmentRequestBody({ ...request, [field]: ['one'] }); } catch { rejected = true; }
    equal(rejected, true);
  }
  const actual = { sequenceId: 'target', listId: 'list' };
  equal(enrollmentRequestBody(actual), actual);
});

Deno.test('empty owned audience gives a complete zero preview without mailbox or write calls', async () => {
  const result = await previewEnrollment(readOnlyClient({}), options([], { leadsWithoutContact: 2 }));
  equal([result.totalContacts, result.eligible, result.skipped, result.leadsWithoutContact], [0, 0, 0, 2]);
  equal(result.conflictingSequences, []);
});

Deno.test('a lead held by a PAUSED sequence stays eligible instead of reading as a conflict', async () => {
  // Regression: 964 leads whose only enrollment sat in a paused sequence were
  // reported as "already active in another sequence" and could not be enrolled
  // anywhere. A paused sequence never sends, so it cannot conflict.
  const ids = ['parked'];
  const client = readOnlyClient({
    crm_contacts: ids.map((id) => contact(id)),
    leads: ids.map(lead),
    email_sequence_enrollments: ids.map((id) => enrollment(id, 'cyberscore', 'active')),
    email_sequences: [{ id: 'cyberscore', name: 'cyberscore', organization_id: 'org', status: 'paused' }],
  });
  const result = await previewEnrollment(client, options([...ids, ...ids]));
  equal(
    [result.totalContacts, result.eligible, result.alreadyInAnotherSequence, result.conflictingSequences],
    [1, 1, 0, []],
  );
});
