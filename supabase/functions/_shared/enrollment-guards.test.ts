import { findLeadsActiveInOtherSequences } from './enrollment-guards.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

type Row = Record<string, any>;

/** Minimal PostgREST-shaped stub: select + in/eq/neq, awaited directly. */
function stubClient(tables: Record<string, Row[]>) {
  const reads: string[] = [];
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
        then(resolve: any) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
      };
      return q;
    },
  };
}

Deno.test('only a LIVE other sequence makes a lead busy', async () => {
  const client = stubClient({
    email_sequences: [
      { id: 'live', organization_id: 'org', status: 'active' },
      { id: 'parked', organization_id: 'org', status: 'paused' },
      { id: 'draft', organization_id: 'org', status: 'draft' },
      { id: 'other-org-live', organization_id: 'other-org', status: 'active' },
    ],
    email_sequence_enrollments: [
      { lead_id: 'lead-live', sequence_id: 'live', status: 'active' },
      { lead_id: 'lead-parked', sequence_id: 'parked', status: 'active' },
      { lead_id: 'lead-draft', sequence_id: 'draft', status: 'active' },
      { lead_id: 'lead-foreign', sequence_id: 'other-org-live', status: 'active' },
      { lead_id: 'lead-completed', sequence_id: 'live', status: 'completed' },
      { lead_id: 'lead-target', sequence_id: 'target', status: 'active' },
    ],
  });

  const busy = await findLeadsActiveInOtherSequences(
    client,
    'org',
    ['lead-live', 'lead-parked', 'lead-draft', 'lead-foreign', 'lead-completed', 'lead-target'],
    'target',
  );

  // Paused/draft holders, non-active rows, the target sequence itself and
  // another org's sequence all leave the lead enrollable. This is the rule that
  // stranded 964 leads behind a paused "cyberscore" on 2026-09-29.
  equal([...busy], ['lead-live']);
});

Deno.test('an org with no live sequence blocks nothing', async () => {
  const client = stubClient({
    email_sequences: [{ id: 'parked', organization_id: 'org', status: 'paused' }],
    email_sequence_enrollments: [{ lead_id: 'lead-parked', sequence_id: 'parked', status: 'active' }],
  });
  equal([...await findLeadsActiveInOtherSequences(client, 'org', ['lead-parked'], 'target')], []);
});

Deno.test('an empty lead list short-circuits without querying', async () => {
  const client = stubClient({});
  equal([...await findLeadsActiveInOtherSequences(client, 'org', [], 'target')], []);
  equal(client.reads, []);
});
