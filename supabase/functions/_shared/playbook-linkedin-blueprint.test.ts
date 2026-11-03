// Run: deno test --no-check supabase/functions/_shared/playbook-linkedin-blueprint.test.ts
// (--no-check: the starter-pack file's `@/` type imports only resolve under Vite.)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { playbookLinkedInBlueprintFields, playbookLinkedInBlueprintName } from './playbook-linkedin-blueprint.ts';
import {
  findSingleBracePlaceholders,
  findUnbalancedSections,
  findUnknownVariables,
} from './blueprint-variables.ts';
import { getStarterBlueprintById } from '../../../src/data/starterPackBlueprints.ts';

const fields = playbookLinkedInBlueprintFields();

Deno.test('stays a copy of the LinkedIn Post starter', () => {
  const starter = getStarterBlueprintById('starter-linkedin-post');
  assert(starter, 'starter-linkedin-post missing from starterPackBlueprints.ts');
  assertEquals(fields.pipeline, starter.pipeline);
  assertEquals(fields.master_prompt, starter.master_prompt);
  assertEquals(fields.image_prompt, starter.image_prompt);
  assertEquals(fields.structure, starter.structure);
  assertEquals(fields.model_config, starter.model_config);
});

Deno.test('is runnable: social_media_post with text + image models and a topic slot', () => {
  assertEquals(fields.pipeline, 'social_media_post');
  assertEquals(fields.is_active, true);
  assertEquals(fields.skip_image_generation, false);
  const mc = fields.model_config as Record<string, { model_id?: string }>;
  assert(mc.text_llm?.model_id, 'text_llm missing');
  assert(mc.image_generator?.model_id, 'image_generator missing (job fails at the image stage)');
  const slots = (fields.structure.slots as Array<{ key: string; required: boolean }>);
  assert(slots.some((s) => s.key === 'topic' && s.required));
});

Deno.test('prompts only use variables the pipeline resolves', () => {
  assertEquals(findUnknownVariables(fields.master_prompt, fields.image_prompt), []);
  assertEquals(findUnbalancedSections(fields.master_prompt, fields.image_prompt), []);
  assertEquals(findSingleBracePlaceholders(fields.master_prompt, fields.image_prompt), []);
});

Deno.test('returns a fresh object each call', () => {
  const a = playbookLinkedInBlueprintFields();
  (a.structure.slots as unknown[]).push({ key: 'x' });
  assertEquals((playbookLinkedInBlueprintFields().structure.slots as unknown[]).length, 2);
});

Deno.test('name keeps the " · LinkedIn blueprint" suffix', () => {
  assertEquals(playbookLinkedInBlueprintName('AI agency'), 'AI agency · LinkedIn blueprint');
  assertEquals(playbookLinkedInBlueprintName(undefined), 'Daily · LinkedIn blueprint');
  assertEquals(playbookLinkedInBlueprintName(''), 'Daily · LinkedIn blueprint');
});
