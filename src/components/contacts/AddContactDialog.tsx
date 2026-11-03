import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Loader2, ChevronDown, ListPlus } from "lucide-react";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    display_name: string;
    first_name?: string;
    last_name?: string;
    primary_email?: string;
    primary_phone?: string;
    company?: string;
    job_title?: string;
    primary_linkedin_url?: string;
    instagram_url?: string;
    linkedin_bio?: string;
    custom_fields?: Record<string, unknown>;
  }) => void;
  isLoading?: boolean;
}

export function AddContactDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: AddContactDialogProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [linkedinBio, setLinkedinBio] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const { data: customFieldDefs } = useCustomFieldDefs();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    // Require at least a name
    if (!trimmedFirst && !trimmedLast) return;

    const displayName = [trimmedFirst, trimmedLast].filter(Boolean).join(" ");

    const customFields = Object.fromEntries(
      Object.entries(customFieldValues).filter(([, v]) => v.trim() !== "")
    );

    onSubmit({
      display_name: displayName,
      first_name: trimmedFirst || undefined,
      last_name: trimmedLast || undefined,
      primary_email: email.trim() || undefined,
      primary_phone: phone.trim() || undefined,
      company: company.trim() || undefined,
      job_title: jobTitle.trim() || undefined,
      primary_linkedin_url: linkedinUrl.trim() || undefined,
      instagram_url: instagramUrl.trim() || undefined,
      linkedin_bio: linkedinBio.trim() || undefined,
      custom_fields: Object.keys(customFields).length > 0 ? customFields : undefined,
    });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Reset form
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setCompany("");
      setJobTitle("");
      setLinkedinUrl("");
      setInstagramUrl("");
      setLinkedinBio("");
      setCustomFieldValues({});
      setCustomFieldsOpen(false);
    }
    onOpenChange(open);
  };

  const hasName = firstName.trim() || lastName.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
            <DialogDescription>
              Add a new contact to your CRM. At minimum, enter a name to get started.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            {/* Company & Job Title row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  placeholder="Acme Inc."
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Job Title</Label>
                <Input
                  id="jobTitle"
                  placeholder="Marketing Manager"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>
            </div>

            {/* LinkedIn URL */}
            <div className="space-y-2">
              <Label htmlFor="linkedinUrl">LinkedIn URL (optional)</Label>
              <Input
                id="linkedinUrl"
                type="url"
                placeholder="https://linkedin.com/in/johndoe"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
              />
            </div>

            {/* Instagram */}
            <div className="space-y-2">
              <Label htmlFor="instagramUrl">Instagram (optional)</Label>
              <Input
                id="instagramUrl"
                placeholder="@johndoe or https://instagram.com/johndoe"
                value={instagramUrl}
                onChange={(e) => setInstagramUrl(e.target.value)}
              />
            </div>

            {/* LinkedIn Bio */}
            <div className="space-y-2">
              <Label htmlFor="linkedinBio">LinkedIn Bio (optional)</Label>
              <Textarea
                id="linkedinBio"
                placeholder="Contact's LinkedIn bio/summary"
                value={linkedinBio}
                onChange={(e) => setLinkedinBio(e.target.value)}
                rows={3}
              />
            </div>

            {/* Custom fields */}
            {customFieldDefs && customFieldDefs.length > 0 && (
              <Collapsible open={customFieldsOpen} onOpenChange={setCustomFieldsOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-0 text-muted-foreground hover:text-foreground"
                  >
                    <ListPlus className="h-3.5 w-3.5 mr-1.5" />
                    Custom Fields
                    <ChevronDown
                      className={`h-3.5 w-3.5 ml-1 transition-transform ${customFieldsOpen ? "rotate-180" : ""}`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  {customFieldDefs.map((def) => (
                    <div key={def.id} className="space-y-2">
                      <Label htmlFor={`custom-${def.field_key}`}>{def.display_name}</Label>
                      <Input
                        id={`custom-${def.field_key}`}
                        type={def.field_type === "number" ? "number" : def.field_type === "date" ? "date" : "text"}
                        placeholder={def.default_value || undefined}
                        value={customFieldValues[def.field_key] || ""}
                        onChange={(e) =>
                          setCustomFieldValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="cta" type="submit" disabled={!hasName || isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
