/**
 * Knowledge Base Retrieval Utility
 *
 * Retrieves relevant document chunks for RAG (Retrieval Augmented Generation)
 * in AI chatbot conversations.
 *
 * IMPORTANT: Uses the same embedding model as document processing
 * to ensure consistent vector similarity search.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { generateEmbedding, EMBEDDING_MODEL } from './embeddings.ts';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  context: string;
  model: string;
  tokenUsage: number;
}

/**
 * Retrieve relevant knowledge chunks for a query.
 *
 * This function:
 * 1. Gets the document IDs linked to the campaign
 * 2. Generates an embedding for the query using the SAME model as document processing
 * 3. Performs vector similarity search on the chunks
 * 4. Returns the top-k most relevant chunks
 *
 * @param supabase - Supabase client (service role)
 * @param organizationId - Organization ID for scoping
 * @param campaignId - Campaign ID to get linked documents
 * @param query - The user's message/question
 * @param openRouterKey - Decrypted OpenRouter API key
 * @param limit - Maximum number of chunks to retrieve (default 5)
 * @returns Retrieved chunks and formatted context string
 */
export async function retrieveRelevantChunks(
  supabase: SupabaseClient,
  organizationId: string,
  campaignId: string,
  query: string,
  openRouterKey: string,
  limit: number = 5
): Promise<RetrievalResult> {
  // 1. Get document IDs linked to this campaign
  const { data: linkedDocs, error: linkError } = await supabase
    .from('campaign_knowledge_documents')
    .select('document_id')
    .eq('campaign_id', campaignId);

  if (linkError) {
    console.error('[Knowledge Retrieval] Failed to get linked documents:', linkError);
    return emptyResult();
  }

  if (!linkedDocs || linkedDocs.length === 0) {
    // No documents linked to this campaign
    return emptyResult();
  }

  const documentIds = linkedDocs.map((d) => d.document_id);

  // 2. Check that at least one document is completed (has embeddings)
  const { data: completedDocs, error: docError } = await supabase
    .from('knowledge_base_documents')
    .select('id')
    .in('id', documentIds)
    .eq('status', 'completed');

  if (docError || !completedDocs || completedDocs.length === 0) {
    // No completed documents
    return emptyResult();
  }

  const completedDocIds = completedDocs.map((d) => d.id);

  // 3. Generate embedding for the query
  // CRITICAL: Uses the same model as document processing
  let queryEmbedding: number[];
  let tokenUsage = 0;

  try {
    const embeddingResult = await generateEmbedding(query, openRouterKey);
    queryEmbedding = embeddingResult.embedding;
    tokenUsage = embeddingResult.usage.total_tokens;
  } catch (embeddingError) {
    console.error('[Knowledge Retrieval] Failed to generate query embedding:', embeddingError);
    return emptyResult();
  }

  // 4. Perform vector similarity search using the database function
  const { data: chunks, error: searchError } = await supabase
    .rpc('search_knowledge_chunks', {
      p_organization_id: organizationId,
      p_document_ids: completedDocIds,
      p_query_embedding: `[${queryEmbedding.join(',')}]`,
      p_limit: limit,
    });

  if (searchError) {
    console.error('[Knowledge Retrieval] Search failed:', searchError);
    return emptyResult();
  }

  if (!chunks || chunks.length === 0) {
    return {
      chunks: [],
      context: '',
      model: EMBEDDING_MODEL,
      tokenUsage,
    };
  }

  // 5. Format results
  const retrievedChunks: RetrievedChunk[] = chunks.map((chunk: any) => ({
    chunkId: chunk.chunk_id,
    documentId: chunk.document_id,
    content: chunk.content,
    similarity: chunk.similarity,
  }));

  // 6. Build context string for injection into AI prompt
  const context = retrievedChunks
    .map((chunk, index) => `[${index + 1}] ${chunk.content}`)
    .join('\n\n---\n\n');

  return {
    chunks: retrievedChunks,
    context,
    model: EMBEDDING_MODEL,
    tokenUsage,
  };
}

/**
 * Retrieve relevant knowledge chunks across ALL completed org documents.
 * No campaign scoping — searches the entire org knowledge base.
 * Used by inbox AI drafter for org-wide context.
 */
