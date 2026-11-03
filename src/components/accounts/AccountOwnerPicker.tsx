import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";

interface AccountOwnerPickerProps {
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function AccountOwnerPicker({
  value,
  onChange,
  disabled,
  placeholder = "Shared (No Owner)",
}: AccountOwnerPickerProps) {
  const { data: members } = useOrganizationMembers();

  return (
    <Select
      value={value || "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className="w-[180px] h-8 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">
          <span className="text-muted-foreground">{placeholder}</span>
        </SelectItem>
        {members?.map((member) => (
          <SelectItem key={member.user_id} value={member.user_id}>
            <span className="flex items-center gap-2">
              <Avatar className="h-4 w-4">
                <AvatarImage src={member.user?.avatar_url || undefined} />
                <AvatarFallback className="text-[8px]">
                  {getInitials(member.user?.full_name)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">
                {member.user?.full_name || member.user?.email}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
