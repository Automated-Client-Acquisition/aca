import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAvatarRefresh } from "@/hooks/useAvatarRefresh";
import { cn } from "@/lib/utils";

interface ContactAvatarProps {
  contactId?: string;
  avatarUrl?: string | null;
  initials: string;
  className?: string;
  fallbackClassName?: string;
}

export function ContactAvatar({
  contactId,
  avatarUrl,
  initials,
  className,
  fallbackClassName,
}: ContactAvatarProps) {
  const { src, onError } = useAvatarRefresh(contactId, avatarUrl);

  return (
    <Avatar className={cn("flex-shrink-0", className)}>
      <AvatarImage
        src={src}
        referrerPolicy="no-referrer"
        onLoadingStatusChange={(status) => {
          if (status === "error") onError();
        }}
      />
      <AvatarFallback className={fallbackClassName}>{initials}</AvatarFallback>
    </Avatar>
  );
}
