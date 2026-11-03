import type { Blueprint, PinnedLibraryElements, LibraryElementType } from "@/types/blueprint";

// Map shorthand names to full library table names
const SHORTHAND_MAP: Record<string, LibraryElementType> = {
  'product': 'library_products',
  'brand': 'library_brand_voices',
  'brand_voice': 'library_brand_voices',
  'character': 'library_characters',
  'block': 'library_blocks',
  'icp': 'library_icps',
};

// Map library tables to their image field names
const IMAGE_FIELD_MAP: Record<string, string> = {
  'library_products': 'images',
  'library_characters': 'reference_images',
  'library_brand_voices': 'reference_images',
  'library_blocks': 'images',
  'library_icps': 'reference_images',
};

// Reverse map: full table name to shorthand
const TABLE_TO_SHORTHAND: Record<string, string> = {
  'library_products': 'product',
  'library_brand_voices': 'brand',
  'library_characters': 'character',
  'library_blocks': 'block',
  'library_icps': 'icp',
};

export interface ImageUsageAnalysis {
  table: string;
  shorthand: string;
  images: string[];
  willBeUsed: boolean;
  reason: 'user_selected' | 'blueprint_reference' | 'user_excluded';
  referencedVariable?: string; // e.g., "{{product.images}}"
}

/**
 * Extract all image-related variable references from a prompt
 * Looks for patterns like {{product.images}}, {{character.reference_images}}, etc.
 */
function extractImageVariableReferences(prompt: string): Map<string, string> {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = Array.from(prompt.matchAll(regex));
  const imageRefs = new Map<string, string>(); // table -> variable string

  matches.forEach((match) => {
    const key = match[1].trim().replace(/^\?/, ''); // Remove optional marker
    const dotIndex = key.indexOf('.');

    if (dotIndex > 0) {
      const tableRef = key.substring(0, dotIndex);
      const fieldName = key.substring(dotIndex + 1);

      // Map shorthand to full table name
      const fullTableName = SHORTHAND_MAP[tableRef] || tableRef;
      const expectedImageField = IMAGE_FIELD_MAP[fullTableName];

      // Check if this field is an image field
      if (expectedImageField && fieldName === expectedImageField) {
        imageRefs.set(fullTableName, `{{${key}}}`);
      }

      // Also check for generic "images" reference
      if (fieldName === 'images' || fieldName === 'reference_images' || fieldName === 'logo') {
        if (!imageRefs.has(fullTableName)) {
          imageRefs.set(fullTableName, `{{${key}}}`);
        }
      }
    }
  });

  return imageRefs;
}

/**
 * Check if a blueprint has any image-generating stages
 * This helps determine if image references are even relevant
 */
export function blueprintUsesImages(blueprint: Blueprint): boolean {
  const imageUsingPipelines = [
    'social_media_post',
    'instagram_carousel',
    'ugc_video',
    'generative_video_oneshot',
    'storyboard_video_longform',
    'rich_article',
  ];

  return imageUsingPipelines.includes(blueprint.pipeline || '');
}

/**
 * Analyze which selected images will be used.
 *
 * KEY BEHAVIOR: If a user explicitly selected images in the Library step,
 * those images WILL be used by default. The user's explicit selection is
 * the primary signal of intent.
 *
 * The blueprint variable reference is informational - it shows whether
 * the blueprint also references images in prompts, but doesn't gate usage.
 */
export function analyzeImageUsage(
  blueprint: Blueprint,
  pinnedElements: PinnedLibraryElements,
  excludeImages: boolean = false
): ImageUsageAnalysis[] {
  const results: ImageUsageAnalysis[] = [];

  // Combine master_prompt and image_prompt for analysis
  const combinedPrompt = [
    blueprint.master_prompt || '',
    blueprint.image_prompt || '',
  ].join('\n');

  // Extract image variable references from the blueprint (informational)
  const imageReferences = extractImageVariableReferences(combinedPrompt);

  // Analyze each library type that has selected images
  for (const [table, config] of Object.entries(pinnedElements)) {
    const images: string[] = [];

    // Collect all selected images for this library type
    for (const [, elementConfig] of Object.entries(config.elements)) {
      const selectedImages = elementConfig.selected_images || [];
      images.push(...selectedImages);
    }

    // Skip if no images selected for this type
    if (images.length === 0) continue;

    const shorthand = TABLE_TO_SHORTHAND[table] || table;
    const referencedVariable = imageReferences.get(table);
    const isReferenced = !!referencedVariable;

    // Default: selected images ARE used (user explicitly chose them)
    // Only exclude if user explicitly unchecks (future feature)
    let willBeUsed = !excludeImages;
    let reason: ImageUsageAnalysis['reason'];

    if (excludeImages) {
      willBeUsed = false;
      reason = 'user_excluded';
    } else if (isReferenced) {
      willBeUsed = true;
      reason = 'blueprint_reference';
    } else {
      // Selected but not in blueprint - still use them!
      willBeUsed = true;
      reason = 'user_selected';
    }

    results.push({
      table,
      shorthand,
      images,
      willBeUsed,
      reason,
      referencedVariable,
    });
  }

  return results;
}

/**
 * Get a summary of image usage status
 */
export function getImageUsageSummary(analysis: ImageUsageAnalysis[]): {
  totalImages: number;
  usedImages: number;
  unusedImages: number;
  hasUnusedImages: boolean;
  allImagesUsed: boolean;
} {
  let usedImages = 0;
  let unusedImages = 0;

  for (const item of analysis) {
    if (item.willBeUsed) {
      usedImages += item.images.length;
    } else {
      unusedImages += item.images.length;
    }
  }

  const totalImages = usedImages + unusedImages;

  return {
    totalImages,
    usedImages,
    unusedImages,
    hasUnusedImages: unusedImages > 0,
    allImagesUsed: unusedImages === 0 && totalImages > 0,
  };
}
