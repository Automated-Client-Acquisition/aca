import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { chunkedMutate } from '@/hooks/crm/useContacts';

// Types
export type KnowledgeDocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type KnowledgeDocumentFileType = 'pdf' | 'txt' | 'docx' | 'md';

export interface KnowledgeDocument {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  file_path: string | null;
  file_type: KnowledgeDocumentFileType;
  file_size_bytes: number | null;
  status: KnowledgeDocumentStatus;
  processing_error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface UploadKnowledgeDocumentParams {
  name: string;
  description?: string;
  file: File;
}

// File type mapping
const FILE_TYPE_MAP: Record<string, KnowledgeDocumentFileType> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const VALID_MIME_TYPES = Object.keys(FILE_TYPE_MAP);
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Hook to fetch all knowledge documents for the current organization
 */
export function useKnowledgeDocuments() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['knowledge-documents', currentOrganization?.id],
    queryFn: async (): Promise<KnowledgeDocument[]> => {
      if (!currentOrganization?.id) {
        return [];
      }

      const { data, error } = await supabase
        .from('knowledge_base_documents')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Knowledge Base] Failed to fetch documents:', error);
        throw new Error(`Failed to load documents: ${error.message}`);
      }

      return (data || []) as KnowledgeDocument[];
    },
    enabled: !!currentOrganization?.id,
    refetchInterval: (query) => {
      // Refetch every 5 seconds if any document is processing
      const data = query.state.data as KnowledgeDocument[] | undefined;
      const hasProcessing = data?.some((doc) => doc.status === 'pending' || doc.status === 'processing');
      return hasProcessing ? 5000 : false;
    },
  });
}

/**
 * Hook to fetch a single knowledge document
 */
