/**
 * ASS (Advanced SubStation Alpha) Subtitle Generator
 *
 * Generates ASS subtitle files from word-level timestamps and caption style templates.
 * ASS format supports rich styling, animations, and per-word timing via karaoke tags.
 *
 * Reference: http://www.tcax.org/docs/ass-specs.htm
 */

import { CaptionStyleDefinition } from './caption-style-templates.js';

interface WordTiming {
  word: string;
  start: number; // seconds
  end: number;   // seconds
}

/**
 * Format time as ASS timestamp: H:MM:SS.CC (centiseconds)
 */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Group words into display segments of N words
 */
function groupWords(words: WordTiming[], wordsPerGroup: number): WordTiming[][] {
  const groups: WordTiming[][] = [];
  for (let i = 0; i < words.length; i += wordsPerGroup) {
    groups.push(words.slice(i, i + wordsPerGroup));
  }
  return groups;
}

/**
 * Generate ASS header with script info
 */
function generateHeader(videoWidth: number, videoHeight: number): string {
  return `[Script Info]
Title: Auto-generated subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}

`;
}

/**
 * Generate ASS style definition from a caption template
 */
function generateStyle(template: CaptionStyleDefinition, scaleFactor: number): string {
  const fontSize = Math.round(template.fontSize * scaleFactor);
  const outline = Math.round(template.outline * scaleFactor);
  const shadow = Math.round(template.shadow * scaleFactor);
  const marginL = Math.round(template.marginL * scaleFactor);
  const marginR = Math.round(template.marginR * scaleFactor);
  const marginV = Math.round(template.marginV * scaleFactor);

  // ASS Style format:
  // Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
  // Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,
  // BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding

  const borderStyle = template.textBgEnabled ? 3 : 1; // 3 = opaque box, 1 = outline + shadow
  const backColor = template.textBgEnabled && template.textBgColor
    ? template.textBgColor
    : template.backColor;

  return `[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${template.fontName},${fontSize},${template.primaryColor},${template.secondaryColor},${template.outlineColor},${backColor},${template.bold ? -1 : 0},${template.italic ? -1 : 0},0,0,100,100,0,0,${borderStyle},${outline},${shadow},${template.alignment},${marginL},${marginR},${marginV},1

`;
}

/**
 * Generate dialogue events based on animation style
 */
function generateEvents(
  words: WordTiming[],
  template: CaptionStyleDefinition,
  scaleFactor: number
): string {
  const lines: string[] = [];
  lines.push('[Events]');
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  const groups = groupWords(words, template.wordsPerGroup);

  switch (template.animationStyle) {
    case 'highlight':
      lines.push(...generateHighlightEvents(groups, template));
      break;
    case 'karaoke':
      lines.push(...generateKaraokeEvents(groups, template));
      break;
    case 'bounce':
      lines.push(...generateBounceEvents(groups, template, scaleFactor));
      break;
    case 'box_highlight':
      lines.push(...generateBoxHighlightEvents(groups, template));
      break;
    case 'fade':
      lines.push(...generateFadeEvents(groups));
      break;
    default:
      lines.push(...generateHighlightEvents(groups, template));
  }

  return lines.join('\n');
}

/**
 * Highlight style: all words visible, active word changes color via \k tags
 */
