import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shuffle } from "lucide-react";

const SPINTAX_PRESETS: { label: string; snippet: string }[] = [
  { label: "Greeting", snippet: "{Hi|Hey|Hello}" },
  { label: "Opener", snippet: "{hope you're well|long time no chat|just catching up}" },
  { label: "Ask", snippet: "{open to a quick chat|free for 15 min next week|worth a brief call}" },
  { label: "Sign-off", snippet: "{Thanks|Cheers|Best}" },
  { label: "Blank skeleton", snippet: "{option 1|option 2|option 3}" },
];

interface SpintaxPickerDropdownProps {
  onInsert: (snippet: string) => void;
  /** Use "xs" for compact contexts like ABVariantEditor */
  size?: "sm" | "xs";
}

/**
 * Dropdown that inserts flat-spintax snippets like `{a|b|c}` into a message field.
 * At send time, each `{a|b|c}` resolves to one branch picked uniformly per send.
 */
export function SpintaxPickerDropdown({
  onInsert,
  size = "sm",
}: SpintaxPickerDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={size === "xs" ? "h-5 text-[10px]" : "h-6 text-xs"}
        >
          <Shuffle className="h-3 w-3 mr-1" />
          {size === "xs" ? "Spin" : "Insert Spintax"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-64 overflow-y-auto w-72">
        <DropdownMenuLabel className="text-xs leading-snug py-2">
          <span className="font-medium">Spintax</span>
          <span className="block text-[10px] font-normal text-muted-foreground mt-0.5">
            Wrap options in <code>{"{a|b|c}"}</code>. Each send picks one at random.
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SPINTAX_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.label}
            onClick={() => onInsert(preset.snippet)}
            className="flex-col items-start gap-0.5"
          >
            <span className="text-xs font-medium">{preset.label}</span>
            <code className="text-[10px] text-muted-foreground truncate w-full">
              {preset.snippet}
            </code>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
