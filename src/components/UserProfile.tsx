import { Bell } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface UserProfileProps {
  name: string;
  email: string;
  initials: string;
}

export function UserProfile({ name, email, initials }: UserProfileProps) {
  return (
    <div className="flex items-center gap-4">
      <button className="relative p-2 hover:bg-secondary rounded-lg transition-colors">
        <Bell className="w-5 h-5 text-foreground" />
        <span className="absolute top-1 right-1 w-2 h-2 bg-gradient-aca rounded-full" />
      </button>
      
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-sm font-semibold text-foreground">{name}</div>
          <div className="text-xs text-muted-foreground">{email}</div>
        </div>
        <Avatar className="h-10 w-10 bg-gradient-aca">
          <AvatarFallback className="bg-gradient-aca text-white font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
