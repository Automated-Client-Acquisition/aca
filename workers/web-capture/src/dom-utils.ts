/**
 * DOM Simplification Utilities
 *
 * Functions designed to run inside the browser context (via page.evaluate)
 * to extract simplified page structure for LLM consumption.
 */

// ============================================================================
// Types (serializable — must cross the browser/Node boundary)
// ============================================================================

export interface ClickableElement {
  tag: string;
  text: string;
  selector: string;
  href?: string;
  bbox: { x: number; y: number; width: number; height: number } | null;
  role?: string;
  ariaLabel?: string;
}

export interface HeadingInfo {
  level: number;
  text: string;
  id?: string;
}

export interface ImageInfo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface PageSection {
  tag: string;
  id?: string;
  ariaLabel?: string;
  role?: string;
  childCount: number;
}

export interface DOMSnapshot {
  title: string;
  url: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  visibleText: string;
  headings: HeadingInfo[];
  clickables: ClickableElement[];
  images: ImageInfo[];
  sections: PageSection[];
  formInputs: { type: string; name: string; placeholder: string; label: string }[];
}

// ============================================================================
// Browser-side extraction function (serialized and injected via page.evaluate)
// ============================================================================

/**
 * This function is designed to be passed to page.evaluate().
 * It runs entirely inside the browser and returns a serializable object.
 * All types must be plain objects — no class instances or DOM nodes in the return.
 */
export function extractDOMSnapshot(maxTextLength: number = 5000): DOMSnapshot {
  // --- Helpers ---

  function isVisible(el: Element): boolean {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  function getBbox(el: Element): { x: number; y: number; width: number; height: number } | null {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function buildSelector(el: Element): string {
    // Try unique identifiers first
    if (el.id) return `#${CSS.escape(el.id)}`;

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      const escaped = ariaLabel.replace(/"/g, '\\"');
      return `${el.tagName.toLowerCase()}[aria-label="${escaped}"]`;
    }

    // Try data-testid
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;

    // Build a path selector
    const tag = el.tagName.toLowerCase();
    const text = cleanText(el.textContent || '').slice(0, 30);
    const parent = el.parentElement;

    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        const parentSel = parent.id ? `#${CSS.escape(parent.id)}` : parent.tagName.toLowerCase();
        return `${parentSel} > ${tag}:nth-of-type(${idx})`;
      }
    }

    // Fallback: tag + partial text content
    if (text && text.length > 2) {
      return `${tag}:has-text("${text.slice(0, 20)}")`;
    }

    return tag;
  }

  // --- Title & Meta ---

  const title = document.title || '';
  const url = window.location.href;

  const metaDesc = document.querySelector('meta[name="description"]');
  const metaDescription = metaDesc ? (metaDesc as HTMLMetaElement).content : '';

  const ogTitleEl = document.querySelector('meta[property="og:title"]');
  const ogTitle = ogTitleEl ? (ogTitleEl as HTMLMetaElement).content : '';

  const ogDescEl = document.querySelector('meta[property="og:description"]');
  const ogDescription = ogDescEl ? (ogDescEl as HTMLMetaElement).content : '';

  const ogImageEl = document.querySelector('meta[property="og:image"]');
  const ogImage = ogImageEl ? (ogImageEl as HTMLMetaElement).content : '';

  // --- Visible Text ---

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) return NodeFilter.FILTER_REJECT;
      if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
      const text = (node.textContent || '').trim();
      if (text.length < 2) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textChunks: string[] = [];
  let totalLen = 0;
  let textNode: Node | null;
  while ((textNode = walker.nextNode()) && totalLen < maxTextLength) {
    const chunk = cleanText(textNode.textContent || '');
    if (chunk) {
      textChunks.push(chunk);
      totalLen += chunk.length;
    }
  }
  const visibleText = textChunks.join(' ').slice(0, maxTextLength);

  // --- Headings ---

  const headings: HeadingInfo[] = [];
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
    if (!isVisible(el)) return;
    const text = cleanText(el.textContent || '');
    if (text) {
      headings.push({
        level: parseInt(el.tagName[1], 10),
        text: text.slice(0, 200),
        id: el.id || undefined,
      });
    }
  });

  // --- Clickable Elements ---

  const clickables: ClickableElement[] = [];
  const clickableSelectors = 'a, button, [role="button"], [role="tab"], [role="link"], [role="menuitem"], input[type="submit"], input[type="button"], [onclick], [data-action]';

  document.querySelectorAll(clickableSelectors).forEach((el) => {
    if (!isVisible(el)) return;
    const text = cleanText(el.textContent || '');
    const ariaLabel = el.getAttribute('aria-label') || '';
    const displayText = text || ariaLabel;
    if (!displayText || displayText.length > 200) return;

    clickables.push({
      tag: el.tagName.toLowerCase(),
      text: displayText.slice(0, 100),
      selector: buildSelector(el),
      href: (el as HTMLAnchorElement).href || undefined,
      bbox: getBbox(el),
      role: el.getAttribute('role') || undefined,
      ariaLabel: ariaLabel || undefined,
    });
  });

  // --- Images ---

  const images: ImageInfo[] = [];
  document.querySelectorAll('img').forEach((el) => {
    const img = el as HTMLImageElement;
    if (!isVisible(img)) return;
    if (img.width < 50 || img.height < 50) return; // Skip tiny icons
    images.push({
      src: img.src,
      alt: img.alt || '',
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    });
  });

  // --- Sections ---

  const sections: PageSection[] = [];
  document.querySelectorAll('main, section, article, nav, aside, header, footer, [role="main"], [role="navigation"], [role="banner"]').forEach((el) => {
    if (!isVisible(el)) return;
    sections.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      role: el.getAttribute('role') || undefined,
      childCount: el.children.length,
    });
  });

  // --- Form Inputs ---

  const formInputs: { type: string; name: string; placeholder: string; label: string }[] = [];
  document.querySelectorAll('input, textarea, select').forEach((el) => {
    if (!isVisible(el)) return;
    const input = el as HTMLInputElement;
    const type = input.type || el.tagName.toLowerCase();
    if (['hidden', 'submit', 'button'].includes(type)) return;

    // Find associated label
    let label = '';
    if (input.id) {
      const labelEl = document.querySelector(`label[for="${input.id}"]`);
      if (labelEl) label = cleanText(labelEl.textContent || '');
    }
    if (!label && input.parentElement?.tagName.toLowerCase() === 'label') {
      label = cleanText(input.parentElement.textContent || '');
    }

    formInputs.push({
      type,
      name: input.name || '',
      placeholder: input.placeholder || '',
      label,
    });
  });

  return {
    title,
    url,
    metaDescription,
    ogTitle,
    ogDescription,
    ogImage,
    visibleText,
    headings,
    clickables,
    images,
    sections,
    formInputs,
  };
}

