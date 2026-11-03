import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";

interface ContactCellProps {
  contactId: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Fallback avatar URL from identity (e.g., LinkedIn profile) */
  fallbackAvatarUrl?: string | null;
  email?: string | null;
  showEmail?: boolean;
  /** Override avatar size/shape — defaults to the standard h-9 w-9 circle */
  avatarClassName?: string;
  /** Override fallback (initials) background/text/shape — defaults to plain muted */
  fallbackClassName?: string;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ContactCell({
  contactId,
  displayName,
  avatarUrl,
  fallbackAvatarUrl,
  email,
  showEmail = true,
  avatarClassName,
  fallbackClassName,
}: ContactCellProps) {
  const initials = getInitials(displayName);
  const [primaryFailed, setPrimaryFailed] = useState(false);

  // Try primary avatar first, then fallback
  const effectiveAvatarUrl = primaryFailed
    ? (fallbackAvatarUrl || undefined)
    : (avatarUrl || fallbackAvatarUrl || undefined);

  return (
    <Link
      to={`/people/${contactId}`}
      className="flex items-center gap-3 hover:underline"
    >
      <Avatar className={cn("h-9 w-9", avatarClassName)}>
        <AvatarImage
          src={effectiveAvatarUrl}
          referrerPolicy="no-referrer"
          alt={displayName || "Contact"}
          onLoadingStatusChange={(status) => {
            // If primary URL fails to load, try fallback
            if (status === "error" && !primaryFailed && avatarUrl && fallbackAvatarUrl) {
              setPrimaryFailed(true);
            }
          }}
        />
        <AvatarFallback className={cn("text-xs", fallbackClassName)}>{initials}</AvatarFallback>
      </Avatar>
      <div>
        <p className="font-medium">{displayName || "Unknown"}</p>
        {showEmail && email && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Mail className="h-3 w-3" />
            {email}
          </div>
        )}
      </div>
    </Link>
  );
}
