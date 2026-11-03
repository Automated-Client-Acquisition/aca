import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Mail, AlertTriangle } from "lucide-react";
import { useEmailMailboxes } from "@/hooks/useEmailMailboxes";
import { MailboxPickerSheet } from "./MailboxPickerSheet";
import { getMailboxStatusInfo } from "@/lib/mailbox-status";
import { cn } from "@/lib/utils";

interface MailboxPickerButtonProps {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  className?: string;
}

export function MailboxPickerButton({
  value,
  onChange,
  placeholder = "Select mailbox",
  className,
}: MailboxPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const { data: mailboxes = [] } = useEmailMailboxes();

  const selected = value ? mailboxes.find((m) => m.id === value) : null;
  const domain = selected?.email_address.split("@")[1];
  const workspaceName = (selected?.metadata as Record<string, unknown> | undefined)
    ?.zapmail_workspace_name as string | undefined;

  const statusInfo = selected ? getMailboxStatusInfo(selected) : null;
  const isUnhealthy = statusInfo?.unhealthy ?? false;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn(
          "w-full justify-between font-normal h-auto py-2",
          !selected && "text-muted-foreground",
          className
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Mail className="h-4 w-4 shrink-0 opacity-60" />
          {selected ? (
            <span className="flex flex-col items-start min-w-0">
              <span className="text-sm truncate flex items-center gap-1.5">
                {selected.email_address}
                {isUnhealthy && (
                  <AlertTriangle
                    className="h-3 w-3 text-orange-500 shrink-0"
                    aria-label={statusInfo?.reason ?? "Connection issue"}
                  >
                    <title>{statusInfo?.reason ?? "Connection issue"}</title>
                  </AlertTriangle>
                )}
              </span>
              {(workspaceName || domain) && (
                <span className="text-[11px] text-muted-foreground truncate">
                  {[workspaceName, domain].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>

      <MailboxPickerSheet
        open={open}
        onOpenChange={setOpen}
        mode="single"
        selectedIds={value ? [value] : []}
        onChange={(ids) => onChange(ids[0] ?? null)}
        title="Select sending mailbox"
        description="The mailbox this email step will send from."
        showPresets={false}
      />
    </>
  );
}
