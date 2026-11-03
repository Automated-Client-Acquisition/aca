import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  icon: ElementType;
  title: ReactNode;
  description?: ReactNode;
  /** Badges shown on the title line, e.g. a count. */
  meta?: ReactNode;
  /** The page's buttons. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The header every app page opens with: gradient icon, title, description and
 * the page's actions.
 *
 * The title block claims at least 24rem before the actions get a seat beside
 * it. When both don't fit, the actions drop below as one row instead of being
 * squeezed into a narrow column where the buttons stack on top of each other.
 * Beside the title they sit centred on the icon.
 */
export function PageHeader({ icon: Icon, title, description, meta, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-8 gap-y-4", className)}>
      <div className="flex min-w-0 grow basis-96 items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-aca shadow-lg">
          <Icon className="h-7 w-7 text-white" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-3xl font-bold text-foreground">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-1 text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2 sm:min-h-14">{actions}</div>}
    </div>
  );
}
