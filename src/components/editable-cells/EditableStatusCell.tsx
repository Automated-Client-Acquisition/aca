import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ContactStatus = 'active' | 'archived' | 'bounced' | 'unsubscribed' | 'do_not_contact';

interface EditableStatusCellProps {
  status: ContactStatus;
  onSave: (status: ContactStatus) => Promise<void>;
  className?: string;
}

const STATUS_OPTIONS: { value: ContactStatus; label: string; color: string }[] = [
  { value: 'active', label: 'Active', color: 'status-success' },
  { value: 'archived', label: 'Archived', color: '' },
  { value: 'bounced', label: 'Bounced', color: 'status-error' },
  { value: 'unsubscribed', label: 'Unsubscribed', color: 'status-warning' },
  { value: 'do_not_contact', label: 'Do Not Contact', color: 'status-error' },
];

function getStatusConfig(status: ContactStatus) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
}

export function EditableStatusCell({
  status,
  onSave,
  className,
}: EditableStatusCellProps) {
  const [isSaving, setIsSaving] = useState(false);
  const config = getStatusConfig(status);

  const handleChange = async (newStatus: ContactStatus) => {
    if (newStatus === status) return;

    setIsSaving(true);
    try {
      await onSave(newStatus);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Select value={status} onValueChange={handleChange} disabled={isSaving}>
        <SelectTrigger className="h-7 w-auto border-none bg-transparent hover:bg-muted/50 focus:ring-0 px-0">
          <SelectValue>
            <Badge variant={config.color ? "status" : "secondary"} className={cn("text-xs font-normal", config.color)}>
              {config.label}
            </Badge>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <Badge variant={option.color ? "status" : "secondary"} className={cn("text-xs font-normal", option.color)}>
                {option.label}
              </Badge>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isSaving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
    </div>
  );
}
