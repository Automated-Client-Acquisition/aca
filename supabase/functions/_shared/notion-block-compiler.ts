/**
 * Notion Block Compiler
 *
 * Compiles a NotionDocumentDef (intermediate schema) into Notion API JSON.
 * Handles rich text formatting, nested blocks, table validation, and the
 * 100-block-per-request limit.
 */

import type {
  RichTextSegment,
  NotionBlockDef,
  NotionDocumentDef,
  TableBlock,
  ColumnListBlock,
  ImageBlock,
  EmbedBlock,
} from './notion-block-types.ts';

// ============================================================================
// Rich Text Compilation
// ============================================================================

interface NotionRichTextObject {
  type: 'text';
  text: { content: string; link?: { url: string } };
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
}

const MAX_RICH_TEXT_LENGTH = 2000;

function splitLongText(segment: RichTextSegment): RichTextSegment[] {
  if (segment.content.length <= MAX_RICH_TEXT_LENGTH) return [segment];
  const chunks: RichTextSegment[] = [];
  let remaining = segment.content;
  while (remaining.length > 0) {
    chunks.push({ ...segment, content: remaining.slice(0, MAX_RICH_TEXT_LENGTH) });
    remaining = remaining.slice(MAX_RICH_TEXT_LENGTH);
  }
  return chunks;
}

export function compileRichText(segments: RichTextSegment[]): NotionRichTextObject[] {
  const expanded = segments.flatMap(splitLongText);
  return expanded.map((seg) => ({
    type: 'text' as const,
    text: {
      content: seg.content,
      ...(seg.link ? { link: { url: seg.link } } : {}),
    },
    annotations: {
      bold: seg.bold || false,
      italic: seg.italic || false,
      strikethrough: seg.strikethrough || false,
      underline: seg.underline || false,
      code: seg.code || false,
      color: seg.color || 'default',
    },
  }));
}

// ============================================================================
// Block Compilation
// ============================================================================

// deno-lint-ignore no-explicit-any
type NotionAPIBlock = Record<string, any>;

function compileChildren(children: NotionBlockDef[]): NotionAPIBlock[] {
  return children.map(compileBlock);
}

export function compileBlock(block: NotionBlockDef): NotionAPIBlock {
  switch (block.type) {
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return {
        object: 'block',
        type: block.type,
        [block.type]: {
          rich_text: compileRichText(block.text),
          ...(block.color ? { color: block.color } : {}),
        },
      };

    case 'paragraph':
      return {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: compileRichText(block.text),
          ...(block.color ? { color: block.color } : {}),
        },
      };

    case 'bulleted_list_item':
    case 'numbered_list_item':
      return {
        object: 'block',
        type: block.type,
        [block.type]: {
          rich_text: compileRichText(block.text),
          ...(block.children?.length ? { children: compileChildren(block.children) } : {}),
        },
      };

    case 'callout': {
      const compiled: NotionAPIBlock = {
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: compileRichText(block.text),
          icon: { type: 'emoji', emoji: block.emoji || '💡' },
          ...(block.color ? { color: block.color } : {}),
        },
      };
      if (block.children?.length) {
        compiled.callout.children = compileChildren(block.children);
      }
      return compiled;
    }

    case 'quote':
      return {
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: compileRichText(block.text),
          ...(block.color ? { color: block.color } : {}),
        },
      };

    case 'toggle': {
      // Toggles must have at least one child
      const children = block.children?.length
        ? compileChildren(block.children)
        : [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }];
      return {
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: compileRichText(block.text),
          children,
        },
      };
    }

    case 'to_do':
      return {
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: compileRichText(block.text),
          checked: block.checked,
          ...(block.children?.length ? { children: compileChildren(block.children) } : {}),
        },
      };

    case 'table':
      return compileTable(block);

    case 'divider':
      return { object: 'block', type: 'divider', divider: {} };

    case 'column_list':
      return compileColumnList(block);

    case 'image':
      return compileImage(block);

    case 'embed':
      return compileEmbed(block);

    default:
      // Unknown block type — render as empty paragraph
      return {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [] },
      };
  }
}

// ============================================================================
// Table Compilation
// ============================================================================

