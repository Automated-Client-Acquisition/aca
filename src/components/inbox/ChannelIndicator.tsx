import { cn } from "@/lib/utils";
import { type ConversationChannel } from "@/hooks/crm/useConversations";

interface ChannelIndicatorProps {
  channel: ConversationChannel;
  className?: string;
  showLabel?: boolean;
}

// Channel icons as inline SVGs for better control
const channelConfig: Record<
  string,
  { icon: React.ReactNode; color: string; label: string }
> = {
  linkedin: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full p-0.5">
        <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
      </svg>
    ),
    color: "text-[#0A66C2] bg-[#0A66C2]/10",
    label: "LinkedIn",
  },
  instagram: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full p-0.5">
        <path d="M12 2c2.717 0 3.056.01 4.122.06 1.065.05 1.79.217 2.428.465.66.254 1.216.598 1.772 1.153a4.908 4.908 0 011.153 1.772c.247.637.415 1.363.465 2.428.047 1.066.06 1.405.06 4.122 0 2.717-.01 3.056-.06 4.122-.05 1.065-.218 1.79-.465 2.428a4.883 4.883 0 01-1.153 1.772 4.915 4.915 0 01-1.772 1.153c-.637.247-1.363.415-2.428.465-1.066.047-1.405.06-4.122.06-2.717 0-3.056-.01-4.122-.06-1.065-.05-1.79-.218-2.428-.465a4.89 4.89 0 01-1.772-1.153 4.904 4.904 0 01-1.153-1.772c-.248-.637-.415-1.363-.465-2.428C2.013 15.056 2 14.717 2 12c0-2.717.01-3.056.06-4.122.05-1.066.217-1.79.465-2.428a4.88 4.88 0 011.153-1.772A4.897 4.897 0 015.45 2.525c.638-.248 1.362-.415 2.428-.465C8.944 2.013 9.283 2 12 2zm0 5a5 5 0 100 10 5 5 0 000-10zm6.5-.25a1.25 1.25 0 10-2.5 0 1.25 1.25 0 002.5 0zM12 9a3 3 0 110 6 3 3 0 010-6z" />
      </svg>
    ),
    color: "text-[#E4405F] bg-gradient-to-br from-[#833AB4]/10 via-[#E4405F]/10 to-[#FCAF45]/10",
    label: "Instagram",
  },
  email: {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full p-0.5">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M22 7l-10 6L2 7" />
      </svg>
    ),
    color: "text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800",
    label: "Email",
  },
  sms: {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full p-0.5">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
      </svg>
    ),
    color: "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30",
    label: "SMS",
  },
  whatsapp: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full p-0.5">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
      </svg>
    ),
    color: "text-[#25D366] bg-[#25D366]/10",
    label: "WhatsApp",
  },
  telegram: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full p-0.5">
        <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
    color: "text-[#26A5E4] bg-[#26A5E4]/10",
    label: "Telegram",
  },
  messenger: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full p-0.5">
        <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.2 5.42 3.15 7.18V22l2.97-1.63c.84.23 1.72.36 2.65.36h.23C16.64 20.73 22 17.27 22 11.7 22 6.13 17.64 2 12 2zm1.18 12.63l-2.55-2.72L5.8 14.63l5.38-5.71 2.55 2.72 4.83-2.72-5.38 5.71z" />
      </svg>
    ),
    color: "text-[#0084FF] bg-[#0084FF]/10",
    label: "Messenger",
  },
  twitter: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full p-0.5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    color: "text-foreground bg-foreground/10",
    label: "X",
  },
};

const fallbackConfig = channelConfig.email;

export function ChannelIndicator({
  channel,
  className,
  showLabel = false,
}: ChannelIndicatorProps) {
  const config = channelConfig[channel] || fallbackConfig;

  return (
    <div
      className={cn(
        "flex items-center justify-center",
        config.color,
        className
      )}
      title={config.label}
    >
      <div className="h-3.5 w-3.5 flex-shrink-0">{config.icon}</div>
      {showLabel && (
        <span className="ml-1 text-[10px] font-medium leading-none">{config.label}</span>
      )}
    </div>
  );
}

export function getChannelLabel(channel: ConversationChannel): string {
  return channelConfig[channel]?.label || channel;
}
