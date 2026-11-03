import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";
import { StrategyDocument, StrategyDocumentType } from "@/types/strategyDocument";

export function useStrategyDocuments(documentType?: StrategyDocumentType) {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: documents, isLoading, error } = useQuery({
    queryKey: documentType
      ? ["strategy-documents", currentOrganization?.id, documentType]
      : ["strategy-documents", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      let query = supabase
        .from("library_strategy_documents")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (documentType) {
        query = query.eq("document_type", documentType);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as StrategyDocument[];
    },
  });

  const createDocument = useMutation({
    mutationFn: async (newDocument: Partial<StrategyDocument>) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      const { data, error } = await supabase
        .from("library_strategy_documents")
        .insert([{ ...newDocument, organization_id: currentOrganization.id } as any])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategy-documents", currentOrganization?.id] });
      toast.success("Strategy document created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create document: ${error.message}`);
    },
  });

  const updateDocument = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<StrategyDocument> }) => {
      if (!currentOrganization) throw new Error('No organization context');
      const { data, error } = await supabase
        .from("library_strategy_documents")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategy-documents", currentOrganization?.id] });
      toast.success("Strategy document updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update document: ${error.message}`);
    },
  });

  const deleteDocument = useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error('No organization context');
      const { error } = await supabase
        .from("library_strategy_documents")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategy-documents", currentOrganization?.id] });
      toast.success("Strategy document deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete document: ${error.message}`);
    },
  });

  const deleteBulkDocuments = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentOrganization) throw new Error('No organization context');
      await chunkedMutate(ids, (chunk) =>
        supabase.from("library_strategy_documents").delete().in("id", chunk).eq("organization_id", currentOrganization.id)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["strategy-documents", currentOrganization?.id] });
      toast.success(`Successfully deleted ${ids.length} document${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete documents: ${error.message}`);
    },
  });

  return {
    documents: documents || [],
    isLoading,
    error,
    createDocument: (data: Partial<StrategyDocument>) => createDocument.mutateAsync(data),
    updateDocument: (id: string, updates: Partial<StrategyDocument>) => updateDocument.mutateAsync({ id, updates }),
    deleteDocument: (id: string) => deleteDocument.mutate(id),
    deleteBulkDocuments: (ids: string[]) => deleteBulkDocuments.mutate(ids),
    isCreating: createDocument.isPending,
    isUpdating: updateDocument.isPending,
    isDeleting: deleteDocument.isPending,
    isDeletingBulk: deleteBulkDocuments.isPending,
  };
}

// Hook for fetching a single document
export function useStrategyDocument(documentId: string | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["strategy-document", currentOrganization?.id, documentId],
    enabled: !!documentId && !!currentOrganization,
    queryFn: async () => {
      if (!documentId || !currentOrganization) return null;

      const { data, error } = await supabase
        .from("library_strategy_documents")
        .select("*")
        .eq("id", documentId)
        .eq("organization_id", currentOrganization.id)
        .single();

      if (error) throw error;
      return data as StrategyDocument;
    },
  });
}
