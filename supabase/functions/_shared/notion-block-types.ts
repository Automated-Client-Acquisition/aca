/**
 * Rich intermediate schema for Notion document generation.
 * This sits between AI output and the Notion API — the AI generates
 * NotionDocumentDef JSON, which the block compiler converts to Notion API format.
 */

// ============================================================================
// Rich Text
// ============================================================================

export type NotionColor =
  | 'default' | 'gray' | 'brown' | 'orange' | 'yellow'
  | 'green' | 'blue' | 'purple' | 'pink' | 'red'
  | 'gray_background' | 'brown_background' | 'orange_background'
  | 'yellow_background' | 'green_background' | 'blue_background'
  | 'purple_background' | 'pink_background' | 'red_background';

export interface RichTextSegment {
  content: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  link?: string;
  color?: NotionColor;
}

// ============================================================================
// Block Types
// ============================================================================

export interface HeadingBlock {
  type: 'heading_1' | 'heading_2' | 'heading_3';
  text: RichTextSegment[];
  color?: NotionColor;
}

export interface ParagraphBlock {
  type: 'paragraph';
  text: RichTextSegment[];
  color?: NotionColor;
}

export interface BulletedListItemBlock {
  type: 'bulleted_list_item';
  text: RichTextSegment[];
  children?: NotionBlockDef[];
}

export interface NumberedListItemBlock {
  type: 'numbered_list_item';
  text: RichTextSegment[];
  children?: NotionBlockDef[];
}

export interface CalloutBlock {
  type: 'callout';
  text: RichTextSegment[];
  emoji: string;
  color?: NotionColor;
  children?: NotionBlockDef[];
}

export interface QuoteBlock {
  type: 'quote';
  text: RichTextSegment[];
  color?: NotionColor;
}

export interface ToggleBlock {
  type: 'toggle';
  text: RichTextSegment[];
  children: NotionBlockDef[];
}

export interface ToDoBlock {
  type: 'to_do';
  text: RichTextSegment[];
  checked: boolean;
  children?: NotionBlockDef[];
}

export interface TableBlock {
  type: 'table';
  has_column_header: boolean;
  has_row_header: boolean;
  rows: TableRowDef[];
}

export interface TableRowDef {
  cells: RichTextSegment[][];
}

export interface DividerBlock {
  type: 'divider';
}

export interface ColumnListBlock {
  type: 'column_list';
  columns: ColumnDef[];
}

export interface ColumnDef {
  children: NotionBlockDef[];
}

export interface ImageBlock {
  type: 'image';
  url: string;
  caption?: RichTextSegment[];
}

export interface EmbedBlock {
  type: 'embed';
  url: string;
  caption?: RichTextSegment[];
}

// ============================================================================
// Union & Document
// ============================================================================

export type NotionBlockDef =
  | HeadingBlock
  | ParagraphBlock
  | BulletedListItemBlock
  | NumberedListItemBlock
  | CalloutBlock
  | QuoteBlock
  | ToggleBlock
  | ToDoBlock
  | TableBlock
  | DividerBlock
  | ColumnListBlock
  | ImageBlock
  | EmbedBlock;

export interface NotionDocumentDef {
  title: string;
  icon?: string;
  blocks: NotionBlockDef[];
}
