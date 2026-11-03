/**
 * Example usage of the Payload Builder
 * This shows how semantic input gets converted to provider-specific payloads
 */

import { buildPayload, computeDimensions } from './payloadBuilder';
import { NormalizedCapabilities, UserInput } from '@/types/payloadBuilder';

// Example 1: Stability SDXL (Text-to-Image)
export const stabilitySDXLExample = () => {
  const normalizedCapabilities: NormalizedCapabilities = {
    roles: {
      main_prompt: { provider_key: 'prompt', type: 'string', required: true },
      negative_prompt: { provider_key: 'negative_prompt', type: 'string', required: false },
      seed: { provider_key: 'seed', type: 'integer', required: false },
      steps: { provider_key: 'num_inference_steps', type: 'integer', required: false },
      guidance: { provider_key: 'guidance_scale', type: 'number', required: false },
      aspect_ratio: { provider_key: 'aspect_ratio', type: 'string', required: false },
      resolution_tier: { provider_key: null, type: 'computed', required: false },
    },
    input_types: ['text'],
    output_types: ['image'],
    supports_pipelines: ['text-to-image'],
    parameter_constraints: {
      steps: { min: 1, max: 100, default: 20 },
      guidance: { min: 0, max: 20, default: 7.5 },
    },
  };

  const userInput: UserInput = {
    main_prompt: 'A majestic dragon flying over mountains',
    negative_prompt: 'blurry, low quality',
    seed: 42,
    steps: 30,
    guidance: 7.5,
    aspect_ratio: '16:9',
    resolution_tier: 'HD',
  };

  const result = buildPayload(normalizedCapabilities, userInput);

  console.log('Stability SDXL Payload:', result.payload);
  // Expected output:
  // {
  //   prompt: "A majestic dragon flying over mountains",
  //   negative_prompt: "blurry, low quality",
  //   seed: 42,
  //   num_inference_steps: 30,
  //   guidance_scale: 7.5,
  //   aspect_ratio: "16:9",
  //   width: 1024,
  //   height: 576
  // }

  return result;
};

// Example 2: Flux Schnell (Fast Text-to-Image)
export const fluxSchnellExample = () => {
  const normalizedCapabilities: NormalizedCapabilities = {
    roles: {
      main_prompt: { provider_key: 'prompt', type: 'string', required: true },
      steps: { 
        provider_key: 'num_inference_steps', 
        type: 'integer', 
        required: false,
        transform: { type: 'multiply', factor: 1 } // No transform needed
      },
      aspect_ratio: { provider_key: 'aspect_ratio', type: 'string', required: false },
      resolution_tier: { provider_key: null, type: 'computed', required: false },
    },
    input_types: ['text'],
    output_types: ['image'],
    supports_pipelines: ['text-to-image'],
    parameter_constraints: {
      steps: { min: 1, max: 4, default: 4 }, // Flux is fast, only needs 4 steps
    },
  };

  const userInput: UserInput = {
    main_prompt: 'A cyberpunk city at night with neon lights',
    steps: 4,
    aspect_ratio: '9:16',
    resolution_tier: 'FHD',
  };

  const result = buildPayload(normalizedCapabilities, userInput);

  console.log('Flux Schnell Payload:', result.payload);
  // Expected output:
  // {
  //   prompt: "A cyberpunk city at night with neon lights",
  //   num_inference_steps: 4,
  //   aspect_ratio: "9:16",
  //   width: 1080,
  //   height: 1920
  // }

  return result;
};

