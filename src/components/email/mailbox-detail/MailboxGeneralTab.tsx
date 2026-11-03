import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { SignatureEditor } from "@/components/email/SignatureEditor";
import { useUpdateMailbox } from "@/hooks/useEmailMailboxes";
import { cn } from "@/lib/utils";
import { Save, Loader2 } from "lucide-react";
import type { EmailMailbox } from "@/types/email";

interface MailboxGeneralTabProps {
  mailbox: EmailMailbox;
}

const PROVIDER_LABELS: Record<string, string> = {
  gmail: "Google Gmail",
  outlook: "Microsoft Outlook",
  smtp: "Custom SMTP",
};

const PROVIDER_COLORS: Record<string, string> = {
  gmail: "bg-red-500/10 text-red-600 border-red-500/20",
  outlook: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  smtp: "bg-gray-500/10 text-gray-600 border-gray-500/20",
};

export function MailboxGeneralTab({ mailbox }: MailboxGeneralTabProps) {
  const [displayName, setDisplayName] = useState(mailbox.display_name || "");
  const [firstName, setFirstName] = useState(mailbox.first_name || "");
  const [lastName, setLastName] = useState(mailbox.last_name || "");
  const meta = mailbox.metadata || {};
  const [signature, setSignature] = useState(
    (meta.signature as string) || ""
  );
  const updateMailbox = useUpdateMailbox();

  const isDirty =
    displayName !== (mailbox.display_name || "") ||
    firstName !== (mailbox.first_name || "") ||
    lastName !== (mailbox.last_name || "");
  const isSignatureDirty = signature !== ((meta.signature as string) || "");

  const handleSave = () => {
    updateMailbox.mutate({
      id: mailbox.id,
      columnUpdates: {
        display_name: displayName || null,
        first_name: firstName || null,
        last_name: lastName || null,
      },
    });
  };

  const handleSaveSignature = () => {
    updateMailbox.mutate({
      id: mailbox.id,
      metadataUpdates: { signature: signature || null },
    });
  };

  return (
    <div className="space-y-6">
      {/* Mailbox Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Mailbox Identity
          </CardTitle>
          <CardDescription>Basic mailbox information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Email Address
              </Label>
              <Input value={mailbox.email_address} disabled />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Display Name
              </Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter display name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                First Name
              </Label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="e.g. Mary Jane"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Last Name
              </Label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="e.g. Van Der Berg"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              First and last name fill the{" "}
              <code className="text-[11px]">{"{{sender_first_name}}"}</code> and{" "}
              <code className="text-[11px]">{"{{sender_last_name}}"}</code>{" "}
              variables in your sequences and campaigns. Make sure both are set
              so those variables aren't blank.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || updateMailbox.isPending}
            >
              {updateMailbox.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Provider</Label>
            <div>
              <Badge
                variant="outline"
                className={cn(
                  PROVIDER_COLORS[mailbox.provider || "smtp"] ||
                    PROVIDER_COLORS.smtp
                )}
              >
                {PROVIDER_LABELS[mailbox.provider || "smtp"] || "Unknown"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email Signature */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium">
                Email Signature
              </CardTitle>
              <CardDescription>
                HTML signature appended to outgoing emails
              </CardDescription>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSaveSignature}
              disabled={!isSignatureDirty || updateMailbox.isPending}
            >
              {updateMailbox.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <SignatureEditor
            value={signature}
            onChange={setSignature}
            label=""
            hint="Use the Visual tab for WYSIWYG editing, or switch to HTML to paste your signature code directly."
          />
        </CardContent>
      </Card>

      {/* ZapMail Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            ZapMail Details
          </CardTitle>
          <CardDescription>
            Integration metadata from ZapMail
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <MetadataField
              label="ZapMail Mailbox ID"
              value={mailbox.zapmail_mailbox_id}
            />
            <MetadataField
              label="Workspace ID"
              value={meta.zapmail_workspace_id as string}
            />
            <MetadataField
              label="Domain"
              value={meta.zapmail_domain as string}
            />
            <MetadataField
              label="ZapMail Status"
              value={meta.zapmail_status as string}
            />
            <MetadataField
              label="Assigned On"
              value={
                meta.zapmail_assigned_on
                  ? new Date(
                      meta.zapmail_assigned_on as string
                    ).toLocaleDateString()
                  : null
              }
            />
            <MetadataField
              label="Expires On"
              value={
                meta.zapmail_expire_on
                  ? new Date(
                      meta.zapmail_expire_on as string
                    ).toLocaleDateString()
                  : null
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Connection Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Connection Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <MetadataField
              label="Connection Type"
              value={mailbox.connection_type}
            />
            <MetadataField
              label="Created"
              value={new Date(mailbox.created_at).toLocaleString()}
            />
            <MetadataField
              label="Last Updated"
              value={new Date(mailbox.updated_at).toLocaleString()}
            />
            <MetadataField
              label="Last Synced"
              value={
                meta.last_sync_at
                  ? new Date(meta.last_sync_at as string).toLocaleString()
                  : null
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetadataField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium font-mono">
        {value || <span className="text-muted-foreground">N/A</span>}
      </p>
    </div>
  );
}
