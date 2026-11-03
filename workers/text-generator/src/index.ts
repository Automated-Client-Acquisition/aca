import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  callOpenRouterWithRetry,
  calculateCost,
  type LLMResult,
  type LLMUsage,
  type ChatMessage,
} from './openrouter.js';
import {
  buildPromptPlan,
  injectPreviousContent,
  type GenerateRequest,
} from './prompt-builder.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const INTERNAL_KEY = process.env.WORKER_INTERNAL_KEY || '';

// Stats tracking
const stats = {
  requests: 0,
  completed: 0,
  errors: 0,
  totalTokens: 0,
  startedAt: new Date().toISOString(),
};

// In-flight tracking for crash recovery awareness
const inFlight = new Set<string>();

// ─── HTTP Server ────────────────────────────────────────────────────

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Internal-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      stats: {
        ...stats,
        in_flight: inFlight.size,
        uptime_seconds: Math.floor((Date.now() - new Date(stats.startedAt).getTime()) / 1000),
      },
    }));
    return;
  }

  // Main generate endpoint
  if (url.pathname === '/generate' && req.method === 'POST') {
    // Auth check
    if (INTERNAL_KEY && req.headers['x-internal-key'] !== INTERNAL_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body: GenerateRequest;
    try {
      body = await readBody<GenerateRequest>(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    if (!body.output_id || !body.stage_id || !body.api_key || !body.supabase_url || !body.supabase_key) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: output_id, stage_id, api_key, supabase_url, supabase_key' }));
      return;
    }

    // Accept immediately — fire-and-forget
    stats.requests++;
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true, output_id: body.output_id }));

    // Process in background
    processGeneration(body).catch((err) => {
      console.error(`[FATAL] Unhandled error for ${body.output_id}:`, err);
    });
    return;
  }

  // 404 for anything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[text-generator] Listening on port ${PORT}`);
});

// ─── Generation Logic ───────────────────────────────────────────────

async function processGeneration(req: GenerateRequest): Promise<void> {
  const { output_id, stage_id } = req;
  const logPrefix = `[${output_id}/${stage_id}]`;

  inFlight.add(output_id);
  console.log(`${logPrefix} Starting text generation (model: ${req.model_config.model})`);

  const supabase = createClient(req.supabase_url, req.supabase_key);

  try {
    const plan = buildPromptPlan(req);
    let result: LLMResult;

    if (plan.type === 'single') {
      console.log(`${logPrefix} Single-call generation`);
      result = await callOpenRouterWithRetry(
        plan.messages!,
        req.model_config,
        req.api_key,
        req.supabase_url,
      );
      console.log(`${logPrefix} Complete. Tokens: ${result.usage.total_tokens}, Cost: $${result.cost.toFixed(4)}`);
    } else {
      console.log(`${logPrefix} Multi-section generation (${plan.sections!.length} sections)`);
      result = await executeMultiSection(plan.sections!, req, logPrefix);
      console.log(`${logPrefix} All ${plan.sections!.length} sections complete. Words: ${result.content.split(/\s+/).length}, Cost: $${result.cost.toFixed(4)}`);
    }

    stats.totalTokens += result.usage.total_tokens;

    // Write results to DB
    await writeSuccess(supabase, req, result);

    // Auto-approve if needed
    if (req.autopilot_id || req.auto_approve_all) {
      await autoApprove(supabase, req, logPrefix);
    }

    stats.completed++;
    console.log(`${logPrefix} Done`);
  } catch (err: any) {
    stats.errors++;
    console.error(`${logPrefix} FAILED:`, err.message);
    await writeError(supabase, output_id, stage_id, err.message).catch((e) =>
      console.error(`${logPrefix} Failed to write error to DB:`, e.message)
    );
  } finally {
    inFlight.delete(output_id);
  }
}

