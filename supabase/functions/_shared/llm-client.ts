import { resolveApiKey } from './resolve-api-key.ts';
import { PUBLIC_SITE_URL } from "./site-config.ts";

// Edge functions pin different supabase-js versions (2.39 → npm:2.x), whose
// SupabaseClient types are structurally incompatible with each other. This
// module only calls .from()/.rpc(), so accept any client shape.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/**
 * Shared LLM chat client — the single provider-routing seam.
 *
 * Model-string convention: Ollama models are stored everywhere as
 * `ollama:<model_name>` (e.g. `ollama:llama3.3:70b`), Alibaba/DashScope
 * models as `alibaba:<model_name>` (e.g. `alibaba:qwen-max`), OpenCode Go
 * models as `opencode:<model_id>` (e.g. `opencode:deepseek-v4.1-flash`).
 * OpenRouter ids are `org/model`, so none of these prefixes can ever
 * collide. Any call site that passes its model string through
 * llmChatCompletion()/llmChatStream() transparently supports all four
 * providers.
 *
 * Ollama and Alibaba routing both target an OpenAI-compatible
 * `POST <base>/chat/completions` endpoint, so the request/response shape is
 * identical to OpenRouter's. Ollama's base URL comes from
 * api_keys.metadata.dsn_url (defaults to Ollama Cloud, https://ollama.com);
 * its API key is optional for self-hosted servers. Alibaba's base URL comes
 * from api_keys.metadata.dsn_url too: 'cn' → mainland DashScope, a literal
 * http(s) URL → a dedicated/workspace deployment endpoint, anything else
 * (including absent) → international DashScope. Its API key is always
 * required, with an optional DashScope workspace id in
 * metadata.secondary_key_encrypted.
 */

export const OLLAMA_MODEL_PREFIX = 'ollama:';
export const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Alibaba Cloud DashScope (Qwen models), OpenAI-compatible mode. Two regional
// endpoints; the org's api_keys.metadata.dsn_url selects 'cn' for mainland,
// anything else (including absent) defaults to international.
export const ALIBABA_MODEL_PREFIX = 'alibaba:';
export const ALIBABA_INTL_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
export const ALIBABA_CN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

// OpenCode Go (https://opencode.ai), OpenAI-compatible. Every request MUST
// carry an `x-opencode-session` header (stable per-org string) or the API
// 400s with MissingSessionID; an explicit User-Agent is also required or
// Cloudflare rejects the default one with a 403.
export const OPENCODE_MODEL_PREFIX = 'opencode:';
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

// Self-hosted Ollama servers may have no auth; api_keys.key_encrypted is NOT
// NULL, so an empty key is stored as this encrypted sentinel.
export const OLLAMA_NO_KEY_SENTINEL = 'none';

export function isOllamaModel(model: string | null | undefined): boolean {
  return !!model && model.startsWith(OLLAMA_MODEL_PREFIX);
}

export function stripOllamaPrefix(model: string): string {
  return isOllamaModel(model) ? model.slice(OLLAMA_MODEL_PREFIX.length) : model;
}

export function isAlibabaModel(model: string | null | undefined): boolean {
  return !!model && model.startsWith(ALIBABA_MODEL_PREFIX);
}

export function stripAlibabaPrefix(model: string): string {
  return isAlibabaModel(model) ? model.slice(ALIBABA_MODEL_PREFIX.length) : model;
}

export function isOpencodeModel(model: string | null | undefined): boolean {
  return !!model && model.startsWith(OPENCODE_MODEL_PREFIX);
}

export function stripOpencodePrefix(model: string): string {
  return isOpencodeModel(model) ? model.slice(OPENCODE_MODEL_PREFIX.length) : model;
}

export async function decryptApiKey(encryptedKey: string): Promise<string> {
  const encryptionKeyHex = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKeyHex) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  const keyBytes = new Uint8Array(
    encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );
  const encryptedData = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}

export interface OllamaConfig {
  baseUrl: string;
  apiKey: string | null;
}

/**
 * Resolve the org's Ollama server config from api_keys (provider='ollama'),
 * with parent-org inheritance via resolveApiKey.
 */
