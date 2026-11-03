import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {keys.split(" ").map((key, i) => (
          <span key={i}>
            {key === "/" ? (
              <span className="text-xs text-muted-foreground mx-0.5">/</span>
            ) : (
              <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border bg-muted text-xs font-mono font-medium text-muted-foreground">
                {key}
              </kbd>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsHelp({
  open,
  onOpenChange,
}: KeyboardShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>Navigate and manage conversations from your keyboard.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 pt-2 sm:grid-cols-3">
          {/* Navigation */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Navigation
            </h4>
            <Shortcut keys="j / ↓" label="Next conversation" />
            <Shortcut keys="k / ↑" label="Previous conversation" />
            <Shortcut keys="⌘K" label="Command palette" />
          </div>

          {/* Actions */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Actions
            </h4>
            <Shortcut keys="e" label="Close / Reopen" />
            <Shortcut keys="f" label="Toggle favorite" />
            <Shortcut keys="m" label="Toggle mute" />
            <Shortcut keys="s" label="Snooze" />
            <Shortcut keys="r" label="Reply" />
            <Shortcut keys="n" label="Toggle note mode" />
          </div>

          {/* Bulk */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Bulk
            </h4>
            <Shortcut keys="x" label="Select / deselect" />
            <Shortcut keys="Esc" label="Clear selection" />
            <Shortcut keys="i" label="Toggle contact details" />
            <Shortcut keys="?" label="Show this help" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
