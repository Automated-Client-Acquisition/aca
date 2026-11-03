/**
 * HTML Document Renderer
 *
 * Converts a NotionDocumentDef (intermediate schema) into a complete,
 * self-contained HTML page with inlined CSS. Supports white-label branding
 * and PDF export via html2pdf.js.
 *
 * Mirrors the structure of notion-block-compiler.ts but outputs HTML
 * instead of Notion API JSON.
 */

import type {
  RichTextSegment,
  NotionBlockDef,
  NotionDocumentDef,
  NotionColor,
  TableBlock,
  ColumnListBlock,
  ImageBlock,
} from './notion-block-types.ts';

// ============================================================================
// Branding Interface
// ============================================================================

export interface PageBranding {
  logo_url?: string | null;
  logo_dark_url?: string | null;
  primary_color?: { h: number; s: number; l: number } | null;
  cta_color?: { h: number; s: number; l: number } | null;
  accent_color?: { h: number; s: number; l: number } | null;
  app_name?: string | null;
  footer_text?: string | null;
  support_email?: string | null;
  favicon_url?: string | null;
  og_image_url?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  hide_powered_by?: boolean | null;
  custom_css?: string | null;
}

// ============================================================================
// HTML Escaping
// ============================================================================

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip dangerous patterns from custom CSS (prevents XSS and injection) */
function sanitizeCss(css: string): string {
  return css
    .replace(/<\s*\/\s*style/gi, '/* blocked */')           // </style> breakout
    .replace(/<\s*script/gi, '/* blocked */')                // <script> injection
    .replace(/url\s*\(\s*['"]?\s*javascript:/gi, 'url(/* blocked */')  // javascript: URLs
    .replace(/expression\s*\(/gi, '/* blocked */(')          // IE expression()
    .replace(/behavior\s*:/gi, '/* blocked */:')             // IE behavior
    .replace(/@import\s+url\s*\(/gi, '/* blocked */(');      // @import exfiltration
}

// ============================================================================
// Color Mapping
// ============================================================================

const COLOR_MAP: Record<string, string> = {
  default: 'inherit',
  gray: '#787774',
  brown: '#9F6B53',
  orange: '#D9730D',
  yellow: '#CB912F',
  green: '#448361',
  blue: '#337EA9',
  purple: '#9065B0',
  pink: '#C14C8A',
  red: '#D44C47',
  gray_background: '#F1F1EF',
  brown_background: '#F4EEEE',
  orange_background: '#FBECDD',
  yellow_background: '#FBF3DB',
  green_background: '#EDF3EC',
  blue_background: '#E7F3F8',
  purple_background: '#F6F3F9',
  pink_background: '#F9F0F5',
  red_background: '#FDEBEC',
};

function colorToCSS(color?: NotionColor): string {
  if (!color || color === 'default') return '';
  const val = COLOR_MAP[color];
  if (!val) return '';
  if (color.endsWith('_background')) {
    return `background-color:${val};`;
  }
  return `color:${val};`;
}

function hsl(c: { h: number; s: number; l: number }): string {
  return `hsl(${c.h}, ${c.s}%, ${c.l}%)`;
}

// ============================================================================
// Rich Text Rendering
// ============================================================================

function renderRichText(segments: RichTextSegment[]): string {
  if (!segments?.length) return '';
  return segments.map((seg) => {
    let html = esc(seg.content);

    if (seg.code) html = `<code>${html}</code>`;
    if (seg.bold) html = `<strong>${html}</strong>`;
    if (seg.italic) html = `<em>${html}</em>`;
    if (seg.strikethrough) html = `<s>${html}</s>`;
    if (seg.underline) html = `<u>${html}</u>`;

    const style = colorToCSS(seg.color);
    if (style) {
      html = `<span style="${style}">${html}</span>`;
    }

    if (seg.link) {
      html = `<a href="${esc(seg.link)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
    }

    return html;
  }).join('');
}

// ============================================================================
// Block Rendering
// ============================================================================

function renderBlock(block: NotionBlockDef): string {
  switch (block.type) {
    case 'heading_1':
    case 'heading_2':
    case 'heading_3': {
      const level = block.type.slice(-1);
      const style = colorToCSS(block.color);
      return `<h${level}${style ? ` style="${style}"` : ''}>${renderRichText(block.text)}</h${level}>`;
    }

    case 'paragraph': {
      const style = colorToCSS(block.color);
      const text = renderRichText(block.text);
      if (!text) return '<p>&nbsp;</p>';
      return `<p${style ? ` style="${style}"` : ''}>${text}</p>`;
    }

    case 'bulleted_list_item':
    case 'numbered_list_item': {
      // Individual items — grouping handled by renderBlocks()
      let html = `<li>${renderRichText(block.text)}`;
      if (block.children?.length) {
        html += renderBlocks(block.children);
      }
      html += '</li>';
      return html;
    }

    case 'callout': {
      const bgColor = block.color?.endsWith('_background')
        ? COLOR_MAP[block.color] || '#F1F1EF'
        : '#F1F1EF';
      const borderColor = block.color && !block.color.endsWith('_background')
        ? COLOR_MAP[block.color] || '#787774'
        : block.color
          ? COLOR_MAP[block.color.replace('_background', '')] || '#787774'
          : '#787774';
      let html = `<div class="callout" style="background:${bgColor};border-left:4px solid ${borderColor};">`;
      html += `<div class="callout-icon">${block.emoji || '💡'}</div>`;
      html += `<div class="callout-content">${renderRichText(block.text)}`;
      if (block.children?.length) {
        html += renderBlocks(block.children);
      }
      html += '</div></div>';
      return html;
    }

    case 'quote': {
      const style = colorToCSS(block.color);
      return `<blockquote${style ? ` style="${style}"` : ''}>${renderRichText(block.text)}</blockquote>`;
    }

    case 'toggle': {
      let html = `<details class="toggle"><summary>${renderRichText(block.text)}</summary>`;
      html += `<div class="toggle-content">`;
      if (block.children?.length) {
        html += renderBlocks(block.children);
      }
      html += '</div></details>';
      return html;
    }

    case 'table':
      return renderTable(block);

    case 'divider':
      return '<hr>';

    case 'column_list':
      return renderColumnList(block);

    case 'image':
      return renderImage(block);

    default:
      return '';
  }
}

// ============================================================================
// Table Rendering
// ============================================================================

function renderTable(block: TableBlock): string {
  const rows = block.rows || [];
  if (!rows.length) return '<p><em>(empty table)</em></p>';

  const colCount = Math.max(...rows.map((r) => r.cells?.length || 0), 1);

  let html = '<div class="table-wrapper"><table>';

  rows.forEach((row, rowIdx) => {
    const cells = row.cells || [];
    const isHeader = block.has_column_header && rowIdx === 0;

    if (isHeader) html += '<thead>';
    if (rowIdx === (block.has_column_header ? 1 : 0) && rowIdx > 0) html += '<tbody>';
    if (rowIdx === 0 && !block.has_column_header) html += '<tbody>';

    html += '<tr>';
    for (let c = 0; c < colCount; c++) {
      const cell = cells[c] || [{ content: '' }];
      const tag = isHeader || (block.has_row_header && c === 0) ? 'th' : 'td';
      html += `<${tag}>${renderRichText(cell)}</${tag}>`;
    }
    html += '</tr>';

    if (isHeader) html += '</thead>';
  });

  html += '</tbody></table></div>';
  return html;
}

// ============================================================================
// Column List Rendering
// ============================================================================

function renderColumnList(block: ColumnListBlock): string {
  const columns = block.columns || [];
  if (!columns.length) return '';

  const colCount = Math.min(Math.max(columns.length, 1), 3);
  let html = `<div class="columns columns-${colCount}">`;
  for (let i = 0; i < colCount; i++) {
    const col = columns[i];
    html += '<div class="column">';
    if (col?.children?.length) {
      html += renderBlocks(col.children);
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// ============================================================================
// Image Rendering
// ============================================================================

function renderImage(block: ImageBlock): string {
  let html = '<figure class="image-block">';
  html += `<img src="${esc(block.url)}" alt="" loading="lazy">`;
  if (block.caption?.length) {
    html += `<figcaption>${renderRichText(block.caption)}</figcaption>`;
  }
  html += '</figure>';
  return html;
}

// ============================================================================
// Block Grouping (consecutive list items → <ul>/<ol> wrappers)
// ============================================================================

interface GroupedList {
  _grouped: true;
  tag: 'ul' | 'ol';
  items: NotionBlockDef[];
}

type BlockOrGroup = NotionBlockDef | GroupedList;

function isGrouped(b: BlockOrGroup): b is GroupedList {
  return '_grouped' in b;
}

function groupBlocks(blocks: NotionBlockDef[]): BlockOrGroup[] {
  const result: BlockOrGroup[] = [];
  let currentList: GroupedList | null = null;

  for (const block of blocks) {
    if (block.type === 'bulleted_list_item') {
      if (currentList?.tag === 'ul') {
        currentList.items.push(block);
      } else {
        if (currentList) result.push(currentList);
        currentList = { _grouped: true, tag: 'ul', items: [block] };
      }
    } else if (block.type === 'numbered_list_item') {
      if (currentList?.tag === 'ol') {
        currentList.items.push(block);
      } else {
        if (currentList) result.push(currentList);
        currentList = { _grouped: true, tag: 'ol', items: [block] };
      }
    } else {
      if (currentList) { result.push(currentList); currentList = null; }
      result.push(block);
    }
  }
  if (currentList) result.push(currentList);
  return result;
}

function renderBlocks(blocks: NotionBlockDef[]): string {
  const grouped = groupBlocks(blocks);
  return grouped.map((item) => {
    if (isGrouped(item)) {
      return `<${item.tag}>${item.items.map(renderBlock).join('')}</${item.tag}>`;
    }
    return renderBlock(item);
  }).join('\n');
}

// ============================================================================
// Full Page Rendering
// ============================================================================

export interface RenderOptions {
  branding?: PageBranding | null;
  showPdfButton?: boolean;
  pageUrl?: string;
}

export function renderDocument(
  doc: NotionDocumentDef,
  options: RenderOptions = {},
): string {
  const { branding, showPdfButton = true, pageUrl } = options;

  const primaryColor = branding?.primary_color ? hsl(branding.primary_color) : '#1a1a1a';
  const ctaColor = branding?.cta_color ? hsl(branding.cta_color) : '#d4a843';
  const accentColor = branding?.accent_color ? hsl(branding.accent_color) : '#f8f6f1';
  const appName = branding?.app_name || '';
  const footerText = branding?.footer_text || '';
  const supportEmail = branding?.support_email || '';
  const logoUrl = branding?.logo_url || '';
  const faviconUrl = branding?.favicon_url || '';
  const ogImage = branding?.og_image_url || '';
  const metaTitle = doc.title;
  const metaDescription = branding?.meta_description || `Strategic analysis for ${doc.title}`;
  const hidePoweredBy = branding?.hide_powered_by ?? true;
  const customCss = sanitizeCss(branding?.custom_css || '');

  const contentHtml = renderBlocks(doc.blocks);

  // Build header section
  let headerHtml = '';
  if (logoUrl) {
    headerHtml += `<div class="page-logo"><img src="${esc(logoUrl)}" alt="${esc(appName)}" /></div>`;
  }
  headerHtml += `<div class="page-title">`;
  if (doc.icon) {
    headerHtml += `<span class="page-icon">${doc.icon}</span>`;
  }
  headerHtml += `<h1 class="document-title">${esc(doc.title)}</h1>`;
  headerHtml += `</div>`;

  // Build footer
  let footerHtml = '';
  const footerParts: string[] = [];
  if (footerText) footerParts.push(esc(footerText));
  if (supportEmail) footerParts.push(`<a href="mailto:${esc(supportEmail)}">${esc(supportEmail)}</a>`);
  if (!hidePoweredBy && appName) footerParts.push(`Powered by ${esc(appName)}`);
  if (footerParts.length) {
    footerHtml = `<footer class="page-footer">${footerParts.join(' &middot; ')}</footer>`;
  }

  // PDF export button
  const pdfButtonHtml = showPdfButton ? `
    <button id="pdf-export-btn" class="pdf-btn" onclick="exportPDF()" title="Export as PDF">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      Export PDF
    </button>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(metaTitle)}</title>
  <meta name="description" content="${esc(metaDescription)}">
  <meta property="og:title" content="${esc(metaTitle)}">
  <meta property="og:description" content="${esc(metaDescription)}">
  <meta property="og:type" content="article">
  ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
  ${appName ? `<meta property="og:site_name" content="${esc(appName)}">` : ''}
  ${pageUrl ? `<meta property="og:url" content="${esc(pageUrl)}">` : ''}
  ${faviconUrl ? `<link rel="icon" href="${esc(faviconUrl)}">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --primary: ${primaryColor};
      --cta: ${ctaColor};
      --accent: ${accentColor};
      --text: #1a1a1a;
      --text-secondary: #555;
      --border: #e5e5e5;
      --bg: #ffffff;
      --radius: 8px;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.7;
      font-size: 16px;
      -webkit-font-smoothing: antialiased;
    }

    .page-wrapper {
      max-width: 760px;
      margin: 0 auto;
      padding: 40px 24px 80px;
    }

    /* Header */
    .page-logo { text-align: center; margin-bottom: 24px; }
    .page-logo img { max-height: 48px; max-width: 200px; object-fit: contain; }
    .page-title { text-align: center; margin-bottom: 48px; }
    .page-icon { font-size: 48px; display: block; margin-bottom: 12px; }
    .document-title {
      font-size: 2rem;
      font-weight: 700;
      color: var(--primary);
      line-height: 1.2;
    }

    /* Typography */
    h1 { font-size: 1.875rem; font-weight: 700; margin: 2rem 0 1rem; color: var(--primary); }
    h2 { font-size: 1.5rem; font-weight: 600; margin: 2rem 0 0.75rem; color: var(--primary); }
    h3 { font-size: 1.25rem; font-weight: 600; margin: 1.5rem 0 0.5rem; color: var(--text); }
    p { margin: 0.5rem 0; }
    a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
    a:hover { opacity: 0.8; }
    strong { font-weight: 600; }
    code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.875em;
      background: #f1f1ef;
      padding: 2px 6px;
      border-radius: 4px;
    }

    /* Lists */
    ul, ol { margin: 0.5rem 0 0.5rem 1.5rem; }
    li { margin: 0.25rem 0; }
    li > ul, li > ol { margin-top: 0.25rem; }

    /* Callout */
    .callout {
      display: flex;
      gap: 12px;
      padding: 16px 20px;
      border-radius: var(--radius);
      margin: 1rem 0;
    }
    .callout-icon { font-size: 1.25rem; flex-shrink: 0; line-height: 1.7; }
    .callout-content { flex: 1; min-width: 0; }
    .callout-content p:first-child { margin-top: 0; }

    /* Quote */
    blockquote {
      border-left: 3px solid var(--primary);
      padding: 8px 20px;
      margin: 1rem 0;
      color: var(--text-secondary);
      font-style: italic;
    }

    /* Toggle */
    .toggle {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin: 0.75rem 0;
      overflow: hidden;
    }
    .toggle summary {
      padding: 12px 16px;
      cursor: pointer;
      font-weight: 600;
      background: #fafafa;
      list-style: none;
    }
    .toggle summary::-webkit-details-marker { display: none; }
    .toggle summary::before {
      content: '\\25B6';
      display: inline-block;
      margin-right: 8px;
      font-size: 0.75rem;
      transition: transform 0.2s;
    }
    .toggle[open] summary::before { transform: rotate(90deg); }
    .toggle-content { padding: 12px 16px; }

    /* Table */
    .table-wrapper { overflow-x: auto; margin: 1rem 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9375rem;
    }
    th, td {
      padding: 10px 14px;
      border: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--accent);
      font-weight: 600;
      color: var(--primary);
    }

    /* Columns */
    .columns { display: flex; gap: 24px; margin: 1rem 0; }
    .columns-2 .column { flex: 1; min-width: 0; }
    .columns-3 .column { flex: 1; min-width: 0; }
    @media (max-width: 640px) {
      .columns { flex-direction: column; gap: 16px; }
    }

    /* Divider */
    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

    /* Image */
    .image-block { margin: 1.5rem 0; }
    .image-block img { width: 100%; height: auto; border-radius: var(--radius); display: block; }
    .image-block figcaption {
      text-align: center;
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-top: 8px;
    }

    /* Footer */
    .page-footer {
      text-align: center;
      padding: 32px 0 16px;
      margin-top: 48px;
      border-top: 1px solid var(--border);
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }
    .page-footer a { color: var(--text-secondary); }

    /* PDF Export Button */
    .pdf-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: var(--cta);
      color: #1a1a1a;
      border: none;
      border-radius: 999px;
      font-family: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      transition: transform 0.15s, box-shadow 0.15s;
      z-index: 1000;
    }
    .pdf-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    .pdf-btn svg { flex-shrink: 0; }

    /* Print styles */
    @media print {
      body { font-size: 12pt; }
      .page-wrapper { max-width: 100%; padding: 0; }
      .pdf-btn { display: none !important; }
      .page-logo { margin-bottom: 12px; }
      .toggle { border: none; }
      .toggle summary { background: none; padding: 8px 0; }
      .toggle[open] .toggle-content { padding: 0; }
      h1, h2, h3 { page-break-after: avoid; }
      table, .callout, .image-block { page-break-inside: avoid; }
    }

    ${customCss}
  </style>
</head>
<body>
  <div class="page-wrapper" id="content">
    <header>
      ${headerHtml}
    </header>
    <main>
      ${contentHtml}
    </main>
    ${footerHtml}
  </div>
  ${pdfButtonHtml}
  ${showPdfButton ? `
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <script>
    function exportPDF() {
      var btn = document.getElementById('pdf-export-btn');
      if (btn) btn.style.display = 'none';
      html2pdf()
        .set({
          margin: [10, 8, 10, 8],
          filename: document.title.replace(/[^a-zA-Z0-9 -]/g, '') + '.pdf',
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        })
        .from(document.getElementById('content'))
        .save()
        .then(function() { if (btn) btn.style.display = ''; });
    }
  </script>` : ''}
</body>
</html>`;
}
