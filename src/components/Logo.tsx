import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
}

export function Logo({ className, showText = true, size = "md" }: LogoProps) {
  const sizes = {
    sm: { icon: 24, text: "text-sm" },
    md: { icon: 32, text: "text-lg" },
    lg: { icon: 40, text: "text-xl" },
  };

  const { icon, text } = sizes[size];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Icon */}
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="15" fill="url(#logoGradient)" />
        <path
          d="M20 10c-4 0-7 3-7 6s3 6 7 6"
          stroke="white"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="22" cy="10" r="2" fill="white" />
        <path
          d="M22 12v4"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M20 14c1.5-1 2-2 2-2"
          stroke="white"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M24 14c-1.5-1-2-2-2-2"
          stroke="white"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      </svg>

      {/* Text */}
      {showText && (
        <span className={cn("font-bold", text)}>
          <span className="text-emerald-500">Content</span>
          <span className="text-foreground">Farming</span>
        </span>
      )}
    </div>
  );
}
