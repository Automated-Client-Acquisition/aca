import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const manualLeadSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().optional(),
  primary_email: z.string().email("Invalid email").optional().or(z.literal("")),
  primary_linkedin_url: z.string().transform(v => v && !/^https?:\/\//i.test(v) ? `https://${v}` : v).pipe(z.string().url("Invalid URL")).optional().or(z.literal("")),
  company: z.string().optional(),
  job_title: z.string().optional(),
  primary_phone: z.string().optional(),
  instagram_url: z.string().optional(),
  company_website: z.string().transform(v => v && !/^https?:\/\//i.test(v) ? `https://${v}` : v).pipe(z.string().url("Invalid URL")).optional().or(z.literal("")),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
});

export type ManualLeadData = z.infer<typeof manualLeadSchema>;

interface ManualLeadFormProps {
  onSubmit: (data: ManualLeadData) => Promise<void>;
  isSubmitting: boolean;
}

export function ManualLeadForm({ onSubmit, isSubmitting }: ManualLeadFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ManualLeadData>({
    resolver: zodResolver(manualLeadSchema),
  });

  const [submitted, setSubmitted] = useState(false);

  const handleFormSubmit = async (data: ManualLeadData) => {
    await onSubmit(data);
    setSubmitted(true);
    reset();
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6 max-w-lg">
      {submitted && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-3 text-sm text-green-700 dark:text-green-300">
          Lead added successfully. You can add another one below.
        </div>
      )}

      {/* Contact Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Contact Info</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="first_name">First Name *</Label>
            <Input id="first_name" placeholder="John" {...register("first_name")} />
            {errors.first_name && (
              <p className="text-xs text-destructive">{errors.first_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name">Last Name</Label>
            <Input id="last_name" placeholder="Doe" {...register("last_name")} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="primary_email">Email</Label>
          <Input id="primary_email" type="email" placeholder="john@company.com" {...register("primary_email")} />
          {errors.primary_email && (
            <p className="text-xs text-destructive">{errors.primary_email.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="primary_phone">Phone</Label>
          <Input id="primary_phone" placeholder="+1 555 123 4567" {...register("primary_phone")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="primary_linkedin_url">LinkedIn URL</Label>
          <Input id="primary_linkedin_url" placeholder="https://linkedin.com/in/johndoe" {...register("primary_linkedin_url")} />
          {errors.primary_linkedin_url && (
            <p className="text-xs text-destructive">{errors.primary_linkedin_url.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="instagram_url">Instagram</Label>
          <Input id="instagram_url" placeholder="@johndoe or https://instagram.com/johndoe" {...register("instagram_url")} />
        </div>
      </div>

      <Separator />

      {/* Company Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Company</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="company">Company</Label>
            <Input id="company" placeholder="Acme Inc." {...register("company")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="job_title">Job Title</Label>
            <Input id="job_title" placeholder="VP of Sales" {...register("job_title")} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="company_website">Company Website</Label>
          <Input id="company_website" placeholder="https://acme.com" {...register("company_website")} />
          {errors.company_website && (
            <p className="text-xs text-destructive">{errors.company_website.message}</p>
          )}
        </div>
      </div>

      <Separator />

      {/* Location */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Location</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input id="city" placeholder="San Francisco" {...register("city")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input id="state" placeholder="CA" {...register("state")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Input id="country" placeholder="US" {...register("country")} />
          </div>
        </div>
      </div>

      <Button variant="cta" type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Add Lead
      </Button>
    </form>
  );
}
