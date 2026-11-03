import { cn } from "@/lib/utils";

type SkeletonProps =
  | ({ as?: "div" } & React.HTMLAttributes<HTMLDivElement>)
  | ({ as: "span" } & React.HTMLAttributes<HTMLSpanElement>);

function Skeleton({ as = "div", className, ...props }: SkeletonProps) {
  const Comp = as as any;
  return <Comp className={cn("animate-pulse rounded-md bg-muted", className)} {...(props as any)} />;
}

export { Skeleton };
