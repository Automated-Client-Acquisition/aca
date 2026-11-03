/**
 * Caption Style Template Metadata (Frontend)
 *
 * Display-only metadata for the subtitle template picker in the blueprint form.
 * Template IDs must match the backend registry in caption-style-templates.ts.
 *
 * Each template includes visual preview data so the picker can render
 * a realistic miniature of the subtitle style.
 */

export interface CaptionStylePreview {
  /** Background color for the preview card (simulates video frame) */
  previewBg: string;
  /** Primary text color */
  textColor: string;
  /** Highlight/active word color */
  highlightColor: string;
  /** Whether preview shows a text background box */
  hasTextBg: boolean;
  /** Text background color (if hasTextBg) */
  textBgColor?: string;
  /** Animation style label shown on preview */
  animationLabel: string;
  /** Position label */
  position: 'bottom' | 'center' | 'lower-third';
}

export interface CaptionStyleTemplateInfo {
  id: string;
  name: string;
  description: string;
  category: 'minimal' | 'bold' | 'animated' | 'cinematic';
  preview: CaptionStylePreview;
}

export const CAPTION_STYLE_TEMPLATES: CaptionStyleTemplateInfo[] = [
  {
    id: 'clean_white',
    name: 'Clean White',
    description: 'White text with drop shadow, gold word highlight',
    category: 'minimal',
    preview: {
      previewBg: '#1a1a2e',
      textColor: '#FFFFFF',
      highlightColor: '#FFD700',
      hasTextBg: false,
      animationLabel: 'Word highlight',
      position: 'bottom',
    },
  },
  {
    id: 'karaoke_bold',
    name: 'Karaoke Bold',
    description: 'Bold text with word-by-word color fill',
    category: 'bold',
    preview: {
      previewBg: '#0a0a0f',
      textColor: 'rgba(255,255,255,0.35)',
      highlightColor: '#FFFFFF',
      hasTextBg: false,
      animationLabel: 'Karaoke fill',
      position: 'center',
    },
  },
  {
    id: 'boxed_yellow',
    name: 'Boxed Highlight',
    description: 'Yellow box behind active word',
    category: 'animated',
    preview: {
      previewBg: '#1a1a2e',
      textColor: '#FFFFFF',
      highlightColor: '#000000',
      hasTextBg: true,
      textBgColor: '#FFD700',
      animationLabel: 'Box highlight',
      position: 'bottom',
    },
  },
  {
    id: 'bounce_pop',
    name: 'Bounce Pop',
    description: 'Words pop in with scale animation',
    category: 'animated',
    preview: {
      previewBg: '#0f0f23',
      textColor: '#FFFFFF',
      highlightColor: '#FF6B6B',
      hasTextBg: false,
      animationLabel: 'Bounce in',
      position: 'center',
    },
  },
  {
    id: 'cinematic_lower',
    name: 'Cinematic Lower Third',
    description: 'Elegant lower-third with backdrop',
    category: 'cinematic',
    preview: {
      previewBg: '#0a0a0f',
      textColor: '#E0E0E0',
      highlightColor: '#FFFFFF',
      hasTextBg: true,
      textBgColor: 'rgba(0,0,0,0.6)',
      animationLabel: 'Fade reveal',
      position: 'lower-third',
    },
  },
];
