import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCreateSchedule } from "@/hooks/useCreateSchedule";
import { Loader2 } from "lucide-react";

const scheduleSchema = z.object({
  frequency: z.enum(["hourly", "daily", "weekly", "custom"]),
  cronExpression: z.string().optional(),
  maxItems: z.coerce.number().min(1).max(1000).default(100),
  autoPause: z.boolean().default(true),
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;

interface ScheduleManagementDialogProps {
  type: 'creator' | 'search_term';
  targetId: string;
  targetName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScheduleManagementDialog({
  type,
  targetId,
  targetName,
  open,
  onOpenChange,
}: ScheduleManagementDialogProps) {
  const { mutate: createSchedule, isPending } = useCreateSchedule();

  const form = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      frequency: "daily",
      maxItems: 100,
      autoPause: true,
    },
  });

  const onSubmit = (data: ScheduleFormData) => {
    createSchedule(
      {
        type,
        targetId,
        targetName,
        frequency: data.frequency,
        cronExpression: data.cronExpression,
        maxItems: data.maxItems,
        autoPause: data.autoPause,
      },
      {
        onSuccess: () => {
          form.reset();
          onOpenChange(false);
        },
      }
    );
  };

  const watchFrequency = form.watch("frequency");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Scraping Schedule</DialogTitle>
          <DialogDescription>
            Schedule automatic scraping for {targetName}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="frequency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Frequency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select frequency" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="hourly">Every Hour</SelectItem>
                      <SelectItem value="daily">Every Day</SelectItem>
                      <SelectItem value="weekly">Every Week</SelectItem>
                      <SelectItem value="custom">Custom (Cron Expression)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchFrequency === "custom" && (
              <FormField
                control={form.control}
                name="cronExpression"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cron Expression</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="0 9 * * *" />
                    </FormControl>
                    <FormDescription>
                      Example: "0 9 * * *" runs daily at 9 AM
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="maxItems"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Items per Run</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" min="1" max="1000" />
                  </FormControl>
                  <FormDescription>
                    Maximum number of items to scrape each time (1-1000)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="autoPause"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Auto-pause on failure</FormLabel>
                    <FormDescription>
                      Automatically pause schedule after 3 consecutive failures
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button variant="cta" type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Schedule"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
