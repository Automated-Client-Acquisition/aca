import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Building2 } from "lucide-react";
import { useCreateClientOrganization } from "@/hooks/useClientOrganizations";

const createClientSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z
    .string()
    .optional()
    .refine(
      (val) =>
        !val || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(val),
      "Slug must be lowercase letters, numbers, and hyphens only"
    ),
});

type CreateClientFormData = z.infer<typeof createClientSchema>;

interface CreateClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateClientDialog({
  open,
  onOpenChange,
}: CreateClientDialogProps) {
  const navigate = useNavigate();
  const { mutate: createClient, isPending } = useCreateClientOrganization();

  const form = useForm<CreateClientFormData>({
    resolver: zodResolver(createClientSchema),
    defaultValues: {
      name: "",
      slug: "",
    },
  });

  const onSubmit = (data: CreateClientFormData) => {
    createClient(data, {
      onSuccess: (newClient) => {
        form.reset();
        onOpenChange(false);
        // Navigate to the new client's detail page
        navigate(`/clients/${newClient.id}`);
      },
    });
  };

  // Auto-generate slug from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    form.setValue("name", name);

    // Only auto-generate if slug hasn't been manually edited
    const currentSlug = form.getValues("slug");
    if (!currentSlug || currentSlug === generateSlug(form.getValues("name").slice(0, -1))) {
      form.setValue("slug", generateSlug(name));
    }
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Create New Client
          </DialogTitle>
          <DialogDescription>
            Create a new client sub-account. You can invite users and manage
            their settings after creation.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Acme Corporation"
                      {...field}
                      onChange={handleNameChange}
                    />
                  </FormControl>
                  <FormDescription>
                    The display name for this client
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL Slug (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="acme-corporation" {...field} />
                  </FormControl>
                  <FormDescription>
                    Auto-generated from name if left empty
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button variant="cta" type="submit" disabled={isPending}>
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Client
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