function compileTable(block: TableBlock): NotionAPIBlock {
  const rows = block.rows || [];
  if (rows.length === 0) {
    // Empty table — return a placeholder paragraph
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: '(empty table)' }, annotations: { bold: false, italic: true, strikethrough: false, underline: false, code: false, color: 'gray' } }] },
    };
  }

  // Determine column count from the widest row
  const columnCount = Math.max(...rows.map((r) => r.cells?.length || 0), 1);

  // Normalize rows so every row has exactly columnCount cells
  const normalizedRows = rows.map((row) => {
    const cells = row.cells || [];
    const padded = [...cells];
    while (padded.length < columnCount) {
      padded.push([{ content: '' }]);
    }
    return padded.slice(0, columnCount);
  });

  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: columnCount,
      has_column_header: block.has_column_header ?? true,
      has_row_header: block.has_row_header ?? false,
      children: normalizedRows.map((cells) => ({
        object: 'block',
        type: 'table_row',
        table_row: {
          cells: cells.map((cell) => compileRichText(cell)),
        },
      })),
    },
  };
}

// ============================================================================
// Column List Compilation
// ============================================================================

function compileColumnList(block: ColumnListBlock): NotionAPIBlock {
  let columns = block.columns || [];

  // Notion requires 2-3 columns; clamp
  if (columns.length < 2) {
    columns = [...columns, { children: [] }];
  }
  if (columns.length > 3) {
    columns = columns.slice(0, 3);
  }

  return {
    object: 'block',
    type: 'column_list',
    column_list: {
      children: columns.map((col) => ({
        object: 'block',
        type: 'column',
        column: {
          children: col.children?.length
            ? compileChildren(col.children)
            : [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }],
        },
      })),
    },
  };
}

// ============================================================================
// Image Compilation
// ============================================================================

function compileImage(block: ImageBlock): NotionAPIBlock {
  const result: NotionAPIBlock = {
    object: 'block',
    type: 'image',
    image: {
      type: 'external',
      external: { url: block.url },
    },
  };
  if (block.caption?.length) {
    result.image.caption = compileRichText(block.caption);
  }
  return result;
}

// ============================================================================
// Embed Compilation
// ============================================================================

function compileEmbed(block: EmbedBlock): NotionAPIBlock {
  const result: NotionAPIBlock = {
    object: 'block',
    type: 'embed',
    embed: {
      url: block.url,
    },
  };
  if (block.caption?.length) {
    result.embed.caption = compileRichText(block.caption);
  }
  return result;
}

// ============================================================================
// Document Compilation
// ============================================================================

const MAX_BLOCKS_PER_REQUEST = 100;

export interface CompiledDocument {
  /** Payload for POST /v1/pages (page creation with first batch of blocks) */
  createPayload: {
    parent: { database_id: string };
    properties: Record<string, unknown>;
    icon?: { type: 'emoji'; emoji: string };
    children: NotionAPIBlock[];
  };
  /** Additional block batches for PATCH /v1/blocks/{page_id}/children */
  appendPayloads: NotionAPIBlock[][];
}

export function compileDocument(
  doc: NotionDocumentDef,
  databaseId: string,
): CompiledDocument {
  // Compile all blocks
  const allBlocks = doc.blocks.map(compileBlock);

  // Count total blocks (including nested children counted as part of parent)
  // Notion counts top-level blocks for the 100-block limit
  const firstBatch = allBlocks.slice(0, MAX_BLOCKS_PER_REQUEST);
  const remaining = allBlocks.slice(MAX_BLOCKS_PER_REQUEST);

  // Split remaining into chunks of MAX_BLOCKS_PER_REQUEST
  const appendPayloads: NotionAPIBlock[][] = [];
  for (let i = 0; i < remaining.length; i += MAX_BLOCKS_PER_REQUEST) {
    appendPayloads.push(remaining.slice(i, i + MAX_BLOCKS_PER_REQUEST));
  }

  const createPayload: CompiledDocument['createPayload'] = {
    parent: { database_id: databaseId },
    properties: {
      title: {
        title: [{ text: { content: doc.title } }],
      },
    },
    children: firstBatch,
  };

  if (doc.icon) {
    createPayload.icon = { type: 'emoji', emoji: doc.icon };
  }

  return { createPayload, appendPayloads };
}
