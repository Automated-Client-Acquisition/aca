// Type definitions for the keyboard-navigated slide presentation engine.
// Content lives in /content/slides/<slug>.json and is loaded by slug.

export type SlideType =
  | "title"
  | "warning"
  | "problem"
  | "command"
  | "filetree"
  | "insight"
  | "table"
  | "two-commands"
  | "stat"
  | "update"
  | "fullcircle"
  | "image"
  | "quote"
  | "versus"
  | "diagram"
  | "video"
  | "cta";

export interface TreeItem {
  text: string;
  class: "dir" | "skill" | "file";
}

export interface ProblemRow {
  tool: string;
  cost: string;
  logo?: string; // optional logo URL shown as a chip before the tool name
}

export interface RightStat {
  value: string;
  accent_part: string;
  label: string;
  sub: string;
}

export interface TableColumn {
  key: string;
  label: string;
}

export interface CommandOption {
  label: string;
  label_color: "accent" | "muted";
  command: string;
  terminal?: boolean;
}

export interface CtaPath {
  primary: boolean;
  title: string;
  body: string;
}

// A single slide. Fields are intentionally loose (most optional) so one
// interface can describe every slide type the engine renders.
export interface Slide {
  id: string;
  type: SlideType;
  notes?: string;

  // Shared / per-type fields
  pill?: string;
  eyebrow?: string;
  step?: string;
  headline?: string;
  accent_words?: string[];
  sub?: string;
  body?: string | string[];
  cta_line?: string;

  // command / update
  cmd_label?: string;
  command?: string;
  terminal?: boolean; // render command in a terminal-window mockup (real shell commands)
  chat?: boolean; // render command as a Telegram chat bubble (a message you send the agent)

  // problem
  rows?: ProblemRow[];
  total_label?: string;
  total_value?: string;
  right_stat?: RightStat;
  paid?: boolean; // real costs you DO pay — renders prices plainly (no strikethrough)

  // filetree
  tree?: TreeItem[];

  // table
  columns?: TableColumn[];
  // table rows are arbitrary keyed objects
  // (declared via index signature below through `any` cast at use site)
  winner_index?: number;
  note?: string;

  // two-commands
  options?: CommandOption[];

  // stat
  value?: string;
  accent_part?: string;
  label?: string;

  // image (also usable on `insight` to put a screenshot beside the text)
  image?: string; // URL or /public path
  alt?: string;
  caption?: string;

  // quote
  quote?: string;
  attribution?: string;

  // versus (before / after split)
  before?: string; // left side (e.g. terminal commands)
  after?: string; // right side (e.g. the chat message)
  before_label?: string;
  after_label?: string;

  // diagram (animated SVG centerpiece)
  svg?: string; // authored inline SVG, animated via .d-node / .d-flow classes

  // video (real screen recording, e.g. a Bunny Stream MP4)
  video?: string; // direct file URL (.mp4 / .webm / .m3u8) — works in the deck AND Remotion
  poster?: string; // optional still shown before playback
  embed?: string; // alternative: a player iframe URL (Bunny embed) — web preview only

  // video pipeline: use a recorded screen clip as this scene's visual
  // (path resolved by scripts/slides-to-video.py; not rendered in-app)
  media?: string;

  // cta
  paths?: CtaPath[];
  footer?: string;
}

// Table rows are kept untyped (record of column key -> value).
export type TableRow = Record<string, string>;

export interface SlideDeck {
  slug: string;
  title: string;
  subtitle?: string;
  slides: Slide[];
}
