import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

interface StageProgressCardProps {
  title: string;
  count: number;
  subtitle?: string;
  icon?: LucideIcon;
}

export function StageProgressCard({
  title,
  count,
  subtitle,
  icon: Icon,
}: StageProgressCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {Icon ? <Icon className="h-4 w-4" /> : null}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{count.toLocaleString()}</div>
        {subtitle ? (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
