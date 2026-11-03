import test from 'node:test';
import assert from 'node:assert/strict';
import { getFirmographicsSummary } from './firmographics-display.ts';

test('projects visible MoltSets firmographics from flat enrichment data', () => {
  assert.deepEqual(
    getFirmographicsSummary({
      employee_count: 46,
      industry: 'Manufacturing',
      annual_revenue: '$10M - $20M',
      seniority: 'Director',
      enrichment_source: 'moltsets',
    }),
    {
      employees: '46',
      industry: 'Manufacturing',
      revenue: '$10M - $20M',
      seniority: 'Director',
      source: 'MoltSets',
    },
  );
});

test('falls back to nested company values and custom fields', () => {
  assert.deepEqual(
    getFirmographicsSummary(
      { company: { size: '11-50', revenue: '$5M', industry: 'IT Services' } },
      { firmographics_source: 'moltsets' },
    ),
    {
      employees: '11-50',
      industry: 'IT Services',
      revenue: '$5M',
      seniority: undefined,
      source: 'MoltSets',
    },
  );
});
