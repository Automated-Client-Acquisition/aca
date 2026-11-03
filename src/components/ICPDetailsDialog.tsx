import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useAutosave } from "@/hooks/useAutosave";
import { useState, useEffect } from "react";
import { Users, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/tableUtils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { ICP } from "@/hooks/useICPs";
import { IcpBasicsFields, IcpBasicsValue } from "./IcpBasicsFields";
import { IcpTargetingFields, IcpTargetingValue } from "./IcpTargetingFields";

interface ICPDetailsDialogProps {
  icp: ICP | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<ICP>) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
}

export function ICPDetailsDialog({ icp, open, onOpenChange, onSave, onDelete, isUpdating }: ICPDetailsDialogProps) {
  const [edited, setEdited] = useState<Partial<ICP>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [dmSectionOpen, setDmSectionOpen] = useState(false);

  useEffect(() => {
    if (!open || !icp) {
      setEdited({});
      setDmSectionOpen(false);
    } else {
      // Auto-open DM section if it has data
      const hasDmData = (icp.target_seniorities?.length ?? 0) > 0 ||
        (icp.target_departments?.length ?? 0) > 0 ||
        (icp.target_title_keywords?.length ?? 0) > 0 ||
        !!icp.decision_maker_notes;
      setDmSectionOpen(hasDmData);
    }
  }, [open, icp?.id]);

  const { isSaving } = useAutosave(
    (updates) => {
      if (icp) {
        onSave(icp.id, updates);
      }
    },
    edited,
    1000,
    Object.keys(edited).length > 0 && !isUpdating
  );

  const handleSave = () => {
    if (icp && Object.keys(edited).length > 0) {
      onSave(icp.id, edited);
      setEdited({});
      onOpenChange(false);
    } else {
      onOpenChange(false);
    }
  };

  const handleDelete = () => {
    if (icp) {
      onDelete(icp.id);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    }
  };

  if (!icp) return null;

  const basics: IcpBasicsValue = {
    name: edited.name ?? icp.name,
    summary: edited.summary ?? icp.summary ?? "",
    description: edited.description ?? icp.description ?? "",
  };

  const targeting: IcpTargetingValue = {
    pain_points: edited.pain_points ?? icp.pain_points ?? [],
    desires: edited.desires ?? icp.desires ?? [],
    objections: edited.objections ?? icp.objections ?? [],
    language_style: edited.language_style ?? icp.language_style ?? "",
    tags: edited.tags ?? icp.tags ?? [],
    target_locations: edited.target_locations ?? icp.target_locations ?? [],
    target_employee_bands: edited.target_employee_bands ?? icp.target_employee_bands ?? [],
    target_revenue_bands: edited.target_revenue_bands ?? icp.target_revenue_bands ?? [],
    target_industries: edited.target_industries ?? icp.target_industries ?? [],
    target_seniorities: edited.target_seniorities ?? icp.target_seniorities ?? [],
    target_departments: edited.target_departments ?? icp.target_departments ?? [],
    target_title_keywords: edited.target_title_keywords ?? icp.target_title_keywords ?? [],
    decision_maker_notes: edited.decision_maker_notes ?? icp.decision_maker_notes ?? "",
  };

  const handleBasicsChange = <K extends keyof IcpBasicsValue>(field: K, value: IcpBasicsValue[K]) => {
    setEdited((prev) => ({ ...prev, [field]: value }));
  };

  const handleTargetingChange = <K extends keyof IcpTargetingValue>(field: K, value: IcpTargetingValue[K]) => {
    setEdited((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-4xl p-0">
          <form className="flex flex-col flex-1 min-h-0" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <Users className="w-5 h-5 text-foreground" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl">Edit Target Audience</DialogTitle>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(icp.created_at)}
                      </span>
                      {targeting.tags.slice(0, 3).map((tag, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {targeting.tags.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{targeting.tags.length - 3}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <AutosaveIndicator isSaving={isSaving} />
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-6 px-8 py-6">
                <IcpBasicsFields value={basics} onChange={handleBasicsChange} />

                <IcpTargetingFields
                  value={targeting}
                  onChange={handleTargetingChange}
                  dmSectionOpen={dmSectionOpen}
                  onDmSectionOpenChange={setDmSectionOpen}
                />
              </div>
            </ScrollArea>

            <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t">
              <Button
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={isUpdating}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Audience
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="min-w-24"
              >
                Close
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Target Audience</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{icp.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
