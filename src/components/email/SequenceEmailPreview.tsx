import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { RefreshCw, Eye, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PreviewContactPicker } from "@/components/email/PreviewContactPicker";
import { previewMessage } from "@/lib/message-variables";
import {
  buildEmailPreviewVariables,
  resolveEmailPreview,
} from "@/lib/email-preview-variables";
import { useEmailPreviewEnrollment } from "@/hooks/useEmailPreviewEnrollment";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";
import {
  normalizeEmailEditorHtml,
  plainTextToEmailEditorHtml,
} from "@/lib/email-editor-html";
import type { CrmContact } from "@/hooks/crm/useContacts";
import type { EmailSequenceStep, EmailMailbox } from "@/types/email";

interface SequenceEmailPreviewProps {
  step: EmailSequenceStep;
  sequenceId: string;
  contact: CrmContact | null;
  onContactChange: (contact: CrmContact | null) => void;
  mailboxes: EmailMailbox[];
  mailboxIds?: string[];
  previousSubject?: string;
  variableDefaults?: Record<string, string>;
}

export function SequenceEmailPreview({
  step,
  sequenceId,
  contact,
  onContactChange,
  mailboxes,
  mailboxIds,
  previousSubject,
  variableDefaults,
}: SequenceEmailPreviewProps) {
  const [variation, setVariation] = useState(0);
  const [selectedSenderId, setSelectedSenderId] = useState<string | null>(null);
  const [selectedVariantLabel, setSelectedVariantLabel] = useState<
    string | null
  >(null);
  const enrollment = useEmailPreviewEnrollment(
    sequenceId,
    contact?.id,
    contact?.primary_email,
  );
  const customFields = useCustomFieldDefs();
  const previewVariant =
    step.type === "ab_test"
      ? step.variants?.find(
          (variant) => variant.variant_label === selectedVariantLabel,
        ) || step.variants?.[0]
      : undefined;
  const email = step.type === "ab_test" ? previewVariant : step;
  const subject =
    email?.subject ||
    (previousSubject ? `Re: ${previousSubject.replace(/^Re:\s*/i, "")}` : "");
  const body = email?.body || "";
  const format = email?.body_format;
  const sender =
    mailboxes.find((mailbox) => mailbox.id === selectedSenderId) ||
    mailboxes.find((mailbox) => mailbox.id === enrollment.data?.mailbox_id) ||
    mailboxes.find(
      (mailbox) =>
        mailboxIds?.includes(mailbox.id) && mailbox.status === "ready",
    ) ||
    mailboxes.find((mailbox) => mailbox.status === "ready");
  const senderName = contact
    ? sender?.display_name || sender?.email_address || "Sender not selected"
    : "Jane Smith";
  const loading = !!contact && (enrollment.isLoading || customFields.isLoading);
  const failed = !!contact && (enrollment.isError || customFields.isError);

  const preview = useMemo(() => {
    const isHtml =
      format === "html" ||
      /<(br|p|div|ul|ol|li|a|strong|em|b|i|u|span|h[1-6]|blockquote|img|table)[\s/>]/i.test(
        body,
      );
    if (!contact) {
      const resolved = previewMessage(
        body.replace(/\{\{signature\}\}/g, "Jane Smith"),
        variableDefaults,
      );
      return {
        subject: previewMessage(subject, variableDefaults),
        html: DOMPurify.sanitize(
          normalizeEmailEditorHtml(
            isHtml ? resolved : plainTextToEmailEditorHtml(resolved),
          ),
        ),
        missing: [],
        deferred: [],
      };
    }
    const name = sender?.display_name || "";
    const vars = buildEmailPreviewVariables({
      contact,
      lead: enrollment.data?.lead,
      customData: enrollment.data?.custom_data,
      sender: {
        signature:
          typeof sender?.metadata?.signature === "string"
            ? sender.metadata.signature
            : "",
        senderName: name,
        senderFirstName: sender?.first_name || name.split(" ")[0] || "",
        senderLastName:
          sender?.last_name || name.split(" ").slice(1).join(" ") || "",
      },
      customFieldDefaults: Object.fromEntries(
        (customFields.data || [])
          .filter((field) => field.default_value)
          .map((field) => [field.field_key, field.default_value!]),
      ),
      defaults: variableDefaults,
    });
    const seed = `${contact.id}-${variation}`;
    const renderedBody = resolveEmailPreview(
      isHtml ? body : plainTextToEmailEditorHtml(body),
      vars,
      seed,
      true,
    );
    const renderedSubject = resolveEmailPreview(subject, vars, seed);
    return {
      subject: renderedSubject.text,
      html: DOMPurify.sanitize(normalizeEmailEditorHtml(renderedBody.text)),
      missing: [
        ...new Set([...renderedSubject.missing, ...renderedBody.missing]),
      ],
      deferred: [
        ...new Set([...renderedSubject.deferred, ...renderedBody.deferred]),
      ],
    };
  }, [
    subject,
    body,
    format,
    variation,
    variableDefaults,
    contact,
    sender,
    enrollment.data,
    customFields.data,
  ]);

  return (
    <aside
      aria-label="Email preview"
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Eye className="h-4 w-4 text-muted-foreground" />
          Recipient preview
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Refresh preview variation"
          onClick={() => setVariation((value) => value + 1)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="space-y-3 border-b bg-muted/10 p-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Test contact</p>
          <PreviewContactPicker contact={contact} onSelect={onContactChange} />
        </div>
        {contact && (
          <div className="space-y-1.5">
            <Label htmlFor="email-preview-sender" className="text-xs">
              Preview sender
            </Label>
            <Select
              value={sender?.id || "none"}
              onValueChange={setSelectedSenderId}
            >
              <SelectTrigger
                id="email-preview-sender"
                aria-label="Preview sender"
                className="min-w-0 [&>span]:truncate"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mailboxes.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No mailboxes available
                  </SelectItem>
                ) : (
                  mailboxes.map((mailbox) => (
                    <SelectItem key={mailbox.id} value={mailbox.id}>
                      {mailbox.display_name ? `${mailbox.display_name} · ` : ""}
                      {mailbox.email_address}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {step.type === "ab_test" && (
        <div
          className="flex flex-wrap gap-1 border-b p-3"
          aria-label="Preview variant"
        >
          {step.variants?.map((variant) => (
            <Button
              key={variant.variant_label}
              variant="outline"
              size="sm"
              aria-pressed={
                variant.variant_label === previewVariant?.variant_label
              }
              className={
                variant.variant_label === previewVariant?.variant_label
                  ? "border-amber-500/50 bg-amber-500/10"
                  : ""
              }
              onClick={() => setSelectedVariantLabel(variant.variant_label)}
            >
              Variant {variant.variant_label}
            </Button>
          ))}
        </div>
      )}
      <div className="space-y-3 border-b p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {senderName
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{senderName}</p>
            <p className="break-words text-xs text-muted-foreground">
              To:{" "}
              {contact
                ? [contact.display_name, contact.primary_email, contact.company]
                    .filter(Boolean)
                    .join(" · ")
                : "John Doe · CulturePulse"}
            </p>
          </div>
        </div>
        {!loading && !failed && (
          <p className="break-words text-base font-semibold">
            {preview.subject || "Your subject line"}
          </p>
        )}
      </div>
      {loading ? (
        <p
          role="status"
          className="flex items-center gap-2 p-5 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading contact personalization…
        </p>
      ) : failed ? (
        <div role="alert" className="space-y-3 p-5 text-sm">
          <p>Saved personalization couldn’t be loaded.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              enrollment.refetch();
              customFields.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          <div
            className="min-h-[200px] break-words p-5 text-sm leading-relaxed [&_img]:max-w-full [&_a]:text-blue-600 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a"))
                event.preventDefault();
            }}
          >
            {body ? (
              <div dangerouslySetInnerHTML={{ __html: preview.html }} />
            ) : (
              <p className="text-muted-foreground">
                Your email will appear here as you write.
              </p>
            )}
          </div>
          {!!preview.missing.length && (
            <div
              role="status"
              className="mx-4 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed"
            >
              <p className="flex items-center gap-1.5 font-medium">
                <AlertCircle className="h-3.5 w-3.5" />
                Missing values for this contact
              </p>
              <p className="mt-1 break-words">
                {preview.missing.map((key) => `{{${key}}}`).join(", ")}
              </p>
            </div>
          )}
          {!!preview.deferred.length && (
            <p className="px-4 pb-3 text-xs text-muted-foreground">
              The unsubscribe link is created when the email is sent.
            </p>
          )}
        </>
      )}
      <p className="border-t bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {contact
          ? "Uses this contact’s saved values and sequence fallbacks. Previewing does not enroll the contact or send an email. The sending mailbox can differ at send time."
          : "Sample data. Choose a test contact to preview their saved personalization."}
      </p>
    </aside>
  );
}
