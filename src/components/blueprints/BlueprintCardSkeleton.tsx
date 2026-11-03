import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function BlueprintCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      {/* Gradient accent bar */}
      <div className="h-1 bg-gradient-to-r from-primary via-primary/80 to-primary/60" />
      
      <CardHeader className="pt-6">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 flex-1">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        <div className="flex gap-2 mt-3">
          <Skeleton className="h-5 w-24 rounded-md" />
        </div>
      </CardHeader>
      
      <CardContent>
        <Skeleton className="h-14 w-full rounded-lg mb-3" />
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-16 rounded-md" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
      </CardContent>
      
      <CardFooter className="border-t bg-muted/30 gap-2">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 flex-1" />
      </CardFooter>
    </Card>
  );
}
