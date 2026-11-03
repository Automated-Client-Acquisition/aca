import type { ConversationChannel } from "@/hooks/crm/useConversations";

export interface ChannelCapabilities {
  supportsAttachments: boolean;
  supportsImageAttachments: boolean;
  supportsFileAttachments: boolean;
  supportsHtml: boolean;
  supportsSubject: boolean;
  characterLimit: number | null;
  /** Warning to show when 24h window has elapsed (WhatsApp Business API) */
  has24hWindow: boolean;
  /** Label displayed in the composer */
  label: string;
}

const channelCapabilitiesMap: Record<ConversationChannel, ChannelCapabilities> = {
  email: {
    supportsAttachments: true,
    supportsImageAttachments: true,
    supportsFileAttachments: true,
    supportsHtml: true,
    supportsSubject: true,
    characterLimit: null,
    has24hWindow: false,
    label: "Email",
  },
  linkedin: {
    supportsAttachments: false,
    supportsImageAttachments: false,
    supportsFileAttachments: false,
    supportsHtml: false,
    supportsSubject: false,
    characterLimit: 3000,
    has24hWindow: false,
    label: "LinkedIn",
  },
  instagram: {
    supportsAttachments: true,
    supportsImageAttachments: true,
    supportsFileAttachments: false,
    supportsHtml: false,
    supportsSubject: false,
    characterLimit: 1000,
    has24hWindow: false,
    label: "Instagram",
  },
  // Twilio SMS: plain text only (no MMS yet). Twilio splits long texts into
  // 153-character segments and rejects anything over 1,600 characters.
  sms: {
    supportsAttachments: false,
    supportsImageAttachments: false,
    supportsFileAttachments: false,
    supportsHtml: false,
    supportsSubject: false,
    characterLimit: 1600,
    has24hWindow: false,
    label: "SMS",
  },
  whatsapp: {
    supportsAttachments: true,
    supportsImageAttachments: true,
    supportsFileAttachments: true,
    supportsHtml: false,
    supportsSubject: false,
    characterLimit: null,
    has24hWindow: true,
    label: "WhatsApp",
  },
  telegram: {
    supportsAttachments: true,
    supportsImageAttachments: true,
    supportsFileAttachments: true,
    supportsHtml: false,
    supportsSubject: false,
    characterLimit: 4096,
    has24hWindow: false,
    label: "Telegram",
  },
  messenger: {
    supportsAttachments: true,
    supportsImageAttachments: true,
    supportsFileAttachments: true,
    supportsHtml: false,
    supportsSubject: false,
    characterLimit: 2000,
    has24hWindow: false,
    label: "Messenger",
  },
  twitter: {
    supportsAttachments: true,
    supportsImageAttachments: true,
    supportsFileAttachments: false,
    supportsHtml: false,
    supportsSubject: false,
    characterLimit: 10000,
    has24hWindow: false,
    label: "Twitter",
  },
};

export function getChannelCapabilities(channel: ConversationChannel): ChannelCapabilities {
  return channelCapabilitiesMap[channel] ?? channelCapabilitiesMap.email;
}
