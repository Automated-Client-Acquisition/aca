import { useState } from "react";

export type AgentKey =
  | "claude-desktop"
  | "claude-code"
  | "claude-cowork"
  | "cursor"
  | "windsurf"
  | "chatgpt"
  | "codex"
  | "openclaw"
  | "cline"
  | "continue"
  | "hermes"
  | "zed"
  | "mcp";

export type AgentInfo = {
  key: AgentKey;
  name: string;
  meta: string;
  domain: string;
  /** Local logo path served from /public, used as the first source. Falls back to Clearbit/favicon if missing. */
  localLogo?: string;
};

export const AGENTS: AgentInfo[] = [
  { key: "claude-desktop", name: "Claude Desktop", meta: "Anthropic", domain: "claude.ai" },
  { key: "claude-code", name: "Claude Code", meta: "Anthropic CLI", domain: "claude.ai" },
  { key: "claude-cowork", name: "Claude Cowork", meta: "Anthropic", domain: "anthropic.com" },
  { key: "cursor", name: "Cursor", meta: "Anysphere", domain: "cursor.com" },
  { key: "windsurf", name: "Windsurf", meta: "Codeium", domain: "windsurf.com" },
  { key: "openclaw", name: "OpenClaw", meta: "OSS · MCP", domain: "openclaw.dev", localLogo: "/logos/openclaw.svg" },
  { key: "chatgpt", name: "ChatGPT Desktop", meta: "OpenAI", domain: "openai.com" },
  { key: "codex", name: "Codex", meta: "OpenAI CLI", domain: "openai.com" },
  { key: "cline", name: "Cline", meta: "OSS", domain: "cline.bot" },
  { key: "continue", name: "Continue", meta: "OSS", domain: "continue.dev" },
  { key: "hermes", name: "Hermes", meta: "Nous Research", domain: "nousresearch.com" },
  { key: "zed", name: "Zed", meta: "Editor", domain: "zed.dev" },
  { key: "mcp", name: "any MCP-native client", meta: "spec", domain: "modelcontextprotocol.io" },
];

const REMOTE_SOURCES = [
  (domain: string, size: number) => `https://logo.clearbit.com/${domain}?size=${size}`,
  (domain: string, size: number) => `https://www.google.com/s2/favicons?domain=${domain}&sz=${Math.max(size, 64)}`,
  (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`,
];

export function AgentLogo({ agent, size = 20 }: { agent: AgentInfo; size?: number }) {
  const [step, setStep] = useState(0);
  const containerSize = size + 12;

  const sources: string[] = [];
  if (agent.localLogo) sources.push(agent.localLogo);
  sources.push(...REMOTE_SOURCES.map((fn) => fn(agent.domain, size * 2)));

  if (step >= sources.length) {
    return (
      <span
        className="agent-logo agent-logo--fallback"
        style={{ width: containerSize, height: containerSize, fontSize: Math.round(size * 0.6) }}
        aria-label={agent.name}
      >
        {agent.name[0]}
      </span>
    );
  }

  return (
    <span
      className="agent-logo"
      style={{ width: containerSize, height: containerSize }}
      aria-label={agent.name}
    >
      <img
        src={sources[step]}
        alt={agent.name}
        onError={() => setStep((s) => s + 1)}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    </span>
  );
}
