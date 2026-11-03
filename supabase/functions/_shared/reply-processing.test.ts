import {
  calculateOOOResumeAt,
  detectAutoReply,
  detectOutOfOffice,
} from './reply-processing.ts';
import { parseOOOReturnDate } from './ooo-date-parser.ts';

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test('OOO detection distinguishes temporary absence from generic automatic receipts', () => {
  assertEquals(
    detectOutOfOffice('Automatic reply', 'I am out of the office until Friday.'),
    true,
    'temporary absence should be OOO',
  );
  assertEquals(
    detectAutoReply('Automatic reply', 'We received your support request.'),
    true,
    'automatic receipt should still be an auto-reply',
  );
  assertEquals(
    detectOutOfOffice('Automatic reply', 'We received your support request.'),
    false,
    'generic receipt should not receive a timed OOO resume',
  );
  assertEquals(
    detectOutOfOffice('Automatic reply', 'I am on maternity leave until September 21st.'),
    true,
    'qualified leave should be OOO',
  );
  assertEquals(
    detectOutOfOffice('Automatic reply', 'I am currently away from the office.'),
    true,
    'away-from-office wording should be OOO',
  );
});

Deno.test('parsed Friday return resumes on Monday at 09:00 UTC', () => {
  const resumeAt = calculateOOOResumeAt(
    new Date('2026-09-18T15:30:00.000Z'),
    new Date('2026-09-14T08:00:00.000Z'),
  );
  assertEquals(
    resumeAt.toISOString(),
    '2026-09-21T09:00:00.000Z',
    'weekend should be skipped',
  );
});

Deno.test('missing return date falls back to seven business days', () => {
  const resumeAt = calculateOOOResumeAt(
    null,
    new Date('2026-09-14T08:00:00.000Z'),
  );
  assertEquals(
    resumeAt.toISOString(),
    '2026-09-23T09:00:00.000Z',
    'fallback should be bounded and skip weekends',
  );
});

Deno.test('OOO parser handles weekday-prefixed UK and named return dates', () => {
  const ukDate = parseOOOReturnDate('I am on leave until Monday 21st September.');
  assertEquals(ukDate?.getMonth(), 8, 'UK named date month');
  assertEquals(ukDate?.getDate(), 21, 'UK named date day');

  const commaDate = parseOOOReturnDate(
    'I will be out of the office until Tuesday, September 17th. Please contact my team.',
  );
  assertEquals(commaDate?.getMonth(), 8, 'weekday comma date month');
  assertEquals(commaDate?.getDate(), 17, 'explicit date should win over weekday calculation');

  const numericDate = parseOOOReturnDate('I am out of the office until Monday 21/09.');
  assertEquals(numericDate?.getMonth(), 8, 'day-first numeric month');
  assertEquals(numericDate?.getDate(), 21, 'day-first numeric day');
});

Deno.test('NDR classification only suppresses dead recipients', async () => {
  const { classifyNdr } = await import('./reply-processing.ts');

  const hard = classifyNdr(
    'Undeliverable: Quick question',
    "Delivery has failed to these recipients.\nRemote server returned '550 5.1.1 RESOLVER.ADR.RecipNotFound; not found'",
  );
  assertEquals(hard.sendLogStatus, 'bounced', 'unknown recipient is a bounce');
  assertEquals(hard.suppressRecipient, true, 'unknown recipient suppresses');

  const gmailHard = classifyNdr(
    'Delivery Status Notification (Failure)',
    "Address not found\nThe response was: 550 5.1.1 The email account that you tried to reach does not exist.",
  );
  assertEquals(gmailHard.suppressRecipient, true, 'Gmail address-not-found suppresses');

  const reputation = classifyNdr(
    'Delivery Status Notification (Failure)',
    'The response was: 550-5.7.1 [1.2.3.4] Our system has detected that this message is likely unsolicited mail. The message has been blocked.',
  );
  assertEquals(reputation.sendLogStatus, 'blocked', 'reputation block is not a bounce');
  assertEquals(reputation.suppressRecipient, false, 'reputation block keeps the lead');

  const tenant = classifyNdr(
    'Undeliverable: Hello',
    "Remote server returned '550 5.7.708 Service unavailable. Access denied, traffic not accepted from this IP.'",
  );
  assertEquals(tenant.suppressRecipient, false, '5.7.708 keeps the lead');

  const temporary = classifyNdr(
    'Delivery Status Notification (Delay)',
    '421 4.7.0 Try again later, closing connection.',
  );
  assertEquals(temporary.sendLogStatus, 'failed', 'temporary failure is not a bounce');
  assertEquals(temporary.suppressRecipient, false, 'temporary failure keeps the lead');

  const bare = classifyNdr('Undeliverable: Hi', 'Your message could not be delivered.');
  assertEquals(bare.suppressRecipient, false, 'NDR without recipient evidence keeps the lead');
});
