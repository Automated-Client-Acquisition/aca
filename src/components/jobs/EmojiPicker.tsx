import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  trigger?: React.ReactNode;
}

const EMOJI_CATEGORIES = {
  "Smileys": ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "😮‍💨", "🤥"],
  "Gestures": ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏"],
  "Hearts": ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "♥️"],
  "Celebration": ["🎉", "🎊", "🎈", "🎁", "🎀", "🪅", "🎆", "🎇", "✨", "🎄", "🎃", "🎗️", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🎯", "🎮", "🎲"],
  "Nature": ["🌟", "⭐", "🌙", "☀️", "🌤️", "⛅", "🌈", "☁️", "🌸", "🌺", "🌻", "🌹", "🌷", "🌱", "🌿", "🍀", "🍁", "🍂", "🌴", "🌵", "🌾"],
  "Food": ["☕", "🍵", "🧃", "🥤", "🍷", "🍸", "🍹", "🍺", "🍻", "🥂", "🥃", "🍔", "🍕", "🌮", "🌯", "🥗", "🍜", "🍝", "🍣", "🍩", "🎂"],
  "Objects": ["💡", "🔥", "💯", "✅", "❌", "⚡", "💪", "🎵", "🎶", "📱", "💻", "📸", "🎬", "📺", "🔔", "📣", "💬", "💭", "🗣️", "👁️", "👀"],
  "Arrows": ["➡️", "⬅️", "⬆️", "⬇️", "↗️", "↘️", "↙️", "↖️", "↕️", "↔️", "🔄", "🔃", "🔙", "🔚", "🔛", "🔜", "🔝"],
};

const CATEGORY_ICONS: Record<string, string> = {
  "Smileys": "😀",
  "Gestures": "👋",
  "Hearts": "❤️",
  "Celebration": "🎉",
  "Nature": "🌟",
  "Food": "☕",
  "Objects": "💡",
  "Arrows": "➡️",
};

export function EmojiPicker({ onSelect, trigger }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("Smileys");

  const handleSelect = (emoji: string) => {
    onSelect(emoji);
    setOpen(false);
  };

  const filteredEmojis = search
    ? Object.values(EMOJI_CATEGORIES).flat().filter(emoji =>
        emoji.includes(search)
      )
    : EMOJI_CATEGORIES[activeCategory as keyof typeof EMOJI_CATEGORIES] || [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Smile className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            placeholder="Search emojis..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>

        {!search && (
          <div className="flex gap-1 p-2 border-b overflow-x-auto">
            {Object.keys(EMOJI_CATEGORIES).map((category) => (
              <Button
                key={category}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 w-8 p-0 shrink-0",
                  activeCategory === category && "bg-muted"
                )}
                onClick={() => setActiveCategory(category)}
              >
                {CATEGORY_ICONS[category]}
              </Button>
            ))}
          </div>
        )}

        <div className="p-2 h-48 overflow-y-auto">
          <div className="grid grid-cols-8 gap-1">
            {filteredEmojis.map((emoji, i) => (
              <Button
                key={`${emoji}-${i}`}
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-lg hover:bg-muted"
                onClick={() => handleSelect(emoji)}
              >
                {emoji}
              </Button>
            ))}
          </div>
          {filteredEmojis.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8">
              No emojis found
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
