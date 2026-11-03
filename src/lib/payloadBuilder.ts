import {
  NormalizedCapabilities,
  UserInput,
  RecipeDefaults,
  BuildPayloadResult,
  AspectRatioDimensions,
  RESOLUTION_TIERS,
  ASPECT_RATIOS,
  TransformRule,
} from '@/types/payloadBuilder';

/**
 * Builds a provider-specific payload from normalized capabilities and user input
 * This is the core algorithm that maps semantic roles → provider parameters
 */
export function buildPayload(
  normalizedCapabilities: NormalizedCapabilities,
  userInput: UserInput,
  recipeDefaults: RecipeDefaults = {}
): BuildPayloadResult {
  const payload: Record<string, any> = {};
  const warnings: string[] = [];
  const missing_required: string[] = [];

  // Merge user input with recipe defaults (user input takes precedence)
  const mergedInput = { ...recipeDefaults, ...userInput };

  // Process each semantic role
  for (const [semanticRole, roleConfig] of Object.entries(normalizedCapabilities.roles)) {
    const { provider_key, required, transform } = roleConfig;

    // Skip if no provider key (unsupported by this model)
    if (provider_key === null) continue;

    // Get value from merged input
    let value = mergedInput[semanticRole];

    // Handle special computed roles
    if (semanticRole === 'resolution_tier' && !value) {
      // Compute width/height from aspect_ratio + resolution_tier
      const dimensions = computeDimensions(
        mergedInput.aspect_ratio,
        mergedInput.resolution_tier || 'HD'
      );
      if (dimensions) {
        // Some models want width/height, not resolution_tier
        payload.width = dimensions.width;
        payload.height = dimensions.height;
      }
      continue; // Skip further processing
    }

    // Check required parameters
    if (required && (value === undefined || value === null)) {
      missing_required.push(semanticRole);
      continue;
    }

    // Apply defaults from parameter_constraints if value not provided
    if (value === undefined || value === null) {
      const constraints = normalizedCapabilities.parameter_constraints?.[semanticRole];
      if (constraints?.default !== undefined) {
        value = constraints.default;
        console.log(`Applied default for ${semanticRole}: ${value}`);
      } else {
        // Skip if no value and no default
        continue;
      }
    }

    // Apply transforms
    if (transform) {
      try {
        value = applyTransform(value, transform, mergedInput);
      } catch (error) {
        warnings.push(`Transform failed for ${semanticRole}: ${error}`);
        continue;
      }
    }

    // Apply parameter constraints
    if (normalizedCapabilities.parameter_constraints?.[semanticRole]) {
      const constraints = normalizedCapabilities.parameter_constraints[semanticRole];
      value = applyConstraints(value, constraints, semanticRole, warnings);
    }

    // Set the provider parameter
    payload[provider_key] = value;
  }

  return {
    payload,
    warnings,
    missing_required,
  };
}

/**
 * Apply transform rules to convert semantic values → provider values
 */
function applyTransform(value: any, transform: TransformRule, fullInput: UserInput): any {
  switch (transform.type) {
    case 'multiply':
      if (typeof value === 'number' && transform.factor) {
        return value * transform.factor;
      }
      throw new Error(`Multiply transform requires numeric value and factor`);

    case 'divide':
      if (typeof value === 'number' && transform.factor) {
        return value / transform.factor;
      }
      throw new Error(`Divide transform requires numeric value and factor`);

    case 'enum':
      // Map to allowed enum values
      if (transform.values && !transform.values.includes(value)) {
        // Find closest match or use first value
        return transform.values[0];
      }
      return value;

    case 'boolean_invert':
      return !value;

    case 'string_template':
      // Replace {variable} placeholders
      if (typeof value === 'string' && transform.template) {
        return transform.template.replace(/\{(\w+)\}/g, (_, key) => {
          return fullInput[key] ?? '';
        });
      }
      return value;

    case 'computed':
      // Computed values handled separately (e.g., resolution_tier)
      return value;

    default:
      return value;
  }
}

/**
 * Apply parameter constraints (min, max, default)
 */
function applyConstraints(
  value: any,
  constraints: { min?: number; max?: number; default?: any },
  paramName: string,
  warnings: string[]
): any {
  if (typeof value === 'number') {
    if (constraints.min !== undefined && value < constraints.min) {
      warnings.push(`${paramName} below minimum (${constraints.min}), clamping`);
      return constraints.min;
    }
    if (constraints.max !== undefined && value > constraints.max) {
      warnings.push(`${paramName} above maximum (${constraints.max}), clamping`);
      return constraints.max;
    }
  }
  return value;
}

/**
 * Compute actual dimensions from aspect_ratio + resolution_tier
 */
export function computeDimensions(
  aspectRatio?: string,
  resolutionTier: string = 'HD'
): AspectRatioDimensions | null {
  if (!aspectRatio) return null;

  const ratio = ASPECT_RATIOS[aspectRatio];
  if (!ratio) return null;

  const baseSize = RESOLUTION_TIERS[resolutionTier] || RESOLUTION_TIERS.HD;

  // Calculate dimensions maintaining aspect ratio
  if (ratio.w >= ratio.h) {
    // Landscape or square
    const width = baseSize;
    const height = Math.round((baseSize * ratio.h) / ratio.w);
    return { width, height };
  } else {
    // Portrait
    const height = baseSize;
    const width = Math.round((baseSize * ratio.w) / ratio.h);
    return { width, height };
  }
}

/**
 * Validate that a payload has all required parameters
 */
export function validatePayload(
  payload: Record<string, any>,
  normalizedCapabilities: NormalizedCapabilities
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [role, config] of Object.entries(normalizedCapabilities.roles)) {
    if (config.required && config.provider_key) {
      if (!(config.provider_key in payload)) {
        errors.push(`Missing required parameter: ${role} (${config.provider_key})`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get default values from normalized capabilities
 */
export function getDefaultValues(
  normalizedCapabilities: NormalizedCapabilities
): Record<string, any> {
  const defaults: Record<string, any> = {};

  if (normalizedCapabilities.parameter_constraints) {
    for (const [role, constraints] of Object.entries(
      normalizedCapabilities.parameter_constraints
    )) {
      if (constraints.default !== undefined) {
        defaults[role] = constraints.default;
      }
    }
  }

  return defaults;
}
