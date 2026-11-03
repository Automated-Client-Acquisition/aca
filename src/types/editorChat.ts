import type { TransitionType, VideoSettings, SceneText } from "./videoEditor";

// ── Chat Messages ──────────────────────────────────────────────────

export interface ToolCallDisclosure {
  id: string;
  label: string;
  icon: string;
  status: "running" | "completed" | "failed";
  summary?: string;
}

export interface DocumentBlock {
  title: string;
  content: string; // markdown
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** URL of an image attached to this user message (shown as thumbnail + sent to LLM) */
  imageUrl?: string;
  actions?: AgentAction[];
  actionResults?: ActionResult[];
  toolCallDisclosures?: ToolCallDisclosure[];
  document?: DocumentBlock;
  isStreaming?: boolean;
  timestamp: number;
}

// ── Agent actions (from the agentic tool loop) ─────────────────────

export interface AgentScenePlan {
  title: string;
  duration: number;
  transition: TransitionType;
  text_overlay?: {
    content: string;
    position?: "top" | "center" | "bottom";
  };
  media: {
    source: "stock_video" | "stock_photo" | "ai_image" | "color";
    query?: string;
    color?: string;
    // These may be populated by server-side tool execution
    url?: string;
    thumbnail?: string;
  };
  /** If set, this scene renders a skill composition instead of generic media */
  skill_composition?: {
    id: string;
    props: Record<string, unknown>;
  };
}

export type AgentAction =
  | { type: "plan_scenes"; scenes: AgentScenePlan[] }
  | { type: "update_project"; title?: string; aspect_ratio?: string; caption_style?: string }
  | { type: "set_voiceover"; script: string }
  | { type: "set_music"; url: string; title?: string; volume?: number }
  | { type: "add_asset"; url: string; asset_type: "video" | "image"; name: string; thumbnail?: string };

// ── Action result tracking ─────────────────────────────────────────

export interface ActionResult {
  actionIndex: number;
  type: AgentAction["type"];
  status: "pending" | "running" | "completed" | "failed";
  label: string;
  error?: string;
}

// ── SSE streaming events ────────────────────────────────────────────

export type SSEEvent =
  | { type: "status"; id: string; label: string; icon: string }
  | { type: "tool_result"; id: string; status: "completed" | "failed"; summary?: string }
  | { type: "document"; title: string; content: string }
  | { type: "action"; action: AgentAction }
  | { type: "code"; code: string }
  | { type: "final"; message: string; actions?: AgentAction[] }
  | { type: "error"; message: string };

// ── Edge function request/response ─────────────────────────────────

export interface EditorChatRequest {
  message: string;
  /** Optional image URL to attach as a vision input alongside the message */
  image_url?: string;
  conversation_history: { role: "user" | "assistant"; content: string }[];
  project_state: {
    title: string;
    scene_count: number;
    scenes: {
      index: number;
      duration: number;
      media_type: string;
      has_media: boolean;
      text?: string;
      transition: string;
    }[];
    settings: {
      aspect_ratio: string;
      caption_style: string;
    };
    has_voiceover: boolean;
    has_music: boolean;
    transcript?: string;
    transcript_word_count?: number;
  };
  organization_id: string;
}

export interface EditorChatResponse {
  message: string;
  actions: AgentAction[];
}