export async function retrieveOrgChunks(
  supabase: SupabaseClient,
  organizationId: string,
  query: string,
  openRouterKey: string,
  limit: number = 3
): Promise<RetrievalResult> {
  // 1. Get ALL completed documents for this org
  const { data: completedDocs, error: docError } = await supabase
    .from('knowledge_base_documents')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('status', 'completed');

  if (docError || !completedDocs || completedDocs.length === 0) {
    return emptyResult();
  }

  const completedDocIds = completedDocs.map((d: any) => d.id);

  // 2. Generate embedding for the query
  let queryEmbedding: number[];
  let tokenUsage = 0;

  try {
    const embeddingResult = await generateEmbedding(query, openRouterKey);
    queryEmbedding = embeddingResult.embedding;
    tokenUsage = embeddingResult.usage.total_tokens;
  } catch (embeddingError) {
    console.error('[Knowledge Retrieval] Failed to generate query embedding:', embeddingError);
    return emptyResult();
  }

  // 3. Vector similarity search using existing RPC
  const { data: chunks, error: searchError } = await supabase
    .rpc('search_knowledge_chunks', {
      p_organization_id: organizationId,
      p_document_ids: completedDocIds,
      p_query_embedding: `[${queryEmbedding.join(',')}]`,
      p_limit: limit,
    });

  if (searchError) {
    console.error('[Knowledge Retrieval] Org search failed:', searchError);
    return emptyResult();
  }

  if (!chunks || chunks.length === 0) {
    return { chunks: [], context: '', model: EMBEDDING_MODEL, tokenUsage };
  }

  const retrievedChunks: RetrievedChunk[] = chunks.map((chunk: any) => ({
    chunkId: chunk.chunk_id,
    documentId: chunk.document_id,
    content: chunk.content,
    similarity: chunk.similarity,
  }));

  const context = retrievedChunks
    .map((chunk, index) => `[${index + 1}] ${chunk.content}`)
    .join('\n\n---\n\n');

  return { chunks: retrievedChunks, context, model: EMBEDDING_MODEL, tokenUsage };
}

/**
 * Check if a campaign has any completed knowledge documents
 */
export async function campaignHasKnowledgeBase(
  supabase: SupabaseClient,
  campaignId: string
): Promise<boolean> {
  const { data: linkedDocs } = await supabase
    .from('campaign_knowledge_documents')
    .select('document_id')
    .eq('campaign_id', campaignId);

  if (!linkedDocs || linkedDocs.length === 0) {
    return false;
  }

  const documentIds = linkedDocs.map((d) => d.document_id);

  const { count } = await supabase
    .from('knowledge_base_documents')
    .select('id', { count: 'exact', head: true })
    .in('id', documentIds)
    .eq('status', 'completed');

  return (count || 0) > 0;
}

/**
 * Retrieve relevant knowledge chunks for specific document IDs.
 * Used by autopilot when the agent config specifies which documents to search.
 */
export async function retrieveChunksByDocIds(
  supabase: SupabaseClient,
  organizationId: string,
  documentIds: string[],
  query: string,
  openRouterKey: string,
  limit: number = 3
): Promise<RetrievalResult> {
  if (!documentIds.length) {
    return emptyResult();
  }

  // Check that at least one document is completed
  const { data: completedDocs, error: docError } = await supabase
    .from('knowledge_base_documents')
    .select('id')
    .in('id', documentIds)
    .eq('status', 'completed');

  if (docError || !completedDocs || completedDocs.length === 0) {
    return emptyResult();
  }

  const completedDocIds = completedDocs.map((d: any) => d.id);

  // Generate embedding for the query
  let queryEmbedding: number[];
  let tokenUsage = 0;

  try {
    const embeddingResult = await generateEmbedding(query, openRouterKey);
    queryEmbedding = embeddingResult.embedding;
    tokenUsage = embeddingResult.usage.total_tokens;
  } catch (embeddingError) {
    console.error('[Knowledge Retrieval] Failed to generate query embedding:', embeddingError);
    return emptyResult();
  }

  // Vector similarity search
  const { data: chunks, error: searchError } = await supabase
    .rpc('search_knowledge_chunks', {
      p_organization_id: organizationId,
      p_document_ids: completedDocIds,
      p_query_embedding: `[${queryEmbedding.join(',')}]`,
      p_limit: limit,
    });

  if (searchError) {
    console.error('[Knowledge Retrieval] Doc-scoped search failed:', searchError);
    return emptyResult();
  }

  if (!chunks || chunks.length === 0) {
    return { chunks: [], context: '', model: EMBEDDING_MODEL, tokenUsage };
  }

  const retrievedChunks: RetrievedChunk[] = chunks.map((chunk: any) => ({
    chunkId: chunk.chunk_id,
    documentId: chunk.document_id,
    content: chunk.content,
    similarity: chunk.similarity,
  }));

  const context = retrievedChunks
    .map((chunk, index) => `[${index + 1}] ${chunk.content}`)
    .join('\n\n---\n\n');

  return { chunks: retrievedChunks, context, model: EMBEDDING_MODEL, tokenUsage };
}

/**
 * Get knowledge context formatted for AI system prompt
 */
export function formatKnowledgeContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return '';
  }

  return `
KNOWLEDGE BASE:
Use the following information from company documents to answer questions accurately.
Only use this information if it's relevant to the user's question.
If the information doesn't cover their question, say you'll connect them with the team.

${chunks.map((chunk, i) => `[Document ${i + 1}]\n${chunk.content}`).join('\n\n---\n\n')}
`;
}

function emptyResult(): RetrievalResult {
  return {
    chunks: [],
    context: '',
    model: EMBEDDING_MODEL,
    tokenUsage: 0,
  };
}
