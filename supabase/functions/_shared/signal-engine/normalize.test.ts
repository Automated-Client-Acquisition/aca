import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  domainFromBoardUrl,
  namesMatch,
  normalizeCompanyName,
  normalizeDomain,
} from './normalize.ts';

Deno.test('company normalization removes only legal suffix noise', () => {
  assertEquals(normalizeCompanyName('Acme Holdings, Inc.'), 'acme holdings');
  assertEquals(namesMatch('Acme, Inc.', 'Acme'), true);
  assertEquals(namesMatch('Sugarfina Corp', 'Sugarfina Australia'), false);
  assertEquals(namesMatch('River Mobility', 'Driver Mobility'), false);
});

Deno.test('domain normalization rejects junk and never treats ATS hosts as employers', () => {
  assertEquals(normalizeDomain('https://www.rivermobility.com/careers'), 'rivermobility.com');
  assertEquals(normalizeDomain('not a domain'), null);
  assertEquals(domainFromBoardUrl('https://jobs.ashbyhq.com/ramp'), null);
  assertEquals(domainFromBoardUrl('https://stripe.com/jobs'), 'stripe.com');
});