// ============================================================================
// Node-side helper: summarize DOM snapshot for LLM consumption
// ============================================================================

/**
 * Compress a DOMSnapshot into a compact text summary suitable for LLM context.
 * Keeps token count manageable while preserving actionable information.
 */
export function summarizeDOMSnapshot(snapshot: DOMSnapshot): string {
  const lines: string[] = [];

  lines.push(`Page: ${snapshot.title}`);
  lines.push(`URL: ${snapshot.url}`);
  if (snapshot.metaDescription) lines.push(`Description: ${snapshot.metaDescription}`);

  if (snapshot.headings.length > 0) {
    lines.push('\n## Headings');
    for (const h of snapshot.headings.slice(0, 20)) {
      lines.push(`${'#'.repeat(h.level)} ${h.text}`);
    }
  }

  if (snapshot.sections.length > 0) {
    lines.push('\n## Page Sections');
    for (const s of snapshot.sections.slice(0, 15)) {
      const label = s.ariaLabel || s.id || s.role || '';
      lines.push(`- <${s.tag}${label ? ` "${label}"` : ''}> (${s.childCount} children)`);
    }
  }

  if (snapshot.clickables.length > 0) {
    lines.push('\n## Clickable Elements');
    for (const c of snapshot.clickables.slice(0, 40)) {
      const href = c.href ? ` -> ${c.href}` : '';
      lines.push(`- [${c.tag}] "${c.text}" | selector: ${c.selector}${href}`);
    }
  }

  if (snapshot.images.length > 0) {
    lines.push('\n## Images');
    for (const img of snapshot.images.slice(0, 10)) {
      lines.push(`- ${img.alt || '(no alt)'} (${img.width}x${img.height}) ${img.src.slice(0, 80)}`);
    }
  }

  if (snapshot.formInputs.length > 0) {
    lines.push('\n## Form Inputs');
    for (const f of snapshot.formInputs.slice(0, 10)) {
      lines.push(`- [${f.type}] name="${f.name}" placeholder="${f.placeholder}" label="${f.label}"`);
    }
  }

  if (snapshot.visibleText) {
    lines.push('\n## Visible Text (excerpt)');
    lines.push(snapshot.visibleText.slice(0, 2000));
  }

  return lines.join('\n');
}