// Example 3: fal LTX Video (Text-to-Video)
export const falLTXVideoExample = () => {
  const normalizedCapabilities: NormalizedCapabilities = {
    roles: {
      main_prompt: { provider_key: 'prompt', type: 'string', required: true },
      negative_prompt: { provider_key: 'negative_prompt', type: 'string', required: false },
      seed: { provider_key: 'seed', type: 'integer', required: false },
      steps: { provider_key: 'num_inference_steps', type: 'integer', required: false },
      guidance: { provider_key: 'guidance_scale', type: 'number', required: false },
      aspect_ratio: { provider_key: 'aspect_ratio', type: 'string', required: false },
      resolution_tier: { provider_key: null, type: 'computed', required: false },
      image_input: { 
        provider_key: 'image', 
        type: 'uri', 
        required: false,
        accepts: ['image/png', 'image/jpeg']
      },
    },
    input_types: ['text', 'image'],
    output_types: ['video'],
    supports_pipelines: ['text-to-video', 'image-to-video'],
    parameter_constraints: {
      steps: { min: 10, max: 50, default: 25 },
      guidance: { min: 1, max: 20, default: 7 },
    },
  };

  const userInput: UserInput = {
    main_prompt: 'Ocean waves crashing on a beach at sunset',
    negative_prompt: 'static, frozen',
    seed: 12345,
    steps: 25,
    guidance: 7,
    aspect_ratio: '16:9',
    resolution_tier: 'HD',
  };

  const result = buildPayload(normalizedCapabilities, userInput);

  console.log('fal LTX Video Payload:', result.payload);
  // Expected output:
  // {
  //   prompt: "Ocean waves crashing on a beach at sunset",
  //   negative_prompt: "static, frozen",
  //   seed: 12345,
  //   num_inference_steps: 25,
  //   guidance_scale: 7,
  //   aspect_ratio: "16:9",
  //   width: 1024,
  //   height: 576
  // }

  return result;
};

// Example 4: Testing dimension computation
export const dimensionComputationExamples = () => {
  const examples = [
    { aspect_ratio: '16:9', resolution_tier: 'SD' },
    { aspect_ratio: '16:9', resolution_tier: 'HD' },
    { aspect_ratio: '16:9', resolution_tier: 'FHD' },
    { aspect_ratio: '1:1', resolution_tier: 'HD' },
    { aspect_ratio: '9:16', resolution_tier: 'HD' },
    { aspect_ratio: '21:9', resolution_tier: 'UHD' },
  ];

  console.log('Dimension Computation Examples:');
  examples.forEach(({ aspect_ratio, resolution_tier }) => {
    const dims = computeDimensions(aspect_ratio, resolution_tier as any);
    console.log(`${aspect_ratio} @ ${resolution_tier}: ${dims?.width}x${dims?.height}`);
  });

  // Expected output:
  // 16:9 @ SD: 512x288
  // 16:9 @ HD: 1024x576
  // 16:9 @ FHD: 1920x1080
  // 1:1 @ HD: 1024x1024
  // 9:16 @ HD: 576x1024
  // 21:9 @ UHD: 2560x1097
};

// Example 5: Recipe defaults + user overrides
export const recipeDefaultsExample = () => {
  const normalizedCapabilities: NormalizedCapabilities = {
    roles: {
      main_prompt: { provider_key: 'prompt', type: 'string', required: true },
      steps: { provider_key: 'num_inference_steps', type: 'integer', required: false },
      guidance: { provider_key: 'guidance_scale', type: 'number', required: false },
      seed: { provider_key: 'seed', type: 'integer', required: false },
    },
    input_types: ['text'],
    output_types: ['image'],
    supports_pipelines: ['text-to-image'],
    parameter_constraints: {
      steps: { min: 1, max: 100, default: 20 },
      guidance: { min: 0, max: 20, default: 7.5 },
    },
  };

  // Recipe provides defaults
  const recipeDefaults = {
    steps: 50,
    guidance: 10,
    seed: 999,
  };

  // User only provides prompt and overrides steps
  const userInput: UserInput = {
    main_prompt: 'A beautiful sunset',
    steps: 30, // Override recipe default
  };

  const result = buildPayload(normalizedCapabilities, userInput, recipeDefaults);

  console.log('Recipe + User Input Payload:', result.payload);
  // Expected output:
  // {
  //   prompt: "A beautiful sunset",
  //   num_inference_steps: 30,  // User override
  //   guidance_scale: 10,        // From recipe
  //   seed: 999                  // From recipe
  // }

  return result;
};
