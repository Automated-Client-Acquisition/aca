import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildSignalPresentation } from './presentation.ts';

Deno.test('hiring presentation preserves concrete role and volume details', () => {
  const result = buildSignalPresentation('Gusto', 'hiring', {
    new_role_count: 1,
    total_open_roles: 92,
    roles: [{ title: 'UX Researcher, Quantitative', location: 'Denver, CO' }],
  });
  assertEquals(result.title, 'Gusto opened 1 new role');
  assertStringIncludes(result.detail, 'UX Researcher, Quantitative (Denver, CO)');
  assertStringIncludes(result.detail, '92 total open roles');
  assertEquals(result.details.role_titles, ['UX Researcher, Quantitative']);
});

Deno.test('explicit source copy wins and malformed roles degrade safely', () => {
  assertEquals(buildSignalPresentation('Acme', 'funding', {
    headline: 'Acme raises Series A',
    summary: 'Acme raised $12M led by Example Ventures.',
  }).detail, 'Acme raised $12M led by Example Ventures.');
  assertEquals(buildSignalPresentation('Acme', 'hiring', { roles: ['bad'] }).title,
    'Acme opened 0 new roles');
});

Deno.test('SEC funding presentation exposes the financed amount and filing context', () => {
  const result = buildSignalPresentation('Arpio', 'funding', {
    total_amount_sold: 15_862_978,
    total_offering_amount: 15_862_978,
    form_type: 'D',
    investor_count: 9,
  });
  assertEquals(result.title, 'Arpio disclosed $15.9M in funding');
  assertStringIncludes(result.detail, 'D filing');
  assertStringIncludes(result.detail, '9 reported investors');
  assertEquals(result.amountUsd, 15_862_978);
  assertEquals(result.amountLabel, '$15.9M');
});

Deno.test('acquisition presentation preserves the SEC filing items without overstating the event', () => {
  const result = buildSignalPresentation('Global Net Lease', 'acquisition', {
    form_type: '8-K',
    items: ['Completion of Acquisition or Disposition of Assets', 'Financial Statements and Exhibits'],
  });
  assertEquals(result.title, 'Global Net Lease filed an acquisition-related 8-K');
  assertStringIncludes(result.detail, 'Completion of Acquisition or Disposition of Assets');
  assertStringIncludes(result.whyItMatters!, 'integration');
});
