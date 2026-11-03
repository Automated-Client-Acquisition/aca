/**
 * Instagram Carousel Style Configuration
 * Defines visual consistency across all slides in a carousel
 */

export type CarouselTemplate =
  | 'minimal'      // Clean, lots of whitespace
  | 'bold'         // High contrast, strong colors
  | 'elegant'      // Sophisticated, muted tones
  | 'playful'      // Bright, fun, rounded elements
  | 'professional' // Corporate, clean lines
  | 'custom';      // User-defined

export type AccentStyle = 'gradient' | 'solid' | 'outline' | 'glow';

export type CarouselAspectRatio = '1:1' | '4:5' | '9:16';

export interface CarouselColorPalette {
  primary: string;        // Main brand color (hex)
  secondary: string;      // Accent color (hex)
  background: string;     // Background color (hex)
  text: string;           // Primary text color (hex)
  textMuted: string;      // Secondary text color (hex)
}

export interface CarouselStyleConfig {
  // Visual identity
  palette: CarouselColorPalette;
  template: CarouselTemplate;
  accentStyle: AccentStyle;

  // Typography (used in style prompts)
  fontStyle: 'sans-serif' | 'serif' | 'display' | 'handwritten';

  // Layout
  aspectRatio: CarouselAspectRatio;

  // AI generation hints
  visualStyle?: string;   // e.g., "minimalist flat design", "3D rendered", "watercolor"
  moodKeywords?: string[]; // e.g., ["professional", "trustworthy", "modern"]
}

export interface CarouselSlide {
  slide_number: number;
  type: 'cover' | 'content' | 'cta';  // Different slide types

  // Content
  headline?: string;
  body?: string;
  ctaText?: string;

  // Image generation
  prompt: string;           // Full prompt for this slide
  image_url?: string;       // Generated image URL

  // Status
  status: 'pending' | 'generating' | 'completed' | 'approved' | 'rejected' | 'excluded' | 'failed';
  error?: string;
  /** Set by the renderer when the slide's text had to be shrunk past its minimum or trimmed to fit. */
  render_warnings?: string[];
  prediction_id?: string;
  started_at?: string;
}

export interface CarouselContent {
  // Style configuration (shared across all slides)
  style: CarouselStyleConfig;

  // Slides
  slides: CarouselSlide[];
  slideCount: number;

  // Caption for the post
  caption?: string;
  hashtags?: string[];
}

// Default style presets
export const CAROUSEL_STYLE_PRESETS: Record<Exclude<CarouselTemplate, 'custom'>, Partial<CarouselStyleConfig>> = {
  minimal: {
    palette: {
      primary: '#1a1a1a',
      secondary: '#666666',
      background: '#ffffff',
      text: '#1a1a1a',
      textMuted: '#888888',
    },
    accentStyle: 'solid',
    fontStyle: 'sans-serif',
    visualStyle: 'minimalist clean design, lots of whitespace, simple shapes',
    moodKeywords: ['clean', 'modern', 'simple'],
  },
  bold: {
    palette: {
      primary: '#ff3366',
      secondary: '#6633ff',
      background: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#cccccc',
    },
    accentStyle: 'gradient',
    fontStyle: 'display',
    visualStyle: 'bold high-contrast design, vibrant colors, strong typography',
    moodKeywords: ['energetic', 'bold', 'attention-grabbing'],
  },
  elegant: {
    palette: {
      primary: '#c9a962',
      secondary: '#2c3e50',
      background: '#f8f6f3',
      text: '#2c3e50',
      textMuted: '#7f8c8d',
    },
    accentStyle: 'outline',
    fontStyle: 'serif',
    visualStyle: 'elegant sophisticated design, muted tones, refined aesthetic',
    moodKeywords: ['luxury', 'sophisticated', 'premium'],
  },
  playful: {
    palette: {
      primary: '#ff6b6b',
      secondary: '#4ecdc4',
      background: '#fff9db',
      text: '#2d3436',
      textMuted: '#636e72',
    },
    accentStyle: 'solid',
    fontStyle: 'display',
    visualStyle: 'playful fun design, rounded shapes, bright cheerful colors',
    moodKeywords: ['fun', 'friendly', 'approachable'],
  },
  professional: {
    palette: {
      primary: '#2563eb',
      secondary: '#3b82f6',
      background: '#f8fafc',
      text: '#1e293b',
      textMuted: '#64748b',
    },
    accentStyle: 'solid',
    fontStyle: 'sans-serif',
    visualStyle: 'professional corporate design, clean lines, trustworthy appearance',
    moodKeywords: ['professional', 'trustworthy', 'corporate'],
  },
};

/**
 * Build a style prefix for image generation prompts
 * This ensures visual consistency across all carousel slides
 */
export function buildCarouselStylePromptPrefix(style: CarouselStyleConfig): string {
  const { palette, template, accentStyle, fontStyle, visualStyle, moodKeywords } = style;

  const parts: string[] = [
    'Instagram carousel slide',
    `${template} design template`,
    visualStyle || '',
    `color palette: ${palette.primary} primary, ${palette.secondary} accent, ${palette.background} background`,
    `${fontStyle} typography style`,
    `${accentStyle} accent elements`,
    ...(moodKeywords || []).map(k => `${k} aesthetic`),
    'professional social media quality',
    'cohesive brand identity',
  ];

  return parts.filter(Boolean).join(', ');
}

/**
 * Default carousel style configuration
 */
export const DEFAULT_CAROUSEL_STYLE: CarouselStyleConfig = {
  palette: CAROUSEL_STYLE_PRESETS.professional.palette!,
  template: 'professional',
  accentStyle: 'solid',
  fontStyle: 'sans-serif',
  aspectRatio: '1:1',
  visualStyle: CAROUSEL_STYLE_PRESETS.professional.visualStyle,
  moodKeywords: CAROUSEL_STYLE_PRESETS.professional.moodKeywords,
};
