import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  isResizing?: boolean;
}

export function ResizeHandle({
  onMouseDown,
  onDoubleClick,
  isResizing,
}: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        "absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10",
        "after:absolute after:right-[1px] after:top-[25%] after:bottom-[25%] after:w-[2px] after:rounded-full",
        "after:transition-colors after:duration-150",
        isResizing
          ? "after:top-0 after:bottom-0 after:bg-primary"
          : "after:bg-transparent hover:after:bg-primary/40"
      )}
    />
  );
}
