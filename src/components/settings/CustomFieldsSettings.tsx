import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { ListPlus, Plus, Pencil, Trash2, Loader2, Copy, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  useCustomFieldDefs,
  useCreateCustomFieldDefs,
  useUpdateCustomFieldDef,
  useDeleteCustomFieldDef,
  type CustomFieldDef,
} from "@/hooks/useCustomFieldDefs";
import { sanitizeFieldKey } from "@/lib/custom-fields";

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select" },
];

function CustomFieldFormFields({
  displayName,
  setDisplayName,
  fieldType,
  setFieldType,
  defaultValue,
  setDefaultValue,
  description,
  setDescription,
  fieldKeyPreview,
  fieldKeyReadOnly,
}: {
  displayName: string;
  setDisplayName: (v: string) => void;
  fieldType: string;
  setFieldType: (v: string) => void;
  defaultValue: string;
  setDefaultValue: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  fieldKeyPreview: string;
  fieldKeyReadOnly?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Display name</Label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Deal Size"
          autoFocus
        />
      </div>

      {fieldKeyPreview && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Template variable{fieldKeyReadOnly ? " (fixed once created)" : ""}
          </Label>
          <code className="block text-xs bg-muted rounded px-2 py-1.5 font-mono">
            {`{{custom_${fieldKeyPreview}}}`}
          </code>
        </div>
      )}

      {!fieldKeyReadOnly && (
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={fieldType} onValueChange={setFieldType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Placeholder value</Label>
        <Input
          value={defaultValue}
          onChange={(e) => setDefaultValue(e.target.value)}
          placeholder="Used when a lead is missing this value"
        />
        <p className="text-xs text-muted-foreground">
          Falls back for this variable in messages when a lead has no value set. Leave blank for none.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Description (optional)</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Internal note for your team"
        />
      </div>
    </div>
  );
}

function CreateCustomFieldDialog({ existingCount }: { existingCount: number }) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [defaultValue, setDefaultValue] = useState("");
  const [description, setDescription] = useState("");
  const createFields = useCreateCustomFieldDefs();

  const fieldKey = sanitizeFieldKey(displayName);

  const reset = () => {
    setDisplayName("");
    setFieldType("text");
    setDefaultValue("");
    setDescription("");
  };

  const handleCreate = async () => {
    if (!displayName.trim() || !fieldKey) return;
    await createFields.mutateAsync([
      {
        field_key: fieldKey,
        display_name: displayName.trim(),
        field_type: fieldType,
        default_value: defaultValue.trim() || null,
        description: description.trim() || null,
        display_order: existingCount,
      },
    ]);
    reset();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="cta">
          <Plus className="w-4 h-4 mr-2" />
          Add Custom Field
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Custom Field</DialogTitle>
          <DialogDescription>
            Custom fields can be set on leads, imported from CSV, and used as variables in messages.
          </DialogDescription>
        </DialogHeader>
        <CustomFieldFormFields
          displayName={displayName}
          setDisplayName={setDisplayName}
          fieldType={fieldType}
          setFieldType={setFieldType}
          defaultValue={defaultValue}
          setDefaultValue={setDefaultValue}
          description={description}
          setDescription={setDescription}
          fieldKeyPreview={fieldKey}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleCreate}
            disabled={!displayName.trim() || !fieldKey || createFields.isPending}
          >
            {createFields.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create Field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCustomFieldDialog({
  field,
  open,
  onOpenChange,
}: {
  field: CustomFieldDef;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [displayName, setDisplayName] = useState(field.display_name);
  const [defaultValue, setDefaultValue] = useState(field.default_value ?? "");
  const [description, setDescription] = useState(field.description ?? "");
  const updateField = useUpdateCustomFieldDef();

  const handleSave = async () => {
    if (!displayName.trim()) return;
    await updateField.mutateAsync({
      id: field.id,
      display_name: displayName.trim(),
      default_value: defaultValue.trim() || null,
      description: description.trim() || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Custom Field</DialogTitle>
        </DialogHeader>
        <CustomFieldFormFields
          displayName={displayName}
          setDisplayName={setDisplayName}
          fieldType={field.field_type}
          setFieldType={() => {}}
          defaultValue={defaultValue}
          setDefaultValue={setDefaultValue}
          description={description}
          setDescription={setDescription}
          fieldKeyPreview={field.field_key}
          fieldKeyReadOnly
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleSave}
            disabled={!displayName.trim() || updateField.isPending}
          >
            {updateField.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomFieldsSettings() {
  const { data: fields, isLoading } = useCustomFieldDefs();
  const updateField = useUpdateCustomFieldDef();
  const deleteField = useDeleteCustomFieldDef();

  const [editingField, setEditingField] = useState<CustomFieldDef | null>(null);
  const [fieldToDelete, setFieldToDelete] = useState<CustomFieldDef | null>(null);

  const handleCopy = (fieldKey: string) => {
    navigator.clipboard.writeText(`{{custom_${fieldKey}}}`);
    toast.success("Variable copied to clipboard");
  };

  const handleToggleVisible = (field: CustomFieldDef) => {
    updateField.mutate({ id: field.id, is_visible_in_list: !field.is_visible_in_list });
  };

  const handleDeleteConfirm = async () => {
    if (!fieldToDelete) return;
    await deleteField.mutateAsync(fieldToDelete.id);
    setFieldToDelete(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListPlus className="w-5 h-5" />
              Custom Fields
            </CardTitle>
            <CardDescription>
              Define extra fields for your leads. Import CSVs into them, view/edit them on a
              lead, filter by them, and reference them as {"{{custom_<key>}}"} variables in
              messages — with an optional placeholder for leads missing a value.
            </CardDescription>
          </div>
          <CreateCustomFieldDialog existingCount={fields?.length ?? 0} />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !fields || fields.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ListPlus className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No custom fields yet</p>
              <p className="text-sm">Create one here, or map a new column while importing a CSV</p>
            </div>
          ) : (
            <div className="border rounded-lg divide-y">
              {fields.map((field) => (
                <div
                  key={field.id}
                  className="flex items-center justify-between gap-4 p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{field.display_name}</span>
                      <Badge variant="secondary" className="capitalize">
                        {field.field_type}
                      </Badge>
                      {!field.is_visible_in_list && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Hidden from list
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => handleCopy(field.field_key)}
                        className="inline-flex items-center gap-1 hover:text-foreground font-mono"
                      >
                        {`{{custom_${field.field_key}}}`}
                        <Copy className="w-3 h-3" />
                      </button>
                      {field.default_value && (
                        <span className="truncate">
                          · placeholder: <span className="italic">{field.default_value}</span>
                        </span>
                      )}
                    </div>
                    {field.description && (
                      <p className="text-xs text-muted-foreground">{field.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title={field.is_visible_in_list ? "Hide from lead list" : "Show in lead list"}
                      onClick={() => handleToggleVisible(field)}
                    >
                      {field.is_visible_in_list ? (
                        <Eye className="w-4 h-4" />
                      ) : (
                        <EyeOff className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditingField(field)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setFieldToDelete(field)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editingField && (
        <EditCustomFieldDialog
          field={editingField}
          open={!!editingField}
          onOpenChange={(v) => !v && setEditingField(null)}
        />
      )}

      <AlertDialog open={!!fieldToDelete} onOpenChange={() => setFieldToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Field</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{fieldToDelete?.display_name}"? Existing lead data
              for this field is kept, but it will no longer appear in the lead view, columns, or
              filters, and its placeholder default will stop applying to{" "}
              {fieldToDelete && `{{custom_${fieldToDelete.field_key}}}`} in messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteField.isPending}
            >
              {deleteField.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
