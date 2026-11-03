import { Card, CardContent } from "@/components/ui/card";
import { CreateBlueprintDialog } from "./CreateBlueprintDialog";
import { FileText, Video, Image, Zap } from "lucide-react";

export function BlueprintEmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-6 relative">
          <div className="absolute inset-0 bg-primary/5 rounded-full blur-2xl" />
          <div className="relative bg-primary/10 p-6 rounded-full">
            <FileText className="h-12 w-12 text-primary" />
          </div>
        </div>
        
        <h3 className="text-2xl font-semibold mb-3">No blueprints yet</h3>
        <p className="text-muted-foreground mb-6 max-w-md">
          Blueprints are reusable templates for AI content generation. Create your first blueprint to get started.
        </p>

        {/* Quick Start Tips */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 max-w-2xl w-full">
          <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
            <Video className="h-6 w-6 text-blue-500 mb-2 mx-auto" />
            <p className="text-sm font-medium mb-1">Video Content</p>
            <p className="text-xs text-muted-foreground">Create viral video scripts</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
            <Image className="h-6 w-6 text-pink-500 mb-2 mx-auto" />
            <p className="text-sm font-medium mb-1">Social Media</p>
            <p className="text-xs text-muted-foreground">Generate engaging posts</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
            <Zap className="h-6 w-6 text-cta mb-2 mx-auto" />
            <p className="text-sm font-medium mb-1">Automation</p>
            <p className="text-xs text-muted-foreground">Build content pipelines</p>
          </div>
        </div>

        <CreateBlueprintDialog />
      </CardContent>
    </Card>
  );
}
