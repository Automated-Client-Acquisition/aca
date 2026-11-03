import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Users, Upload } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { LeadListsTable } from "@/components/lead-lists/LeadListsTable";
import { CreateListDialog } from "@/components/lead-lists/CreateListDialog";
import { EditListDialog } from "@/components/lead-lists/EditListDialog";
import { DeleteListDialog } from "@/components/lead-lists/DeleteListDialog";
import { MergeListsDialog } from "@/components/lead-lists/MergeListsDialog";
import { BulkDeleteListsDialog } from "@/components/lead-lists/BulkDeleteListsDialog";
import {
  useLeadLists,
  useCreateLeadList,
  useUpdateLeadList,
  useDeleteLeadList,
  useArchiveLeadList,
  useBulkDeleteLeadLists,
  type LeadList,
} from "@/hooks/useLeadLists";

export default function LeadLists() {
  const navigate = useNavigate();
  const { leadLists, isLoading } = useLeadLists();
  const createMutation = useCreateLeadList();
  const updateMutation = useUpdateLeadList();
  const deleteMutation = useDeleteLeadList();
  const archiveMutation = useArchiveLeadList();
  const bulkDeleteMutation = useBulkDeleteLeadLists();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingList, setEditingList] = useState<LeadList | null>(null);
  const [deletingList, setDeletingList] = useState<LeadList | null>(null);
  const [mergingLists, setMergingLists] = useState<LeadList[] | null>(null);
  const [deletingLists, setDeletingLists] = useState<LeadList[] | null>(null);

  const handleCreate = (data: { name: string; description?: string }) => {
    createMutation.mutate(data, {
      onSuccess: () => setShowCreateDialog(false),
    });
  };

  const handleEdit = (data: { id: string; name?: string; description?: string }) => {
    updateMutation.mutate(data, {
      onSuccess: () => setEditingList(null),
    });
  };

  const handleDelete = () => {
    if (!deletingList) return;
    deleteMutation.mutate(deletingList.id, {
      onSuccess: () => setDeletingList(null),
    });
  };

  const handleArchive = (list: LeadList) => {
    archiveMutation.mutate(list.id);
  };

  const handleBulkDelete = () => {
    if (!deletingLists) return;
    bulkDeleteMutation.mutate(
      deletingLists.map((l) => l.id),
      { onSuccess: () => setDeletingLists(null) }
    );
  };

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1400px] mx-auto space-y-6">
          {/* Header */}
          <PageHeader
            icon={Users}
            title="Lead Lists"
            description="Organize and manage your leads with lists"
            actions={
              <>
                <Button variant="outline" onClick={() => navigate("/leads/import")}>
                  <Upload className="h-4 w-4 mr-2" />
                  Import Leads
                </Button>
                <Button variant="cta" onClick={() => setShowCreateDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create List
                </Button>
              </>
            }
          />

          {/* Lists Table */}
          <LeadListsTable
            lists={leadLists}
            isLoading={isLoading}
            onEdit={setEditingList}
            onDelete={setDeletingList}
            onArchive={handleArchive}
            onMerge={setMergingLists}
            onBulkDelete={setDeletingLists}
          />
        </div>
      </div>

      {/* Dialogs */}
      <CreateListDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={handleCreate}
        isLoading={createMutation.isPending}
      />

      <EditListDialog
        list={editingList}
        open={!!editingList}
        onOpenChange={(open) => !open && setEditingList(null)}
        onSubmit={handleEdit}
        isLoading={updateMutation.isPending}
      />

      <DeleteListDialog
        list={deletingList}
        open={!!deletingList}
        onOpenChange={(open) => !open && setDeletingList(null)}
        onConfirm={handleDelete}
        isLoading={deleteMutation.isPending}
      />

      <MergeListsDialog
        lists={mergingLists ?? []}
        allLists={leadLists}
        open={!!mergingLists}
        onOpenChange={(open) => !open && setMergingLists(null)}
        onMerged={() => setMergingLists(null)}
      />

      <BulkDeleteListsDialog
        lists={deletingLists ?? []}
        open={!!deletingLists}
        onOpenChange={(open) => !open && setDeletingLists(null)}
        onConfirm={handleBulkDelete}
        isLoading={bulkDeleteMutation.isPending}
      />
    </AppLayout>
  );
}