export function useKnowledgeDocument(documentId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['knowledge-document', currentOrganization?.id, documentId],
    queryFn: async (): Promise<KnowledgeDocument | null> => {
      if (!documentId || !currentOrganization?.id) {
        return null;
      }

      const { data, error } = await supabase
        .from('knowledge_base_documents')
        .select('*')
        .eq('id', documentId)
        .eq('organization_id', currentOrganization.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to load document: ${error.message}`);
      }

      return data as KnowledgeDocument;
    },
    enabled: !!documentId && !!currentOrganization?.id,
  });
}

/**
 * Hook to upload a new knowledge document
 *
 * 1. Validates file type and size
 * 2. Uploads file to Supabase Storage
 * 3. Creates document record
 * 4. Triggers processing edge function
 */
export function useUploadKnowledgeDocument() {
  const { currentOrganization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UploadKnowledgeDocumentParams): Promise<KnowledgeDocument> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      const { name, description, file } = params;

      // Validate file type
      const fileType = FILE_TYPE_MAP[file.type];
      if (!fileType) {
        throw new Error(
          `Unsupported file type: ${file.type}. Supported types: PDF, TXT, DOCX, MD`
        );
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(
          `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 25MB.`
        );
      }

      // Generate file path: org_id/timestamp_sanitized_name.ext
      const timestamp = Date.now();
      const ext = file.name.split('.').pop() || fileType;
      const safeName = name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 50);
      const filePath = `${currentOrganization.id}/${timestamp}_${safeName}.${ext}`;

      console.log('[Knowledge Base] Uploading file:', filePath, file.size, 'bytes');

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('knowledge-base')
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error('[Knowledge Base] Upload failed:', uploadError);
        throw new Error(`Failed to upload file: ${uploadError.message}`);
      }

      console.log('[Knowledge Base] File uploaded, creating document record...');

      // Create document record
      const { data: document, error: insertError } = await supabase
        .from('knowledge_base_documents')
        .insert({
          organization_id: currentOrganization.id,
          name,
          description: description || null,
          file_path: filePath,
          file_type: fileType,
          file_size_bytes: file.size,
          status: 'pending',
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (insertError) {
        // Try to clean up uploaded file
        await supabase.storage.from('knowledge-base').remove([filePath]);
        throw new Error(`Failed to create document: ${insertError.message}`);
      }

      console.log('[Knowledge Base] Document created:', document.id);

      // Trigger processing edge function
      try {
        const { error: processError } = await supabase.functions.invoke(
          'process-knowledge-document',
          {
            body: { documentId: document.id },
          }
        );

        if (processError) {
          console.error('[Knowledge Base] Processing trigger failed:', processError);
          // Don't throw - document is created, processing can be retried
        }
      } catch (err) {
        console.error('[Knowledge Base] Failed to invoke processing function:', err);
      }

      return document as KnowledgeDocument;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-documents'] });
      toast.success('Document uploaded', {
        description: 'Processing will begin shortly.',
      });
    },
    onError: (error) => {
      toast.error('Upload failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
}

/**
 * Hook to delete a knowledge document
 */
export function useDeleteKnowledgeDocument() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string): Promise<void> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      // Get document to find file path
      const { data: document, error: fetchError } = await supabase
        .from('knowledge_base_documents')
        .select('file_path')
        .eq('id', documentId)
        .eq('organization_id', currentOrganization.id)
        .single();

      if (fetchError) {
        throw new Error(`Document not found: ${fetchError.message}`);
      }

      // Delete file from storage
      if (document.file_path) {
        const { error: storageError } = await supabase.storage
          .from('knowledge-base')
          .remove([document.file_path]);

        if (storageError) {
          console.error('[Knowledge Base] Failed to delete file:', storageError);
          // Continue anyway - file cleanup can be done later
        }
      }

      // Delete document record (chunks deleted via CASCADE)
      const { error: deleteError } = await supabase
        .from('knowledge_base_documents')
        .delete()
        .eq('id', documentId)
        .eq('organization_id', currentOrganization.id);

      if (deleteError) {
        throw new Error(`Failed to delete document: ${deleteError.message}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-documents'] });
      toast.success('Document deleted');
    },
    onError: (error) => {
      toast.error('Delete failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
}

/**
 * Hook to reprocess a failed document
 */
export function useReprocessKnowledgeDocument() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string): Promise<void> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      // Reset status to pending
      const { error: updateError } = await supabase
        .from('knowledge_base_documents')
        .update({
          status: 'pending',
          processing_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId)
        .eq('organization_id', currentOrganization.id);

      if (updateError) {
        throw new Error(`Failed to reset document: ${updateError.message}`);
      }

      // Trigger processing
      const { error: processError } = await supabase.functions.invoke(
        'process-knowledge-document',
        {
          body: { documentId },
        }
      );

      if (processError) {
        throw new Error(`Failed to trigger processing: ${processError.message}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-documents'] });
      toast.success('Reprocessing started');
    },
    onError: (error) => {
      toast.error('Reprocess failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
}

/**
 * Hook to bulk re-index multiple documents
 */
export function useBulkReindexDocuments() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentIds: string[]): Promise<void> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      // Reset all selected documents to pending
      await chunkedMutate(documentIds, (chunk) =>
        supabase
          .from('knowledge_base_documents')
          .update({
            status: 'pending',
            processing_error: null,
            updated_at: new Date().toISOString(),
          })
          .in('id', chunk)
          .eq('organization_id', currentOrganization.id)
      );

      // Fire processing for each document (don't await sequentially — fire all)
      const results = await Promise.allSettled(
        documentIds.map((documentId) =>
          supabase.functions.invoke('process-knowledge-document', {
            body: { documentId },
          })
        )
      );

      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        console.error('[Knowledge Base] Some re-index triggers failed:', failures);
      }
    },
    onSuccess: (_data, documentIds) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-documents'] });
      toast.success(`Re-indexing ${documentIds.length} document${documentIds.length > 1 ? 's' : ''}`, {
        description: 'Processing will begin shortly.',
      });
    },
    onError: (error) => {
      toast.error('Re-index failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
}

/**
 * Hook to rename a knowledge document
 */
export function useRenameKnowledgeDocument() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ documentId, name, description }: { documentId: string; name: string; description?: string | null }): Promise<void> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      const updates: Record<string, unknown> = {
        name,
        updated_at: new Date().toISOString(),
      };
      if (description !== undefined) {
        updates.description = description || null;
      }

      const { error } = await supabase
        .from('knowledge_base_documents')
        .update(updates)
        .eq('id', documentId)
        .eq('organization_id', currentOrganization.id);

      if (error) {
        throw new Error(`Failed to rename document: ${error.message}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-documents'] });
      toast.success('Document renamed');
    },
    onError: (error) => {
      toast.error('Rename failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
}

/**
 * Hook to replace a document's file and re-process it.
 * Uploads new file, removes old file, updates record, triggers re-processing.
 */
export function useReplaceKnowledgeDocumentFile() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ documentId, file }: { documentId: string; file: File }): Promise<void> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      // Validate file type
      const fileType = FILE_TYPE_MAP[file.type];
      if (!fileType) {
        throw new Error(`Unsupported file type. Supported: PDF, TXT, DOCX, MD`);
      }

      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 25MB.`);
      }

      // Get existing document to find old file path
      const { data: document, error: fetchError } = await supabase
        .from('knowledge_base_documents')
        .select('file_path, name')
        .eq('id', documentId)
        .eq('organization_id', currentOrganization.id)
        .single();

      if (fetchError || !document) {
        throw new Error('Document not found');
      }

      // Upload new file
      const timestamp = Date.now();
      const ext = file.name.split('.').pop() || fileType;
      const safeName = (document.name || 'doc').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 50);
      const newFilePath = `${currentOrganization.id}/${timestamp}_${safeName}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('knowledge-base')
        .upload(newFilePath, file, { contentType: file.type, upsert: false });

      if (uploadError) {
        throw new Error(`Failed to upload file: ${uploadError.message}`);
      }

      // Remove old file from storage
      if (document.file_path) {
        await supabase.storage.from('knowledge-base').remove([document.file_path]).catch(() => {});
      }

      // Update document record — reset status so it gets re-processed
      const { error: updateError } = await supabase
        .from('knowledge_base_documents')
        .update({
          file_path: newFilePath,
          file_type: fileType,
          file_size_bytes: file.size,
          status: 'pending',
          processing_error: null,
          chunk_count: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId)
        .eq('organization_id', currentOrganization.id);

      if (updateError) {
        // Try to clean up newly uploaded file
        await supabase.storage.from('knowledge-base').remove([newFilePath]).catch(() => {});
        throw new Error(`Failed to update document: ${updateError.message}`);
      }

      // Trigger re-processing (old chunks are deleted + replaced by the edge function)
      const { error: processError } = await supabase.functions.invoke(
        'process-knowledge-document',
        { body: { documentId } }
      );

      if (processError) {
        console.error('[Knowledge Base] Processing trigger failed after file replace:', processError);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-documents'] });
      toast.success('Document updated', {
        description: 'File replaced. Re-processing will begin shortly.',
      });
    },
    onError: (error) => {
      toast.error('Update failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
}

/**
 * Hook to get completed knowledge documents (for campaign selector)
 */
export function useCompletedKnowledgeDocuments() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['knowledge-documents-completed', currentOrganization?.id],
    queryFn: async (): Promise<KnowledgeDocument[]> => {
      if (!currentOrganization?.id) {
        return [];
      }

      const { data, error } = await supabase
        .from('knowledge_base_documents')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .eq('status', 'completed')
        .order('name', { ascending: true });

      if (error) {
        throw new Error(`Failed to load documents: ${error.message}`);
      }

      return (data || []) as KnowledgeDocument[];
    },
    enabled: !!currentOrganization?.id,
  });
}
