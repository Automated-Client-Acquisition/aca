import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MoreHorizontal,
  Play,
  Pause,
  Edit,
  Copy,
  Trash2,
  Eye,
  FileEdit,
  Loader2,
} from "lucide-react";
import type { LinkedInCampaign } from "@/hooks/useCampaigns";
import {
  useDeleteCampaign,
  useDuplicateCampaign,
  useStartCampaign,
  usePauseCampaign,
  useDraftCampaign,
} from "@/hooks/useCampaigns";

interface CampaignActionsProps {
  campaign: LinkedInCampaign;
}

export function CampaignActions({ campaign }: CampaignActionsProps) {
  const navigate = useNavigate();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const deleteCampaign = useDeleteCampaign();
  const duplicateCampaign = useDuplicateCampaign();
  const startCampaign = useStartCampaign();
  const pauseCampaign = usePauseCampaign();
  const draftCampaign = useDraftCampaign();
  const isPending =
    deleteCampaign.isPending ||
    duplicateCampaign.isPending ||
    startCampaign.isPending ||
    pauseCampaign.isPending ||
    draftCampaign.isPending;

  // Defer navigations/mutations one tick past the menu's close cycle. Navigating
  // (or unmounting a re-rendered row) in the same tick the Radix menu closes can
  // skip its body pointer-events cleanup and leave the destination page's clicks
  // dead — the same race the Delete item guards against below.
  const handleView = () => {
    setTimeout(() => navigate(`/campaigns/${campaign.id}`), 0);
  };

  const handleEdit = () => {
    setTimeout(() => navigate(`/campaigns/${campaign.id}/edit`), 0);
  };

  const handleDuplicate = () => {
    setTimeout(() => duplicateCampaign.mutate(campaign.id), 0);
  };

  const handleDelete = () => {
    deleteCampaign.mutate(campaign.id, {
      onSuccess: () => setDeleteDialogOpen(false),
    });
  };

  const handleStartPause = () => {
    setTimeout(() => {
      if (campaign.status === "active") {
        pauseCampaign.mutate(campaign.id);
      } else if (campaign.status === "draft" || campaign.status === "paused") {
        startCampaign.mutate(campaign.id);
      }
    }, 0);
  };

  const canStart = campaign.status === "draft" || campaign.status === "paused";
  const canPause = campaign.status === "active";
  const canDraft = campaign.status === "active" || campaign.status === "paused";
  const canEdit = campaign.status !== "completed";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={isPending}
            aria-label={`${isPending ? "Updating" : "Actions for"} ${campaign.name}`}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleView}>
            <Eye className="h-4 w-4 mr-2" />
            View campaign
          </DropdownMenuItem>

          {canEdit && (
            <DropdownMenuItem onClick={handleEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onClick={handleDuplicate} disabled={isPending}>
            <Copy className="h-4 w-4 mr-2" />
            Duplicate
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {canStart && (
            <DropdownMenuItem onClick={handleStartPause} disabled={isPending}>
              <Play className="h-4 w-4 mr-2" />
              {campaign.status === "paused"
                ? "Resume campaign"
                : "Start campaign"}
            </DropdownMenuItem>
          )}

          {canPause && (
            <DropdownMenuItem onClick={handleStartPause} disabled={isPending}>
              <Pause className="h-4 w-4 mr-2" />
              Pause campaign
            </DropdownMenuItem>
          )}

          {canDraft && (
            <DropdownMenuItem
              disabled={isPending}
              onClick={() =>
                setTimeout(() => draftCampaign.mutate(campaign.id), 0)
              }
            >
              <FileEdit className="h-4 w-4 mr-2" />
              Move to draft
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            // Defer the dialog mount until after the menu's close cycle: opening a
            // modal in the same tick can leave Radix's body pointer-events lock stuck.
            onClick={() => setTimeout(() => setDeleteDialogOpen(true), 0)}
            disabled={isPending}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!deleteCampaign.isPending) setDeleteDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete automation?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{campaign.name}"? This action
              cannot be undone. All automation progress and history will be
              permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCampaign.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
              disabled={deleteCampaign.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCampaign.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
