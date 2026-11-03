import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import type { KnowledgeDocumentStatus } from "@/hooks/useKnowledgeBase";

interface DocumentStatusBadgeProps {
  status: KnowledgeDocumentStatus;
  className?: string;
}

const statusConfig: Record<
  KnowledgeDocumentStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  pending: {
    label: "Pending",
    variant: "secondary",
    icon: <Clock className="h-3 w-3" />,
  },
  processing: {
    label: "Processing",
    variant: "default",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  completed: {
    label: "Ready",
    variant: "outline",
    icon: <CheckCircle2 className="h-3 w-3 text-green-600" />,
  },
  failed: {
    label: "Failed",
    variant: "destructive",
    icon: <XCircle className="h-3 w-3" />,
  },
};

export function DocumentStatusBadge({ status, className }: DocumentStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge variant={config.variant} className={className}>
      <span className="flex items-center gap-1">
        {config.icon}
        {config.label}
      </span>
    </Badge>
  );
}
