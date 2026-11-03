/**
 * Caption Style Templates (Backend)
 *
 * Registry of subtitle visual styles used to generate ASS (Advanced SubStation Alpha)
 * subtitle files. Each template defines the full visual appearance and animation behavior
 * for burnt-in video subtitles.
 *
 * ASS color format: &HAABBGGRR (hex, alpha-blue-green-red)
 * Alignment (numpad): 1=bottom-left, 2=bottom-center, 5=center, 8=top-center
 */

export interface CaptionStyleDefinition {
  id: string;
  name: string;

  // Font properties
  fontName: string;
  fontSize: number;         // Relative to 1080p (PlayResY=1080)
  bold: boolean;
  italic: boolean;

  // ASS colors (&HAABBGGRR format)
  primaryColor: string;     // Default text color
  secondaryColor: string;   // Karaoke fill color
  outlineColor: string;     // Text outline
  backColor: string;        // Shadow / background

  // Outline & shadow
  outline: number;          // Outline thickness (pixels)
  shadow: number;           // Shadow distance (pixels)

  // Positioning
  alignment: number;        // ASS numpad alignment
  marginL: number;
  marginR: number;
  marginV: number;          // Vertical margin from edge

  // Animation
  animationStyle: 'highlight' | 'karaoke' | 'bounce' | 'box_highlight' | 'fade';

  // Style-specific properties
  highlightColor?: string;  // For highlight: active word color (&HAABBGGRR)
  boxColor?: string;        // For box_highlight: background box color
  bounceScale?: number;     // For bounce: scale factor (e.g., 1.3 = 130%)

  // Text background (semi-transparent bar behind all text)
  textBgEnabled: boolean;
  textBgColor?: string;     // ASS color
  textBgOpacity?: number;   // 0-255

  // Grouping
  wordsPerGroup: number;    // How many words to show at once (e.g., 4-6)
}

const CAPTION_STYLE_REGISTRY: Record<string, CaptionStyleDefinition> = {
  clean_white: {
    id: 'clean_white',
    name: 'Clean White',
    fontName: 'Arial',
    fontSize: 64,
    bold: true,
    italic: false,
    primaryColor: '&H00FFFFFF',    // White
    secondaryColor: '&H00FFFFFF',
    outlineColor: '&H00000000',    // Black outline
    backColor: '&H80000000',       // Semi-transparent black shadow
    outline: 3,
    shadow: 2,
    alignment: 2,                  // Bottom center
    marginL: 40,
    marginR: 40,
    marginV: 60,
    animationStyle: 'highlight',
    highlightColor: '&H0000D7FF',  // Gold (BGR: 00D7FF = FFD700 in RGB)
    textBgEnabled: false,
    wordsPerGroup: 5,
  },

  karaoke_bold: {
    id: 'karaoke_bold',
    name: 'Karaoke Bold',
    fontName: 'Arial',
    fontSize: 72,
    bold: true,
    italic: false,
    primaryColor: '&H99FFFFFF',    // Semi-transparent white (dimmed)
    secondaryColor: '&H00FFFFFF',  // Full white (karaoke fill target)
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outline: 4,
    shadow: 0,
    alignment: 5,                  // Center
    marginL: 60,
    marginR: 60,
    marginV: 0,
    animationStyle: 'karaoke',
    textBgEnabled: false,
    wordsPerGroup: 4,
  },

  boxed_yellow: {
    id: 'boxed_yellow',
    name: 'Boxed Highlight',
    fontName: 'Arial',
    fontSize: 64,
    bold: true,
    italic: false,
    primaryColor: '&H00FFFFFF',    // White
    secondaryColor: '&H00FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outline: 3,
    shadow: 0,
    alignment: 2,                  // Bottom center
    marginL: 40,
    marginR: 40,
    marginV: 60,
    animationStyle: 'box_highlight',
    highlightColor: '&H00000000',  // Black text on yellow box
    boxColor: '&H0000D7FF',        // Yellow box (BGR)
    textBgEnabled: false,
    wordsPerGroup: 5,
  },

  bounce_pop: {
    id: 'bounce_pop',
    name: 'Bounce Pop',
    fontName: 'Arial',
    fontSize: 68,
    bold: true,
    italic: false,
    primaryColor: '&H00FFFFFF',
    secondaryColor: '&H00FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    outline: 3,
    shadow: 1,
    alignment: 5,                  // Center
    marginL: 60,
    marginR: 60,
    marginV: 0,
    animationStyle: 'bounce',
    highlightColor: '&H006B6BFF',  // Red-coral (BGR for #FF6B6B)
    bounceScale: 1.3,
    textBgEnabled: false,
    wordsPerGroup: 3,
  },

  cinematic_lower: {
    id: 'cinematic_lower',
    name: 'Cinematic Lower Third',
    fontName: 'Arial',
    fontSize: 56,
    bold: false,
    italic: false,
    primaryColor: '&H00E0E0E0',   // Light gray
    secondaryColor: '&H00FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outline: 1,
    shadow: 0,
    alignment: 2,                  // Bottom center
    marginL: 80,
    marginR: 80,
    marginV: 80,
    animationStyle: 'fade',
    textBgEnabled: true,
    textBgColor: '&H00000000',     // Black
    textBgOpacity: 153,            // ~60% opacity
    wordsPerGroup: 6,
  },
};

export function getCaptionStyle(id: string): CaptionStyleDefinition {
  return CAPTION_STYLE_REGISTRY[id] || CAPTION_STYLE_REGISTRY.clean_white;
}

export function getAllCaptionStyleIds(): string[] {
  return Object.keys(CAPTION_STYLE_REGISTRY);
}
