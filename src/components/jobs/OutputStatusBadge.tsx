import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface OutputStatusBadgeProps {
  status: 'generating' | 'review' | 'approved' | 'rejected';
}

export function OutputStatusBadge({ status }: OutputStatusBadgeProps) {
  const config = {
    generating: {
      label: 'Generating',
      className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-0',
      icon: <Loader2 className="w-3 h-3 animate-spin" />
    },
    review: {
      label: 'Review',
      className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-0',
      icon: null
    },
    approved: {
      label: 'Approved',
      className: 'bg-green-500/10 text-green-700 dark:text-green-400 border-0',
      icon: null
    },
    rejected: {
      label: 'Rejected',
      className: 'bg-red-500/10 text-red-700 dark:text-red-400 border-0',
      icon: null
    }
  };

  const { label, className, icon } = config[status];

  return (
    <Badge variant="outline" className={className}>
      {icon}
      {label}
    </Badge>
  );
}