export async function resolveOllamaConfig(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<OllamaConfig | null> {
  const resolved = await resolveApiKey(supabase, organizationId, 'ollama');
  if (!resolved) return null;

  const baseUrl = (resolved.metadata?.dsn_url || OLLAMA_CLOUD_BASE_URL).replace(/\/+$/, '');
  let apiKey: string | null = null;
  try {
    const decrypted = await decryptApiKey(resolved.key_encrypted);
    apiKey = decrypted && decrypted !== OLLAMA_NO_KEY_SENTINEL ? decrypted : null;
  } catch (err) {
    console.error('[llm-client] Failed to decrypt Ollama key:', err);
  }
  return { baseUrl, apiKey };
}

/** True when the org has an Ollama server configured (with parent inheritance). */
export async function hasOllamaKey(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const resolved = await resolveApiKey(supabase, organizationId, 'ollama');
  return !!resolved;
}

export interface AlibabaConfig {
  baseUrl: string;
  apiKey: string;
  /** Optional DashScope workspace scoping (X-DashScope-WorkSpace header). */
  workspaceId: string | null;
}

/**
 * Resolve Alibaba's base URL from the stored dsn_url: 'cn' → mainland shared
 * endpoint, a literal http(s) URL → a dedicated/workspace deployment
 * endpoint (e.g. a private Model Studio host), anything else (including
 * absent) → international shared endpoint.
 */
function resolveAlibabaBaseUrl(dsnUrl: string | null | undefined): string {
  if (dsnUrl && /^https?:\/\//.test(dsnUrl)) return dsnUrl.replace(/\/+$/, '');
  return dsnUrl === 'cn' ? ALIBABA_CN_BASE_URL : ALIBABA_INTL_BASE_URL;
}

/**
 * Resolve the org's Alibaba/DashScope config from api_keys (provider='alibaba'),
 * with parent-org inheritance via resolveApiKey. `metadata.secondary_key_encrypted`
 * carries an optional encrypted workspace id, mirroring how porkbun stores a
 * second secret.
 */
export async function resolveAlibabaConfig(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<AlibabaConfig | null> {
  const resolved = await resolveApiKey(supabase, organizationId, 'alibaba');
  if (!resolved) return null;

  const baseUrl = resolveAlibabaBaseUrl(resolved.metadata?.dsn_url);

  let apiKey: string | null = null;
  try {
    apiKey = await decryptApiKey(resolved.key_encrypted);
  } catch (err) {
    console.error('[llm-client] Failed to decrypt Alibaba key:', err);
  }
  if (!apiKey) return null;

  let workspaceId: string | null = null;
  const encryptedWorkspaceId = resolved.metadata?.secondary_key_encrypted;
  if (encryptedWorkspaceId) {
    try {
      workspaceId = await decryptApiKey(encryptedWorkspaceId);
    } catch (err) {
      console.error('[llm-client] Failed to decrypt Alibaba workspace id:', err);
    }
  }

  return { baseUrl, apiKey, workspaceId };
}

/** True when the org has an Alibaba/DashScope key configured (with parent inheritance). */
export async function hasAlibabaKey(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const resolved = await resolveApiKey(supabase, organizationId, 'alibaba');
  return !!resolved;
}

export interface OpencodeConfig {
  baseUrl: string;
  apiKey: string;
  /** Stable session id for the mandatory x-opencode-session header. */
  sessionId: string;
}

/**
 * Resolve the org's OpenCode Go config from api_keys (provider='opencode'),
 * with parent-org inheritance via resolveApiKey. The session id is a stable
 * per-org string (any stable value works — reuse one for a whole batch).
 */
export async function resolveOpencodeConfig(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<OpencodeConfig | null> {
  const resolved = await resolveApiKey(supabase, organizationId, 'opencode');
  if (!resolved) return null;

  let apiKey: string | null = null;
  try {
    apiKey = await decryptApiKey(resolved.key_encrypted);
  } catch (err) {
    console.error('[llm-client] Failed to decrypt OpenCode key:', err);
  }
  if (!apiKey) return null;

  return {
    baseUrl: OPENCODE_GO_BASE_URL,
    apiKey,
    sessionId: `aca-${resolved.source_organization_id}`,
  };
}

/** True when the org has an OpenCode Go key configured (with parent inheritance). */
export async function hasOpencodeKey(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const resolved = await resolveApiKey(supabase, organizationId, 'opencode');
  return !!resolved;
}

export interface LlmChatParams {
  /** Model string; `ollama:`/`alibaba:`/`opencode:` prefixes route to the org's own server/key. */
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  response_format?: Record<string, unknown>;
  /** Extra body fields passed through verbatim (tools, seed, stop, ...). */
  extraBody?: Record<string, unknown>;
  /** Required for OpenRouter models (caller has already resolved BYOK/platform key). */
  openRouterApiKey?: string;
  /** Required for `ollama:`/`alibaba:`/`opencode:` models unless the matching *Config is passed. */
  supabase?: SupabaseClient;
  organizationId?: string;
  /** Pre-resolved Ollama config (skips the api_keys lookup). */
  ollamaConfig?: OllamaConfig;
  /** Pre-resolved Alibaba config (skips the api_keys lookup). */
  alibabaConfig?: AlibabaConfig;
  /** Pre-resolved OpenCode Go config (skips the api_keys lookup). */
  opencodeConfig?: OpencodeConfig;
  /** Optional AbortSignal / timeout in ms for the non-streaming call. */
  timeoutMs?: number;
}

export interface LlmChatResult {
  content: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  raw: any;
}

interface ResolvedEndpoint {
  url: string;
  headers: Record<string, string>;
  model: string;
  provider: 'ollama' | 'openrouter' | 'alibaba' | 'opencode';
}

const PROVIDER_LABELS: Record<ResolvedEndpoint['provider'], string> = {
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  alibaba: 'Alibaba',
  opencode: 'OpenCode',
};

async function resolveEndpoint(params: LlmChatParams): Promise<ResolvedEndpoint> {
  if (isOllamaModel(params.model)) {
    let config = params.ollamaConfig ?? null;
    if (!config) {
      if (!params.supabase || !params.organizationId) {
        throw new Error('Ollama model requires supabase + organizationId (or ollamaConfig) to resolve the server');
      }
      config = await resolveOllamaConfig(params.supabase, params.organizationId);
    }
    if (!config) {
      throw new Error('No Ollama server configured for this organization. Add one in Settings → API Keys.');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
    return {
      url: `${config.baseUrl}/v1/chat/completions`,
      headers,
      model: stripOllamaPrefix(params.model),
      provider: 'ollama',
    };
  }

  if (isAlibabaModel(params.model)) {
    let config = params.alibabaConfig ?? null;
    if (!config) {
      if (!params.supabase || !params.organizationId) {
        throw new Error('Alibaba model requires supabase + organizationId (or alibabaConfig) to resolve the key');
      }
      config = await resolveAlibabaConfig(params.supabase, params.organizationId);
    }
    if (!config) {
      throw new Error('No Alibaba/DashScope API key configured for this organization. Add one in Settings → API Keys.');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    };
    if (config.workspaceId) headers['X-DashScope-WorkSpace'] = config.workspaceId;
    return {
      url: `${config.baseUrl}/chat/completions`,
      headers,
      model: stripAlibabaPrefix(params.model),
      provider: 'alibaba',
    };
  }

  if (isOpencodeModel(params.model)) {
    let config = params.opencodeConfig ?? null;
    if (!config) {
      if (!params.supabase || !params.organizationId) {
        throw new Error('OpenCode model requires supabase + organizationId (or opencodeConfig) to resolve the key');
      }
      config = await resolveOpencodeConfig(params.supabase, params.organizationId);
    }
    if (!config) {
      throw new Error('No OpenCode Go API key configured for this organization. Add one in Settings → API Keys.');
    }
    return {
      url: `${config.baseUrl}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'x-opencode-session': config.sessionId,
        'User-Agent': 'ACA/1.0',
      },
      model: stripOpencodePrefix(params.model),
      provider: 'opencode',
    };
  }

  const key = params.openRouterApiKey || Deno.env.get('OPENROUTER_API_KEY');
  if (!key) {
    throw new Error('No OpenRouter API key. Add one in Settings > API Keys.');
  }
  return {
    url: OPENROUTER_CHAT_URL,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': Deno.env.get('SUPABASE_URL') || PUBLIC_SITE_URL,
      'X-Title': 'ACA',
    },
    model: params.model,
    provider: 'openrouter',
  };
}

function buildBody(params: LlmChatParams, model: string, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    ...(params.extraBody || {}),
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens;
  if (params.top_p !== undefined) body.top_p = params.top_p;
  if (params.response_format !== undefined) body.response_format = params.response_format;
  if (stream) body.stream = true;
  return body;
}

export interface ChatEndpoint {
  url: string;
  headers: Record<string, string>;
  /** Provider-native model id (ollama:/alibaba:/opencode: prefix stripped). Use in the request body. */
  model: string;
  provider: 'ollama' | 'openrouter' | 'alibaba' | 'opencode';
}

/**
 * Resolve the chat-completions URL/headers/model for a model string.
 * For call sites that need the raw pieces (e.g. to pass through
 * rateLimitedFetch) rather than a wrapped fetch.
 */
export async function resolveChatEndpoint(opts: {
  model: string;
  openRouterApiKey?: string;
  supabase?: SupabaseClient;
  organizationId?: string;
  ollamaConfig?: OllamaConfig | null;
  alibabaConfig?: AlibabaConfig | null;
  opencodeConfig?: OpencodeConfig | null;
  referer?: string;
}): Promise<ChatEndpoint> {
  const endpoint = await resolveEndpoint({
    model: opts.model,
    messages: [],
    openRouterApiKey: opts.openRouterApiKey,
    supabase: opts.supabase,
    organizationId: opts.organizationId,
    ollamaConfig: opts.ollamaConfig ?? undefined,
    alibabaConfig: opts.alibabaConfig ?? undefined,
    opencodeConfig: opts.opencodeConfig ?? undefined,
  });
  if (opts.referer && endpoint.provider === 'openrouter') {
    endpoint.headers['HTTP-Referer'] = opts.referer;
  }
  return endpoint;
}

export interface LlmFetchOptions {
  /** Key for OpenRouter models (already resolved by the caller). */
  openRouterApiKey?: string;
  /** Pre-resolved Ollama config, or supabase + organizationId to resolve it. */
  ollamaConfig?: OllamaConfig | null;
  /** Pre-resolved Alibaba config, or supabase + organizationId to resolve it. */
  alibabaConfig?: AlibabaConfig | null;
  /** Pre-resolved OpenCode Go config, or supabase + organizationId to resolve it. */
  opencodeConfig?: OpencodeConfig | null;
  supabase?: SupabaseClient;
  organizationId?: string;
  referer?: string;
  signal?: AbortSignal;
}

/**
 * Drop-in replacement for fetch('https://openrouter.ai/api/v1/chat/completions', ...).
 * Routes to the org's Ollama server, Alibaba/DashScope key, or OpenCode Go key
 * when body.model carries the `ollama:`/`alibaba:`/`opencode:` prefix; otherwise
 * hits OpenRouter with the caller's key. Returns the raw Response — all four
 * providers are OpenAI-compatible, so existing response parsing at call sites
 * keeps working unchanged.
 */
export async function fetchChatCompletions(
  body: Record<string, unknown>,
  opts: LlmFetchOptions,
): Promise<Response> {
  const model = String(body.model ?? '');
  const endpoint = await resolveEndpoint({
    model,
    messages: [],
    openRouterApiKey: opts.openRouterApiKey,
    supabase: opts.supabase,
    organizationId: opts.organizationId,
    ollamaConfig: opts.ollamaConfig ?? undefined,
    alibabaConfig: opts.alibabaConfig ?? undefined,
    opencodeConfig: opts.opencodeConfig ?? undefined,
  });
  if (opts.referer && endpoint.provider === 'openrouter') {
    endpoint.headers['HTTP-Referer'] = opts.referer;
  }
  return fetch(endpoint.url, {
    method: 'POST',
    headers: endpoint.headers,
    body: JSON.stringify({ ...body, model: endpoint.model }),
    signal: opts.signal,
  });
}

/**
 * Non-streaming chat completion, provider-routed by model prefix.
 * Returns a normalized { content, model, usage } (both providers are
 * OpenAI-compatible, so the raw response is also returned for callers that
 * need finish_reason, tool_calls, etc.).
 */
export async function llmChatCompletion(params: LlmChatParams): Promise<LlmChatResult> {
  const endpoint = await resolveEndpoint(params);
  const controller = new AbortController();
  const timeoutId = params.timeoutMs
    ? setTimeout(() => controller.abort('timeout'), params.timeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetch(endpoint.url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify(buildBody(params, endpoint.model, false)),
      signal: controller.signal,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${PROVIDER_LABELS[endpoint.provider]} API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    model: data.model || endpoint.model,
    usage: data.usage ?? null,
    raw: data,
  };
}

/**
 * Streaming chat completion (SSE), aggregated into a non-streaming-shaped
 * result. Keeps the connection alive as long as tokens flow, with hard
 * timeouts so a stuck model can't hang an edge function forever.
 * Both OpenRouter and Ollama's /v1 endpoint emit OpenAI-style SSE chunks.
 *
 * onDelta, when provided, receives each content token as it arrives —
 * used by SSE-forwarding endpoints like editor-chat.
 */
export async function llmChatStream(
  params: LlmChatParams,
  onDelta?: (delta: string) => void,
): Promise<LlmChatResult> {
  const endpoint = await resolveEndpoint(params);

  const CONNECT_TIMEOUT_MS = 90_000;   // time to first response headers
  const IDLE_TIMEOUT_MS = 45_000;      // max gap between SSE chunks once streaming
  const TOTAL_TIMEOUT_MS = 5 * 60_000; // absolute ceiling for the whole call

  const controller = new AbortController();
  const totalTimeoutId = setTimeout(() => controller.abort('total_timeout'), TOTAL_TIMEOUT_MS);
  const connectTimeoutId = setTimeout(() => controller.abort('connect_timeout'), CONNECT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint.url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify(buildBody(params, endpoint.model, true)),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(totalTimeoutId);
    clearTimeout(connectTimeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${endpoint.provider} request timed out before response (model=${endpoint.model}, after ${CONNECT_TIMEOUT_MS}ms). The model may be invalid or the server unreachable.`);
    }
    throw err;
  }
  clearTimeout(connectTimeoutId);

  if (!response.ok) {
    clearTimeout(totalTimeoutId);
    const errorBody = await response.text();
    throw new Error(`${PROVIDER_LABELS[endpoint.provider]} API error ${response.status}: ${errorBody}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let content = '';
  let model = endpoint.model;
  let usage: any = null;
  let buffer = '';
  let lastRaw: any = null;

  try {
    while (true) {
      const idleAbort = new AbortController();
      const idleTimeoutId = setTimeout(() => idleAbort.abort('idle_timeout'), IDLE_TIMEOUT_MS);

      const readResult = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idleAbort.signal.addEventListener('abort', () => {
            reject(new Error(`${endpoint.provider} stream idle for ${IDLE_TIMEOUT_MS}ms (model=${endpoint.model}). Aborting.`));
          });
        }),
      ]);
      clearTimeout(idleTimeoutId);

      const { done, value } = readResult;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const chunk = JSON.parse(data);
          lastRaw = chunk;
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            onDelta?.(delta.content);
          }
          if (chunk.model) model = chunk.model;
          if (chunk.usage) usage = chunk.usage;
        } catch {
          // Skip malformed chunks
        }
      }
    }
  } finally {
    clearTimeout(totalTimeoutId);
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  if (!usage) {
    const estimatedTokens = Math.ceil(content.length / 4);
    usage = { prompt_tokens: 0, completion_tokens: estimatedTokens, total_tokens: estimatedTokens };
  }

  return { content, model, usage, raw: lastRaw };
}