async function executeMultiSection(
  sections: Array<{ name: string; messages: ChatMessage[] }>,
  req: GenerateRequest,
  logPrefix: string,
): Promise<LLMResult> {
  let fullContent = '';
  const totalUsage: LLMUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let totalCost = 0;
  let model = req.model_config.model;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    // Inject previous content into the user message
    const messages = section.messages.map((msg) => {
      if (msg.role === 'user') {
        return { ...msg, content: injectPreviousContent(msg.content, fullContent) };
      }
      return msg;
    });

    const sectionResult = await callOpenRouterWithRetry(
      messages,
      { ...req.model_config, temperature: req.model_config.temperature ?? 0.7 },
      req.api_key,
      req.supabase_url,
    );

    fullContent += (fullContent.length > 0 ? '\n\n' : '') + sectionResult.content;
    totalUsage.prompt_tokens += sectionResult.usage.prompt_tokens;
    totalUsage.completion_tokens += sectionResult.usage.completion_tokens;
    totalUsage.total_tokens += sectionResult.usage.total_tokens;
    totalCost += sectionResult.cost;
    model = sectionResult.model || model;

    console.log(`${logPrefix} Section ${i + 1}/${sections.length} "${section.name}" complete`);
  }

  return { content: fullContent, model, usage: totalUsage, cost: totalCost };
}

// ─── Database Operations ────────────────────────────────────────────

async function writeSuccess(
  supabase: SupabaseClient,
  req: GenerateRequest,
  result: LLMResult,
): Promise<void> {
  // Fetch current output to merge stage_data and accumulate cost
  const { data: output, error: fetchErr } = await supabase
    .from('content_outputs')
    .select('stage_data, generation_cost')
    .eq('id', req.output_id)
    .single();

  if (fetchErr) {
    console.error(`Failed to fetch output ${req.output_id}:`, fetchErr.message);
    throw fetchErr;
  }

  const currentStageData = output?.stage_data || {};
  const previousCost = output?.generation_cost || 0;

  const updatedStageData = {
    ...currentStageData,
    [req.stage_id]: {
      content: result.content,
      model: result.model,
      usage: result.usage,
      cost: result.cost,
      status: 'awaiting_approval',
      completed_at: new Date().toISOString(),
    },
  };

  const { error: updateErr } = await supabase
    .from('content_outputs')
    .update({
      stage_data: updatedStageData,
      status: 'review',
      generation_cost: previousCost + result.cost,
    })
    .eq('id', req.output_id);

  if (updateErr) {
    console.error(`Failed to update output ${req.output_id}:`, updateErr.message);
    throw updateErr;
  }
}

async function writeError(
  supabase: SupabaseClient,
  outputId: string,
  stageId: string,
  errorMessage: string,
): Promise<void> {
  // Fetch current stage_data to merge
  const { data: output } = await supabase
    .from('content_outputs')
    .select('stage_data')
    .eq('id', outputId)
    .single();

  const currentStageData = output?.stage_data || {};

  const updatedStageData = {
    ...currentStageData,
    [stageId]: {
      ...(currentStageData[stageId] || {}),
      status: 'failed',
      error: errorMessage,
      failed_at: new Date().toISOString(),
    },
  };

  await supabase
    .from('content_outputs')
    .update({
      stage_data: updatedStageData,
      status: 'rejected',
      error_message: `Text generation failed: ${errorMessage}`,
    })
    .eq('id', outputId);
}

async function autoApprove(
  supabase: SupabaseClient,
  req: GenerateRequest,
  logPrefix: string,
): Promise<void> {
  const source = req.autopilot_id ? 'Autopilot' : 'AutoApproveAll';
  console.log(`${logPrefix} [${source}] Auto-approving stage ${req.stage_id}`);

  try {
    const { error } = await supabase.functions.invoke('approve-stage', {
      body: {
        output_id: req.output_id,
        stage_id: req.stage_id,
        action: 'approve',
        is_automated: true,
        autopilot_id: req.autopilot_id,
      },
    });

    if (error) {
      console.error(`${logPrefix} [${source}] Auto-approval failed:`, error);
    } else {
      console.log(`${logPrefix} [${source}] Stage auto-approved`);
    }
  } catch (err: any) {
    console.error(`${logPrefix} [${source}] Auto-approval exception:`, err.message);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function readBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
