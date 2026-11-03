import { useState } from "react";
import { FileText, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TEMPLATE_FIELDS,
  templateSlots,
  useCreateWhatsAppTemplate,
  useDeleteWhatsAppTemplate,
  useSyncWhatsAppTemplates,
  useUpdateTemplateVariables,
  useWhatsAppTemplates,
  type TemplateApprovalStatus,
  type WhatsAppTemplate,
} from "@/hooks/useWhatsAppTemplates";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "en_GB", label: "English (UK)" },
  { value: "en_US", label: "English (US)" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "pt_BR", label: "Portuguese (Brazil)" },
  { value: "pt_PT", label: "Portuguese (Portugal)" },
];

const STATUS_LABELS: Record<TemplateApprovalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  pending: "In review",
  approved: "Approved",
  rejected: "Rejected",
  paused: "Paused",
  disabled: "Disabled",
};

function StatusBadge({ status }: { status: TemplateApprovalStatus }) {
  if (status === "approved") return <Badge variant="secondary">{STATUS_LABELS[status]}</Badge>;
  if (status === "rejected" || status === "disabled") return <Badge variant="destructive">{STATUS_LABELS[status]}</Badge>;
  return <Badge variant="outline">{STATUS_LABELS[status]}</Badge>;
}

function FieldSelect({ value, onChange, label }: { value: string | undefined; onChange: (v: string) => void; label: string }) {
  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger className="h-8" aria-label={label}>
        <SelectValue placeholder="Contact field" />
      </SelectTrigger>
      <SelectContent>
        {TEMPLATE_FIELDS.map((f) => (
          <SelectItem key={f.value} value={f.value}>
            {f.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NewTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateWhatsAppTemplate();
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [category, setCategory] = useState<"marketing" | "utility">("marketing");
  const [body, setBody] = useState("Hi {{1}}, you asked us about {{2}} a while back. Is this still something you're looking into?");
  const [variables, setVariables] = useState<Record<string, string>>({ "1": "first_name" });
  const [samples, setSamples] = useState<Record<string, string>>({ "1": "Marie" });
  const [buttons, setButtons] = useState<string[]>(["Yes, tell me more", "Not right now"]);
  const slots = templateSlots(body);

  const insertVariable = () => {
    const next = String(slots.length + 1);
    setBody((b) => `${b.trimEnd()} {{${next}}}`);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        language,
        category,
        body,
        variables: Object.fromEntries(slots.map((s) => [s, variables[s]]).filter(([, v]) => v)),
        samples: Object.fromEntries(slots.map((s) => [s, samples[s] || ""])),
        buttons: buttons.filter((b) => b.trim()),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New WhatsApp template</DialogTitle>
            <DialogDescription>
              WhatsApp only lets a business start a conversation with a template Meta has approved. Once the contact
              replies, you can write freely for 24 hours.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="tpl-name">Name</Label>
                <Input
                  id="tpl-name"
                  placeholder="dbr_still_interested"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as "marketing" | "utility")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="utility">Utility</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="tpl-body">Message</Label>
                <Button type="button" variant="outline" size="sm" onClick={insertVariable}>
                  Add variable
                </Button>
              </div>
              <Textarea id="tpl-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} required />
              <p className="text-xs text-muted-foreground">
                Variables are {"{{1}}"}, {"{{2}}"}… The message can't start or end with one.
              </p>
            </div>

            {slots.length > 0 && (
              <div className="space-y-2">
                <Label>Fill each variable from</Label>
                {slots.map((slot) => (
                  <div key={slot} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-2">
                    <span className="text-sm font-mono">{`{{${slot}}}`}</span>
                    <FieldSelect
                      label={`Field for {{${slot}}}`}
                      value={variables[slot]}
                      onChange={(v) => setVariables((m) => ({ ...m, [slot]: v }))}
                    />
                    <Input
                      className="h-8"
                      placeholder="Example for Meta"
                      value={samples[slot] || ""}
                      onChange={(e) => setSamples((m) => ({ ...m, [slot]: e.target.value }))}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Contacts missing a value are skipped (WhatsApp rejects empty variables).
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Quick-reply buttons (optional, up to 3)</Label>
              {[0, 1, 2].map((i) => (
                <Input
                  key={i}
                  className="h-8"
                  placeholder={i === 2 ? "Stop promotions" : `Button ${i + 1}`}
                  maxLength={25}
                  value={buttons[i] || ""}
                  onChange={(e) => setButtons((b) => Object.assign([...b], { [i]: e.target.value }))}
                />
              ))}
              <p className="text-xs text-muted-foreground">
                A tap counts as a reply and opens the 24-hour window. A "Stop" button opts the contact out.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={create.isPending || !name || !body.trim()}>
              {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit to Meta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UnmappedSlots({ template }: { template: WhatsAppTemplate }) {
  const update = useUpdateTemplateVariables();
  const missing = templateSlots(template.body).filter((s) => !template.variables?.[s]);
  if (missing.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-amber-600">Pick a contact field for each variable before using this template:</p>
      {missing.map((slot) => (
        <div key={slot} className="flex items-center gap-2 max-w-xs">
          <span className="text-xs font-mono w-10">{`{{${slot}}}`}</span>
          <FieldSelect
            label={`Field for {{${slot}}}`}
            value={undefined}
            onChange={(v) => update.mutate({ id: template.id, variables: { ...(template.variables || {}), [slot]: v } })}
          />
        </div>
      ))}
    </div>
  );
}

export function WhatsAppTemplatesCard({ connected }: { connected: boolean }) {
  const { data: templates = [], isLoading } = useWhatsAppTemplates();
  const sync = useSyncWhatsAppTemplates();
  const remove = useDeleteWhatsAppTemplate();
  const [newOpen, setNewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[16rem] flex-1">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            WhatsApp templates
          </h3>
          <p className="text-sm text-muted-foreground">
            Approved templates start WhatsApp Business conversations in automations (the "Send WhatsApp template"
            step).
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={!connected || sync.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${sync.isPending ? "animate-spin" : ""}`} />
            Sync
          </Button>
          <Button variant="cta" size="sm" onClick={() => setNewOpen(true)} disabled={!connected}>
            <Plus className="h-4 w-4 mr-2" />
            New template
          </Button>
        </div>
      </div>

      {!connected && (
        <Alert>
          <AlertDescription>Connect Twilio above to create WhatsApp templates.</AlertDescription>
        </Alert>
      )}

      {connected && !isLoading && templates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No templates yet. Create one here, or click Sync to pull templates made in the Twilio Console.
        </p>
      )}

      <div className="space-y-3">
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg border px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <StatusBadge status={t.approval_status} />
                  <span className="text-xs text-muted-foreground">
                    {t.category} · {t.language}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{t.body}</p>
                {t.buttons?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.buttons.map((b) => (
                      <Badge key={b.id} variant="outline" className="font-normal">
                        {b.title}
                      </Badge>
                    ))}
                  </div>
                )}
                {t.rejected_reason && <p className="mt-1 text-xs text-destructive">{t.rejected_reason}</p>}
                <UnmappedSlots template={t} />
              </div>
              <Button variant="ghost" size="icon" onClick={() => setDeleteId(t.id)} aria-label={`Delete ${t.name}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <NewTemplateDialog open={newOpen} onOpenChange={setNewOpen} />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              It's deleted in Twilio too. Automation steps using it will stop sending.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && remove.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
