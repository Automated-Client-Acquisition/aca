/**
 * Embedding Generation Utility
 *
 * IMPORTANT: The embedding model and dimensions MUST be consistent between:
 * 1. Document chunk embedding (during upload processing)
 * 2. Query embedding (during retrieval in conversations)
 *
 * If you change the model, you must:
 * 1. Update EMBEDDING_DIMENSIONS in the database migration
 * 2. Re-process all existing documents to regenerate embeddings
 *
 * Current configuration:
 * - Model: openai/text-embedding-3-small (via OpenRouter)
 * - Dimensions: 1536
 */

// The embedding model used across the entire system - DO NOT change without re-embedding all documents
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

// Fallback model if primary OpenAI routing fails on OpenRouter.
// google/gemini-embedding-001 supports `dimensions` parameter (Matryoshka) so we can keep 1536 dims.
const EMBEDDING_MODEL_FALLBACK = 'google/gemini-embedding-001';

// Dimensions for this model - must match the vector column in knowledge_base_chunks table
export const EMBEDDING_DIMENSIONS = 1536;

// OpenRouter embedding endpoint
const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generate embedding for a single text string.
 * Uses OpenRouter's embedding API with the configured model.
 *
 * @param text - The text to embed
 * @param openRouterKey - Decrypted OpenRouter API key
 * @returns Embedding vector (1536 dimensions)
 */
export async function generateEmbedding(
  text: string,
  openRouterKey: string
): Promise<EmbeddingResult> {
  return generateEmbeddingWithModel(text, openRouterKey, EMBEDDING_MODEL);
}

async function generateEmbeddingWithModel(
  text: string,
  openRouterKey: string,
  model: string
): Promise<EmbeddingResult> {
  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
    },
    // Gemini embedding supports `dimensions` for output truncation (Matryoshka)
    body: JSON.stringify({
      model,
      input: text,
      ...(model === EMBEDDING_MODEL_FALLBACK ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter embedding error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  if (!data.data || !data.data[0] || !data.data[0].embedding) {
    // If primary model failed with provider routing error, retry with fallback model
    if (model === EMBEDDING_MODEL && (data.code === 404 || data.message?.includes('No successful provider'))) {
      console.warn(`[Embeddings] Primary model unavailable, retrying with fallback ${EMBEDDING_MODEL_FALLBACK}`);
      return generateEmbeddingWithModel(text, openRouterKey, EMBEDDING_MODEL_FALLBACK);
    }
    // If fallback also failed with routing error, give a clear actionable message
    if (data.code === 404 || data.message?.includes('No successful provider')) {
      throw new Error('Your OpenRouter API key does not have access to the embeddings API. Please update your OpenRouter key in Settings - ensure your account has credits and embedding access.');
    }
    const errorDetail = data.error ? JSON.stringify(data.error) : JSON.stringify(data);
    throw new Error(`Invalid embedding response from OpenRouter: ${errorDetail}`);
  }

  const embedding = data.data[0].embedding;

  // Validate dimensions
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${embedding.length}. ` +
      `Model ${model} may have changed. Check OpenRouter documentation.`
    );
  }

  return {
    embedding,
    model,
    usage: data.usage || { prompt_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Generate embeddings for multiple text strings in a batch.
 * More efficient than calling generateEmbedding multiple times.
 *
 * @param texts - Array of texts to embed
 * @param openRouterKey - Decrypted OpenRouter API key
 * @returns Array of embedding vectors (each 1536 dimensions)
 */
export async function generateEmbeddings(
  texts: string[],
  openRouterKey: string
): Promise<BatchEmbeddingResult> {
  if (texts.length === 0) {
    return {
      embeddings: [],
      model: EMBEDDING_MODEL,
      usage: { prompt_tokens: 0, total_tokens: 0 },
    };
  }

  // OpenRouter supports batching up to a certain limit
  // If texts array is very large, we may need to chunk it
  const MAX_BATCH_SIZE = 100;

  if (texts.length > MAX_BATCH_SIZE) {
    // Process in batches
    const allEmbeddings: number[][] = [];
    let totalPromptTokens = 0;
    let totalTokens = 0;

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const result = await generateEmbeddingsBatch(batch, openRouterKey);
      allEmbeddings.push(...result.embeddings);
      totalPromptTokens += result.usage.prompt_tokens;
      totalTokens += result.usage.total_tokens;
    }

    return {
      embeddings: allEmbeddings,
      model: EMBEDDING_MODEL,
      usage: { prompt_tokens: totalPromptTokens, total_tokens: totalTokens },
    };
  }

  return generateEmbeddingsBatch(texts, openRouterKey);
}

/**
 * Internal function to generate embeddings for a batch (max 100 texts)
 */
async function generateEmbeddingsBatch(
  texts: string[],
  openRouterKey: string
): Promise<BatchEmbeddingResult> {
  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter embedding error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  if (!data.data || !Array.isArray(data.data)) {
    // Log actual OpenRouter error for debugging
    const errorDetail = data.error ? JSON.stringify(data.error) : JSON.stringify(data);
    console.warn(`[Embeddings] Batch input not supported (${errorDetail}), falling back to sequential embeddings`);

    // Fall back to sequential single-embedding calls
    const allEmbeddings: number[][] = [];
    let totalPromptTokens = 0;
    let totalTokens = 0;

    for (const text of texts) {
      const single = await generateEmbedding(text, openRouterKey);
      allEmbeddings.push(single.embedding);
      totalPromptTokens += single.usage.prompt_tokens;
      totalTokens += single.usage.total_tokens;
    }

    return {
      embeddings: allEmbeddings,
      model: EMBEDDING_MODEL,
      usage: { prompt_tokens: totalPromptTokens, total_tokens: totalTokens },
    };
  }

  // Sort by index to maintain order (OpenRouter may return out of order)
  const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
  const embeddings = sorted.map((item: any) => item.embedding);

  // Validate all dimensions
  for (let i = 0; i < embeddings.length; i++) {
    if (embeddings[i].length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimension mismatch at index ${i}: expected ${EMBEDDING_DIMENSIONS}, got ${embeddings[i].length}`
      );
    }
  }

  return {
    embeddings,
    model: EMBEDDING_MODEL,
    usage: data.usage || { prompt_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Helper to truncate text to fit within embedding model limits.
 * text-embedding-3-small has a context window of ~8191 tokens.
 * We'll be conservative and limit to ~6000 tokens (~24000 characters).
 */
export function truncateForEmbedding(text: string, maxChars: number = 24000): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}
