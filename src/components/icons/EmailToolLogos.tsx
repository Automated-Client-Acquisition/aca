import { cn } from "@/lib/utils";

interface EmailToolLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "w-5 h-5",
  md: "w-8 h-8",
  lg: "w-10 h-10",
};

/**
 * SmartLead logo - Official brand logo from CDN
 */
export function SmartLeadLogo({ className, size = "md" }: EmailToolLogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(sizeClasses[size], className)}
    >
      <path d="M0 5.033C0 2.253 2.254 0 5.033 0h29.934C37.747 0 40 2.253 40 5.033v29.934C40 37.747 37.746 40 34.967 40H5.033C2.254 40 0 37.747 0 34.967V5.033Z" fill="#6E58F1"/>
      <path d="M5.773 16.919c0-3.45 2.787-6.247 6.224-6.247h.358a2.99 2.99 0 012.633 2.642v7.21a2.99 2.99 0 01-2.633 2.642h-.358c-3.437 0-6.224-2.797-6.224-6.247Z" fill="white"/>
      <path d="M16.406 11.777c0-.67.392-1.278 1.001-1.552l9.06-4.074c1.12-.504 2.386.319 2.386 1.551v18.573c0 1.24-1.28 2.064-2.403 1.544l-9.06-4.193a1.744 1.744 0 01-1.015-1.544v-.86c0-.707.436-1.34 1.096-1.59l5.05-1.913c.73-.277.73-1.314 0-1.59l-5.05-1.914a1.744 1.744 0 01-1.096-1.59v-.848Z" fill="white"/>
      <path d="M34.218 18.41v-.379c0-2.09-1.688-3.786-3.771-3.786a.19.19 0 00-.189.19v7.572c0 .105.084.19.189.19 2.083 0 3.771-1.696 3.771-3.787Z" fill="white"/>
      <path d="M11.992 25.585c0-.372.3-.673.67-.673h3.509c.37 0 .67.301.67.673v5.98a2.425 2.425 0 01-2.425 2.434 2.425 2.425 0 01-2.424-2.434v-5.98Z" fill="white"/>
    </svg>
  );
}

/**
 * Instantly logo - Blue lightning bolt
 * Brand color: #0888f8
 */
export function InstantlyLogo({ className, size = "md" }: EmailToolLogoProps) {
  return (
    <div
      className={cn(
        "rounded-lg flex items-center justify-center bg-[#0888f8]",
        sizeClasses[size],
        className
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={size === "sm" ? "w-3 h-3" : size === "md" ? "w-4 h-4" : "w-5 h-5"}
      >
        {/* Lightning bolt - Instantly's iconic symbol */}
        <path
          d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"
          fill="white"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/**
 * Success.ai logo - Teal/green checkmark with upward trend
 * Brand color: #10b981 (emerald)
 */
export function SuccessAILogo({ className, size = "md" }: EmailToolLogoProps) {
  return (
    <div
      className={cn(
        "rounded-lg flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600",
        sizeClasses[size],
        className
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={size === "sm" ? "w-3 h-3" : size === "md" ? "w-4 h-4" : "w-5 h-5"}
      >
        {/* Checkmark with upward trend - success symbol */}
        <path
          d="M4 12l5 5L20 6"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

/**
 * Notion logo - Simple "N" in a dark rounded square
 */
export function NotionLogo({ className, size = "md" }: EmailToolLogoProps) {
  return (
    <div
      className={cn(
        "rounded-lg flex items-center justify-center bg-black text-white font-bold",
        sizeClasses[size],
        className
      )}
    >
      <span
        className={
          size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-base"
        }
      >
        N
      </span>
    </div>
  );
}

/**
 * Generic email tool logo component that renders the appropriate logo based on tool type
 */
export function EmailToolLogo({
  toolType,
  className,
  size = "md",
}: EmailToolLogoProps & { toolType: "smartlead" | "instantly" | "successai" | "notion" }) {
  switch (toolType) {
    case "smartlead":
      return <SmartLeadLogo className={className} size={size} />;
    case "instantly":
      return <InstantlyLogo className={className} size={size} />;
    case "successai":
      return <SuccessAILogo className={className} size={size} />;
    case "notion":
      return <NotionLogo className={className} size={size} />;
    default:
      return null;
  }
}
