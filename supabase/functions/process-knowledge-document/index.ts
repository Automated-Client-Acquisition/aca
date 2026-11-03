/**
 * Edge Function: Process Knowledge Document
 *
 * Processes an uploaded document for the Knowledge Base:
 * 1. Downloads the file from Supabase Storage
 * 2. Extracts text content (PDF, DOCX, TXT, MD)
 * 3. Chunks the text into overlapping segments
 * 4. Generates embeddings via OpenRouter
 * 5. Stores chunks with embeddings in the database
 *
 * Input: { documentId: string }
 * Output: { success: boolean, chunkCount?: number, error?: string }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { Buffer } from 'node:buffer';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import {
  generateEmbeddings,
  truncateForEmbedding,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from '../_shared/embeddings.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Chunking configuration
const CHUNK_SIZE = 2000; // characters (~500 tokens)
const CHUNK_OVERLAP = 400; // characters (~100 tokens)

// Batch size for embedding generation
const EMBEDDING_BATCH_SIZE = 20;

interface ProcessRequest {
  documentId: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let documentId = '';

  try {
    const body: ProcessRequest = await req.json();
    documentId = body.documentId;

    if (!documentId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing documentId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Process KB] Starting processing for document ${documentId}`);

    // Load document record
    const { data: document, error: docError } = await supabase
      .from('knowledge_base_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return new Response(
        JSON.stringify({ success: false, error: 'Document not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, document.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // Check if already processed
    if (document.status === 'completed') {
      return new Response(
        JSON.stringify({ success: true, chunkCount: document.chunk_count, message: 'Already processed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update status to processing
    await supabase
      .from('knowledge_base_documents')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', documentId);

    // Get OpenRouter API key (checks org first, then falls back to parent agency)
    const resolvedKey = await resolveApiKey(supabase, document.organization_id, 'openrouter');

    if (!resolvedKey) {
      await markFailed(supabase, documentId, 'No OpenRouter API key configured');
      return new Response(
        JSON.stringify({ success: false, error: 'No OpenRouter API key configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encKey = Deno.env.get('ENCRYPTION_KEY')!;
    const openRouterKey = await decryptApiKey(resolvedKey.key_encrypted, encKey);

    // Download file from storage
    console.log(`[Process KB] Downloading file: ${document.file_path}`);
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('knowledge-base')
      .download(document.file_path);

    if (downloadError || !fileData) {
      await markFailed(supabase, documentId, `Failed to download file: ${downloadError?.message}`);
      return new Response(
        JSON.stringify({ success: false, error: `Download failed: ${downloadError?.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract text based on file type
    console.log(`[Process KB] Extracting text from ${document.file_type}`);
    let textContent: string;

    try {
      textContent = await extractText(fileData, document.file_type);
    } catch (extractError) {
      const errorMsg = extractError instanceof Error ? extractError.message : 'Unknown extraction error';
      await markFailed(supabase, documentId, `Text extraction failed: ${errorMsg}`);
      return new Response(
        JSON.stringify({ success: false, error: `Extraction failed: ${errorMsg}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!textContent || textContent.trim().length === 0) {
      await markFailed(supabase, documentId, 'Document contains no extractable text');
      return new Response(
        JSON.stringify({ success: false, error: 'No text content found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Process KB] Extracted ${textContent.length} characters`);

    // Chunk the text
    const chunks = chunkText(textContent, CHUNK_SIZE, CHUNK_OVERLAP);
    console.log(`[Process KB] Created ${chunks.length} chunks`);

    if (chunks.length === 0) {
      await markFailed(supabase, documentId, 'Failed to create any chunks from document');
      return new Response(
        JSON.stringify({ success: false, error: 'No chunks created' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Delete any existing chunks for this document (in case of reprocessing)
    await supabase
      .from('knowledge_base_chunks')
      .delete()
      .eq('document_id', documentId);

    // Generate embeddings and store chunks in batches
    let totalTokens = 0;

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      const batchTexts = batch.map((chunk) => truncateForEmbedding(chunk.content));

      console.log(`[Process KB] Generating embeddings for batch ${Math.floor(i / EMBEDDING_BATCH_SIZE) + 1}`);

      try {
        const embeddingResult = await generateEmbeddings(batchTexts, openRouterKey);
        totalTokens += embeddingResult.usage.total_tokens;

        // Prepare chunk records
        const chunkRecords = batch.map((chunk, idx) => ({
          document_id: documentId,
          organization_id: document.organization_id,
          content: chunk.content,
          chunk_index: chunk.index,
          embedding: `[${embeddingResult.embeddings[idx].join(',')}]`, // Format for pgvector
          metadata: chunk.metadata,
        }));

        // Insert chunks
        const { error: insertError } = await supabase
          .from('knowledge_base_chunks')
          .insert(chunkRecords);

        if (insertError) {
          console.error(`[Process KB] Failed to insert batch: ${insertError.message}`);
          throw new Error(`Failed to store chunks: ${insertError.message}`);
        }
      } catch (embeddingError) {
        const errorMsg = embeddingError instanceof Error ? embeddingError.message : 'Embedding generation failed';
        await markFailed(supabase, documentId, errorMsg);
        return new Response(
          JSON.stringify({ success: false, error: errorMsg }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Mark as completed
    await supabase
      .from('knowledge_base_documents')
      .update({
        status: 'completed',
        chunk_count: chunks.length,
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    console.log(`[Process KB] Successfully processed document ${documentId}: ${chunks.length} chunks, ${totalTokens} tokens`);

    return new Response(
      JSON.stringify({
        success: true,
        chunkCount: chunks.length,
        totalTokens,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Process KB] Error:', error);

    // Mark document as failed so it doesn't stay stuck in pending/processing
    if (documentId) {
      await markFailed(supabase, documentId, error instanceof Error ? error.message : 'Unknown processing error').catch(() => {});
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Mark document as failed with error message
 */
