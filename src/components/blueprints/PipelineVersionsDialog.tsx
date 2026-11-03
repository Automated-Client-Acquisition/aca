import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, FileText } from "lucide-react";
import { useCreatePipelineVersion } from "@/hooks/usePipelineVersioning";

interface PipelineVersionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blueprintId: string;
  blueprintName: string;
}

export function PipelineVersionsDialog({
  open,
  onOpenChange,
}: PipelineVersionsDialogProps) {
  const createVersion = useCreatePipelineVersion();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Pipeline Versioning
          </DialogTitle>
          <DialogDescription>
            Version control and snapshots (coming soon)
          </DialogDescription>
        </DialogHeader>

        <div className="py-8">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center space-y-3">
                <Clock className="h-12 w-12 mx-auto text-muted-foreground" />
                <h3 className="font-medium">Pipeline Versioning</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Version control allows you to save snapshots of your pipeline configuration 
                  and restore previous versions. This feature requires database schema updates 
                  and will be available after migration.
                </p>
                <Badge variant="secondary">Coming Soon</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
