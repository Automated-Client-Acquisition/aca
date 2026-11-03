import type { SlideContent } from './carousel-templates.js';

/**
 * One stored carousel_content slide -> what the renderer draws. Carries every
 * structured field (layout, items, stat, compare, CTA parts); older decks only have
 * headline/body and the renderer infers the rest. The last slide's button comes from
 * the slide itself; the blueprint's CTA text is only a fallback, and the renderer
 * never lets a paragraph into the button.
 */
export function toSlideInput(s: any, idx: number, total: number, configCtaText: string): SlideContent {
  const isLast = idx === total - 1;
  const type = idx === 0 ? 'cover' : isLast ? 'cta' : (s.type === 'cover' || s.type === 'cta' ? 'content' : (s.type || 'content'));
  const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  return {
    slide_number: s.slide_number || s.scene || idx + 1,
    type,
    headline: str(s.headline),
    body: str(s.body),
    cta_button_text: str(s.cta_button_text || s.ctaText || (isLast ? configCtaText : '')),
    layout: s.layout,
    kicker: str(s.kicker),
    highlight: str(s.highlight),
    items: Array.isArray(s.items) ? s.items.map(str) : undefined,
    lead: str(s.lead),
    footnote: str(s.footnote),
    stat_value: str(s.stat_value),
    stat_label: str(s.stat_label),
    before: str(s.before),
    after: str(s.after),
    cta_keyword: str(s.cta_keyword),
    cta_reason: str(s.cta_reason),
  };
}