function generateHighlightEvents(groups: WordTiming[][], template: CaptionStyleDefinition): string[] {
  const lines: string[] = [];
  const highlightColor = template.highlightColor || '&H0000D7FF';

  for (const group of groups) {
    if (group.length === 0) continue;
    const start = formatTime(group[0].start);
    const end = formatTime(group[group.length - 1].end);

    // Build text with \k karaoke tags for per-word timing
    // Each word gets a \k duration (in centiseconds) and override color
    let text = '';
    for (let i = 0; i < group.length; i++) {
      const w = group[i];
      const duration = Math.round((w.end - w.start) * 100);
      // \kf = karaoke fill — smoothly fills from secondary to primary color
      // We override to use highlight color for the active word
      text += `{\\kf${duration}\\1c${highlightColor}}${w.word} `;
    }

    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text.trim()}`);
  }

  return lines;
}

/**
 * Karaoke style: words fill from dim to bright
 */
function generateKaraokeEvents(groups: WordTiming[][], _template: CaptionStyleDefinition): string[] {
  const lines: string[] = [];

  for (const group of groups) {
    if (group.length === 0) continue;
    const start = formatTime(group[0].start);
    const end = formatTime(group[group.length - 1].end);

    let text = '';
    for (const w of group) {
      const duration = Math.round((w.end - w.start) * 100);
      text += `{\\kf${duration}}${w.word} `;
    }

    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text.trim()}`);
  }

  return lines;
}

/**
 * Bounce style: words pop in with scale animation
 */
function generateBounceEvents(
  groups: WordTiming[][],
  template: CaptionStyleDefinition,
  _scaleFactor: number
): string[] {
  const lines: string[] = [];
  const scale = Math.round((template.bounceScale || 1.3) * 100);

  for (const group of groups) {
    if (group.length === 0) continue;

    // Each word gets its own dialogue line with bounce animation
    for (const w of group) {
      const start = formatTime(w.start);
      const end = formatTime(group[group.length - 1].end);
      const bounceMs = 150;
      const settleMs = 100;

      // Start at normal size, scale up, then settle back
      const text = `{\\fscx100\\fscy100\\t(0,${bounceMs},\\fscx${scale}\\fscy${scale})\\t(${bounceMs},${bounceMs + settleMs},\\fscx100\\fscy100)}${w.word}`;

      lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
    }
  }

  return lines;
}

/**
 * Box highlight style: base text + highlighted word with background box
 */
function generateBoxHighlightEvents(groups: WordTiming[][], template: CaptionStyleDefinition): string[] {
  const lines: string[] = [];
  const boxColor = template.boxColor || '&H0000D7FF';
  const highlightTextColor = template.highlightColor || '&H00000000';

  for (const group of groups) {
    if (group.length === 0) continue;
    const groupStart = formatTime(group[0].start);
    const groupEnd = formatTime(group[group.length - 1].end);

    // Base layer: all words in normal style
    const baseText = group.map(w => w.word).join(' ');
    lines.push(`Dialogue: 0,${groupStart},${groupEnd},Default,,0,0,0,,${baseText}`);

    // Highlight layer: one word at a time with box background
    for (const w of group) {
      const wordStart = formatTime(w.start);
      const wordEnd = formatTime(w.end);
      // \3c = outline color (used as box bg with BorderStyle 3), \1c = text color
      const highlightText = `{\\3c${boxColor}\\1c${highlightTextColor}\\bord8\\p0}${w.word}`;
      lines.push(`Dialogue: 1,${wordStart},${wordEnd},Default,,0,0,0,,${highlightText}`);
    }
  }

  return lines;
}

/**
 * Fade style: segments fade in and out
 */
function generateFadeEvents(groups: WordTiming[][]): string[] {
  const lines: string[] = [];

  for (const group of groups) {
    if (group.length === 0) continue;
    const start = formatTime(group[0].start);
    const end = formatTime(group[group.length - 1].end);
    const text = group.map(w => w.word).join(' ');

    // \fad(fadeIn, fadeOut) in milliseconds
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,{\\fad(200,150)}${text}`);
  }

  return lines;
}

/**
 * Main function: generate a complete ASS subtitle file
 */
export function generateASS(
  words: WordTiming[],
  template: CaptionStyleDefinition,
  videoWidth: number,
  videoHeight: number
): string {
  // Scale factor relative to 1080p reference
  const scaleFactor = videoHeight / 1080;

  const header = generateHeader(videoWidth, videoHeight);
  const styles = generateStyle(template, scaleFactor);
  const events = generateEvents(words, template, scaleFactor);

  return header + styles + events + '\n';
}
