/**
 * Behaviour lock for AI-output sanitizing.
 *
 * Run: deno test --allow-read supabase/functions/_shared/sanitize-ai-output.test.ts
 * (or `npm run test:sanitize`)
 *
 * Em dashes are the loudest "a machine wrote this" tell in cold outreach and
 * models emit them no matter what the prompt says, so the replacement rules are
 * pinned here. The second half of the file is a drift check: it fails if any
 * other function hand-rolls its own dash stripping instead of using the shared
 * rule, which is exactly how li-score-and-draft ended up emitting "It works ,
 * try it" while every other path emitted something different.
 */

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { normalizeDashes, sanitizeAIOutput } from './sanitize-ai-output.ts';

const DASH_CASES: Array<[string, string]> = [
  // A new independent clause becomes its own sentence, not a comma splice.
  ['We fixed it — we can help', 'We fixed it. We can help'],
  ['It works — try it', 'It works. Try it'],
  ['Curious — how are you handling it?', 'Curious. How are you handling it?'],
  ['Hi Ed — I saw the Series B', 'Hi Ed. I saw the Series B'],
  ['Two things — speed and cost', 'Two things. Speed and cost'],
  // Continuations stay in the same sentence.
  ['Acme — a fintech in Berlin', 'Acme, a fintech in Berlin'],
  ['Takes 10 minutes — no setup', 'Takes 10 minutes, no setup'],
  ['Nice work on the raise — and the hiring push', 'Nice work on the raise, and the hiring push'],
  // Paired parentheticals become paired commas.
  ['Acme — a fintech — is hiring', 'Acme, a fintech, is hiring'],
  // Ranges and compounds keep a hyphen.
  ['Ships in 10—20 days', 'Ships in 10-20 days'],
  ['5 – 7 days', '5-7 days'],
  ['state—of—the—art tooling', 'state-of-the-art tooling'],
  // Dangling dashes just go.
  ['Worth a look —', 'Worth a look'],
  // Math minus is a hyphen, never a sentence break.
  ['Down to −5 degrees', 'Down to -5 degrees'],
  ['A −12% swing', 'A -12% swing'],
  // The ASCII stand-in models reach for when told to avoid em dashes.
  ['It works -- try it', 'It works. Try it'],
  ['Acme --- a fintech', 'Acme, a fintech'],
  // A separator line of dashes is not punctuation.
  ['above\n---\nbelow', 'above\n---\nbelow'],
  // Untouched when there is nothing to do.
  ['No dashes here at all', 'No dashes here at all'],
  ['A well-known hyphenated-word stays', 'A well-known hyphenated-word stays'],
];

for (const [input, expected] of DASH_CASES) {
  Deno.test(`normalizeDashes: ${input}`, () => {
    assertEquals(normalizeDashes(input), expected);
  });
}

Deno.test('normalizeDashes leaves no em or en dash behind', () => {
  for (const [input] of DASH_CASES) {
    const out = normalizeDashes(input);
    assertEquals(/[—–]/.test(out), false, `dash survived in: ${out}`);
  }
});

Deno.test('sanitizeAIOutput applies dash rules end to end', () => {
  assertEquals(
    sanitizeAIOutput('Here\'s the draft: Acme raised — congrats — and you are hiring'),
    'Acme raised, congrats, and you are hiring',
  );
});

Deno.test('normalizeDashes is idempotent', () => {
  for (const [input] of DASH_CASES) {
    const once = normalizeDashes(input);
    assertEquals(normalizeDashes(once), once);
  }
});

// ── Drift check ────────────────────────────────────────────────────────────
// Any file replacing an em/en dash by hand is a second, divergent rule.
Deno.test('no hand-rolled em dash replacement outside this module', async () => {
  const offenders: string[] = [];
  const repoRoot = new URL('../../../', import.meta.url).pathname;
  // Both the Deno edge functions and the Fly workers. The workers/ half matters
  // most: its sanitize.ts is a hand-maintained port, and it silently kept the
  // old blanket-comma rule while the Deno original moved on.
  const roots = ['supabase/functions', 'workers'];
  // Literal dashes AND \uXXXX escapes — the escaped form is what hid the drift.
  const HAND_ROLLED = /\.replace\(\s*\/\[?(?:[—–]|\\u201[34])/;

  const walk = async (dir: string) => {
    let entries;
    try {
      entries = Deno.readDir(dir);
    } catch {
      return;
    }
    for await (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        await walk(path);
      } else if (entry.name.endsWith('.ts') && !entry.name.startsWith('sanitize')) {
        const source = await Deno.readTextFile(path);
        if (HAND_ROLLED.test(source)) offenders.push(path.replace(repoRoot, ''));
      }
    }
  };

  for (const root of roots) await walk(`${repoRoot}${root}`);

  assertEquals(
    offenders,
    [],
    `These files strip dashes themselves instead of calling normalizeDashes(): ${offenders.join(', ')}`,
  );
});

// The Fly workers each ship their own bundle and cannot import from _shared, so
// the rule is duplicated into generated dash-rules.ts files. Generated, not
// hand-written, because a hand-written port is what silently kept the old rule.
Deno.test('generated worker ports match the canonical rule', async () => {
  const repoRoot = new URL('../../../', import.meta.url).pathname;
  const canonical = await Deno.readTextFile(`${repoRoot}supabase/functions/_shared/sanitize-ai-output.ts`);
  const extract = (source: string, marker: string) => {
    const start = source.indexOf(marker);
    const lines = source.slice(start).split('\n');
    const out: string[] = [];
    for (const line of lines) {
      out.push(line);
      if (line === '}' || line === ']);') break;
    }
    return out.join('\n');
  };
  const expected = `${extract(canonical, 'const CLAUSE_CONTINUATIONS')}\n\n${extract(canonical, 'export function normalizeDashes')}\n`;

  for (const worker of ['carousel-renderer', 'text-generator', 'imap-poller']) {
    const port = await Deno.readTextFile(`${repoRoot}workers/${worker}/src/dash-rules.ts`);
    assertEquals(
      port.endsWith(expected),
      true,
      `workers/${worker}/src/dash-rules.ts is stale — run: node scripts/generate-dash-ports.mjs`,
    );
  }
});