async function markFailed(
  supabase: SupabaseClient<any>,
  documentId: string,
  error: string
): Promise<void> {
  await supabase
    .from('knowledge_base_documents')
    .update({
      status: 'failed',
      processing_error: error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId);
}

/**
 * Extract text content from file based on type
 */
async function extractText(fileData: Blob, fileType: string): Promise<string> {
  switch (fileType) {
    case 'txt':
    case 'md':
      // Plain text files
      return await fileData.text();

    case 'pdf':
      // PDF extraction using pdf-parse
      return await extractPdfText(fileData);

    case 'docx':
      // DOCX extraction using mammoth
      return await extractDocxText(fileData);

    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * Extract text from PDF using pdf-parse
 */
async function extractPdfText(fileData: Blob): Promise<string> {
  // Dynamic import of pdf-parse
  const pdfParse = (await import('npm:pdf-parse@1.1.1')).default;
  const buffer = await fileData.arrayBuffer();
  const result = await pdfParse(Buffer.from(buffer));
  return result.text;
}

/**
 * Extract text from DOCX using mammoth
 */
async function extractDocxText(fileData: Blob): Promise<string> {
  // Dynamic import of mammoth
  const mammoth = await import('npm:mammoth@1.6.0');
  const buffer = await fileData.arrayBuffer();
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  return result.value;
}

interface ChunkResult {
  content: string;
  index: number;
  metadata: Record<string, unknown>;
}

/**
 * Chunk text into overlapping segments
 */
function chunkText(text: string, chunkSize: number, overlap: number): ChunkResult[] {
  const chunks: ChunkResult[] = [];

  // Clean the text: normalize whitespace, remove excessive newlines
  const cleanedText = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleanedText.length === 0) {
    return chunks;
  }

  // If text is smaller than chunk size, return as single chunk
  if (cleanedText.length <= chunkSize) {
    chunks.push({
      content: cleanedText,
      index: 0,
      metadata: { charStart: 0, charEnd: cleanedText.length },
    });
    return chunks;
  }

  // Create overlapping chunks
  let start = 0;
  let chunkIndex = 0;

  while (start < cleanedText.length) {
    let end = start + chunkSize;

    // If not at the end, try to break at a sentence or paragraph boundary
    if (end < cleanedText.length) {
      // Look for paragraph break within the last 20% of the chunk
      const searchStart = start + Math.floor(chunkSize * 0.8);
      const searchText = cleanedText.slice(searchStart, end);

      const paragraphBreak = searchText.lastIndexOf('\n\n');
      if (paragraphBreak !== -1) {
        end = searchStart + paragraphBreak + 2; // Include the newlines
      } else {
        // Look for sentence break (. ! ?)
        const sentenceMatch = searchText.match(/[.!?]\s+/g);
        if (sentenceMatch) {
          const lastSentenceEnd = searchText.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]);
          if (lastSentenceEnd !== -1) {
            end = searchStart + lastSentenceEnd + sentenceMatch[sentenceMatch.length - 1].length;
          }
        }
      }
    } else {
      end = cleanedText.length;
    }

    const chunkContent = cleanedText.slice(start, end).trim();

    if (chunkContent.length > 0) {
      chunks.push({
        content: chunkContent,
        index: chunkIndex,
        metadata: { charStart: start, charEnd: end },
      });
      chunkIndex++;
    }

    // Move start position, accounting for overlap
    start = end - overlap;

    // Prevent infinite loop if overlap >= chunk size
    if (start <= chunks[chunks.length - 1]?.metadata.charStart) {
      start = end;
    }
  }

  return chunks;
}
