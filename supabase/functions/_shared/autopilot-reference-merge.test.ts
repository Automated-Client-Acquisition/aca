import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  interleaveReferenceImageGroups,
  mergeAutopilotReferenceVariant,
} from './autopilot-reference-merge.ts';

Deno.test('an image-set variant retains the selected face and its paths', () => {
  const result = mergeAutopilotReferenceVariant(
    { character: { description: { included: true } } },
    { character: ['face-c'] },
    { shorthand: 'images', paths: {}, images: ['style-a'] },
  );

  assertEquals(result, {
    selectedPaths: { character: { description: { included: true } } },
    imageInputs: { character: ['face-c'], images: ['style-a'] },
  });
});

Deno.test('an empty variant does not erase accumulated references', () => {
  const result = mergeAutopilotReferenceVariant(
    { character: { description: { included: true } } },
    { character: ['face-c'] },
    { shorthand: 'images', paths: {}, images: [] },
  );

  assertEquals(result, {
    selectedPaths: { character: { description: { included: true } } },
    imageInputs: { character: ['face-c'] },
  });
});

Deno.test('a variant overrides only its own reference family', () => {
  const result = mergeAutopilotReferenceVariant(
    { character: { description: { included: true } }, images: { old: { included: true } } },
    { character: ['face-c'], images: ['style-old'] },
    { shorthand: 'images', paths: { new: { included: true } }, images: ['style-new'] },
  );

  assertEquals(result, {
    selectedPaths: {
      character: { description: { included: true } },
      images: { new: { included: true } },
    },
    imageInputs: { character: ['face-c'], images: ['style-new'] },
  });
});

Deno.test('limited reference slots include both face and style families', () => {
  const references = interleaveReferenceImageGroups([
    ['face-1', 'face-2', 'face-3', 'face-4'],
    ['style-1', 'style-2'],
  ]);

  assertEquals(references.slice(0, 4), ['face-1', 'style-1', 'face-2', 'style-2']);
});
