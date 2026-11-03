interface LeadDmMessageParams {
  template: string;
  commenterName?: string | null;
  matchedKeyword?: string | null;
  leadId: string;
  leadMagnetUrl?: string | null;
  supabaseUrl: string;
}

export function buildLeadMagnetGateUrl(leadId: string, supabaseUrl: string): string {
  const explicitGateUrl = Deno.env.get('LEAD_MAGNET_GATE_URL');
  const baseUrl = explicitGateUrl || `${supabaseUrl}/functions/v1/lead-magnet-gate`;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}lead_id=${encodeURIComponent(leadId)}`;
}

export function buildLeadDmMessage(params: LeadDmMessageParams): string {
  const {
    template,
    commenterName,
    matchedKeyword,
    leadId,
    leadMagnetUrl,
    supabaseUrl,
  } = params;

  const fullName = (commenterName || '').trim();
  const firstName = fullName.split(' ')[0] || 'there';
  const keyword = (matchedKeyword || '').trim();

  let message = template || '';
  message = message.replace(/\{name\}/gi, firstName);
  message = message.replace(/\{full_name\}/gi, fullName);
  message = message.replace(/\{keyword\}/gi, keyword);

  if (!leadMagnetUrl) {
    return message;
  }

  const gatedUrl = buildLeadMagnetGateUrl(leadId, supabaseUrl);

  const hadCurlyPlaceholder = /\{link\}/i.test(message);
  const hadLegacyPlaceholder = /\[YOUR_LINK_HERE\]/i.test(message);
  const hadPlaceholder = hadCurlyPlaceholder || hadLegacyPlaceholder;

  message = message.replace(/\{link\}/gi, gatedUrl);
  message = message.replace(/\[YOUR_LINK_HERE\]/gi, gatedUrl);

  if (!hadPlaceholder && !message.includes(gatedUrl)) {
    message = `${message}\n\n${gatedUrl}`.trim();
  }

  return message;
}
