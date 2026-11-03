export interface AutopilotReferenceVariant {
  shorthand: string;
  paths: Record<string, unknown>;
  images: string[];
}

/**
 * Add one exploded library variant without discarding references accumulated
 * from the other selected libraries (for example, style images plus a face).
 */
export function mergeAutopilotReferenceVariant(
  selectedPaths: Record<string, Record<string, unknown>>,
  imageInputs: Record<string, string[]>,
  variant: AutopilotReferenceVariant,
): {
  selectedPaths: Record<string, Record<string, unknown>>;
  imageInputs: Record<string, string[]>;
} {
  return {
    selectedPaths: {
      ...selectedPaths,
      ...(Object.keys(variant.paths).length > 0
        ? { [variant.shorthand]: variant.paths }
        : {}),
    },
    imageInputs: {
      ...imageInputs,
      ...(variant.images.length > 0
        ? { [variant.shorthand]: variant.images }
        : {}),
    },
  };
}

/**
 * Preserve the order inside each reference family while distributing limited
 * provider slots across families. This prevents four face photos from crowding
 * a selected style/composition reference out of a four-image model request.
 */
export function interleaveReferenceImageGroups(groups: string[][]): string[] {
  const populatedGroups = groups.filter((group) => group.length > 0);
  const seen = new Set<string>();
  const result: string[] = [];
  const maxLength = Math.max(0, ...populatedGroups.map((group) => group.length));

  for (let index = 0; index < maxLength; index += 1) {
    for (const group of populatedGroups) {
      const image = group[index];
      if (image && !seen.has(image)) {
        seen.add(image);
        result.push(image);
      }
    }
  }

  return result;
}
