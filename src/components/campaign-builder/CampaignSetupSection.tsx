import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CampaignSetupSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("min-w-0 rounded-xl border bg-card p-4 sm:p-5", className)}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
