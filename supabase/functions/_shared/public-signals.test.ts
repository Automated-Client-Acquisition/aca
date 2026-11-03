import { assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ACA_NATIVE_SOURCE, validatePushSignal, type PushSignalInput } from './public-signals.ts';

const validNative = (): PushSignalInput => ({
  company_name: 'Comet',
  signal_type: 'funding',
  source_url: 'https://www.sec.gov/Archives/edgar/data/123/example.xml',
  source_key: ACA_NATIVE_SOURCE,
  domain: 'comet.com',
  verified: true,
  published: true,
  quality_score: 0.9,
});

Deno.test('aca_native clears the publishing gate with verified canonical evidence', () => {
  validatePushSignal(validNative());
});

Deno.test('aca_native fails closed without verification, identity, or quality', () => {
  assertThrows(() => validatePushSignal({ ...validNative(), verified: false }));
  assertThrows(() => validatePushSignal({ ...validNative(), domain: null }));
  assertThrows(() => validatePushSignal({ ...validNative(), quality_score: 0.79 }));
  assertThrows(() => validatePushSignal({ ...validNative(), source_url: 'not-a-url' }));
});
