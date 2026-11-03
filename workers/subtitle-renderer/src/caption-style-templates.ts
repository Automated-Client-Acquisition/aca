/**
 * Caption Style Templates (Worker Port)
 *
 * Ported from supabase/functions/_shared/caption-style-templates.ts
 * Keep in sync with the edge function version.
 */

export interface CaptionStyleDefinition {
  id: string;
  name: string;
  fontName: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  primaryColor: string;
  secondaryColor: string;
  outlineColor: string;
  backColor: string;
  outline: number;
  shadow: number;
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  animationStyle: 'highlight' | 'karaoke' | 'bounce' | 'box_highlight' | 'fade';
  highlightColor?: string;
  boxColor?: string;
  bounceScale?: number;
  textBgEnabled: boolean;
  textBgColor?: string;
  textBgOpacity?: number;
  wordsPerGroup: number;
}

const CAPTION_STYLE_REGISTRY: Record<string, CaptionStyleDefinition> = {
  clean_white: {
    id: 'clean_white',
    name: 'Clean White',
    fontName: 'Arial',
    fontSize: 64,
    bold: true,
    italic: false,
    primaryColor: '&H00FFFFFF',
    secondaryColor: '&H00FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    outline: 3,
    shadow: 2,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 60,
    animationStyle: 'highlight',
    highlightColor: '&H0000D7FF',
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
    primaryColor: '&H99FFFFFF',
    secondaryColor: '&H00FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outline: 4,
    shadow: 0,
    alignment: 5,
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
    primaryColor: '&H00FFFFFF',
    secondaryColor: '&H00FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outline: 3,
    shadow: 0,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 60,
    animationStyle: 'box_highlight',
    highlightColor: '&H00000000',
    boxColor: '&H0000D7FF',
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
    alignment: 5,
    marginL: 60,
    marginR: 60,
    marginV: 0,
    animationStyle: 'bounce',
    highlightColor: '&H006B6BFF',
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
    primaryColor: '&H00E0E0E0',
    secondaryColor: '&H00FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outline: 1,
    shadow: 0,
    alignment: 2,
    marginL: 80,
    marginR: 80,
    marginV: 80,
    animationStyle: 'fade',
    textBgEnabled: true,
    textBgColor: '&H00000000',
    textBgOpacity: 153,
    wordsPerGroup: 6,
  },
};

export function getCaptionStyle(id: string): CaptionStyleDefinition {
  return CAPTION_STYLE_REGISTRY[id] || CAPTION_STYLE_REGISTRY.clean_white;
}
