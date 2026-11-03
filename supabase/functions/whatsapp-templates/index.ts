/**
 * WhatsApp Business templates through Twilio's Content API.
 *
 * Actions:
 *  - { action: "create", organization_id, name, language, category, body, variables, samples, buttons? }
 *      creates the Content resource and submits it to Meta for approval
 *  - { action: "sync", organization_id }  pulls every template + approval status from Twilio
 *      (also picks up templates made in the Twilio Console)
 *  - { action: "delete", template_id }     deletes it in Twilio and here
 *  - { action: "send_template", conversation_id, template_id }  sends it on a Twilio
 *      WhatsApp thread from the inbox (reopens a closed 24h window)
 *
 * Template slots are {{1}}, {{2}}…; `variables` maps each slot to a contact field
 * (first_name, company, custom_<key>, …) used at send time, `samples` holds the
 * example values Meta reviews.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
import {
  createContentTemplate,
  credentialsFromKeyRow,
  deleteContentTemplate,
  fetchWhatsAppApproval,
  listContentTemplates,
  submitWhatsAppApproval,
  TwilioError,
  type TwilioCredentials,
} from '../_shared/twilio-client.ts';
import { renderTemplate, sendWhatsAppFrom, templateSlots, templateValues } from '../_shared/messaging/whatsapp.ts';
import { isOptedOut, loadSender } from '../_shared/messaging/sms.ts';
import { authenticateRequest } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Twilio/Meta approval status → whatsapp_templates.approval_status
const STATUS: Record<string, string> = {
  received: 'submitted', pending: 'pending', approved: 'approved', rejected: 'rejected',
  paused: 'paused', disabled: 'disabled', unsubmitted: 'draft',
};

async function orgTwilioKey(supabase: SupabaseClient, organizationId: string): Promise<{ id: string; creds: TwilioCredentials }> {
  const { data: key } = await supabase
    .from('api_keys')
    .select('id, key_encrypted, metadata')
    .eq('organization_id', organizationId)
    .eq('provider', 'twilio')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!key) throw new Error('Connect Twilio first (Settings → SMS & WhatsApp)');
  return { id: key.id, creds: await credentialsFromKeyRow(key) };
}

function bodyOf(item: { types: Record<string, { body?: string }> }): string {
  for (const type of Object.values(item.types ?? {})) if (type?.body) return type.body;
  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json();

    if (body.action === 'create') {
      const organizationId = body.organization_id;
      await assertOrgAccess(req, supabase, organizationId);

      const name = String(body.name ?? '').trim();
      const language = String(body.language ?? 'en').trim();
      const category = String(body.category ?? 'marketing').toLowerCase();
      const text = String(body.body ?? '').trim();
      const variables = (body.variables ?? {}) as Record<string, string>;
      const samples = (body.samples ?? {}) as Record<string, string>;
      const buttons = ((body.buttons ?? []) as string[]).map((t) => String(t).trim()).filter(Boolean).slice(0, 3);

      if (!/^[a-z0-9_]{1,512}$/.test(name)) return json({ error: 'Name: lowercase letters, numbers and underscores only' }, 400);
      if (!['marketing', 'utility'].includes(category)) return json({ error: 'Category must be marketing or utility' }, 400);
      if (!text) return json({ error: 'Template text is required' }, 400);
      if (text.length > 1024) return json({ error: 'Template text is limited to 1,024 characters' }, 400);
      const slots = templateSlots(text);
      for (let i = 0; i < slots.length; i++) {
        if (slots[i] !== String(i + 1)) return json({ error: 'Variables must be numbered {{1}}, {{2}}… in order' }, 400);
      }
      for (const slot of slots) {
        if (!variables[slot]) return json({ error: `Pick a contact field for {{${slot}}}` }, 400);
        if (!samples[slot]?.trim()) return json({ error: `Add an example value for {{${slot}}} (Meta reviews it)` }, 400);
      }
      if (/^\s*\{\{\d+\}\}|\{\{\d+\}\}\s*$/.test(text)) {
        return json({ error: 'Meta rejects templates that start or end with a variable' }, 400);
      }

      const key = await orgTwilioKey(supabase, organizationId);
      const { data: row, error: insertError } = await supabase
        .from('whatsapp_templates')
        .insert({
          organization_id: organizationId,
          api_key_id: key.id,
          name,
          language,
          category,
          body: text,
          variables,
          buttons: buttons.map((title, i) => ({ title, id: `btn_${i + 1}` })),
          approval_status: 'draft',
        })
        .select('id')
        .single();
      if (insertError) {
        return json({ error: insertError.code === '23505' ? 'A template with this name and language already exists' : insertError.message }, 400);
      }

      try {
        const sid = await createContentTemplate(key.creds, {
          friendlyName: name,
          language,
          body: text,
          sampleVariables: Object.fromEntries(slots.map((s) => [s, samples[s].trim()])),
          buttons: buttons.map((title, i) => ({ title, id: `btn_${i + 1}` })),
        });
        const approval = await submitWhatsAppApproval(key.creds, sid, name, category.toUpperCase() as 'MARKETING' | 'UTILITY');
        await supabase
          .from('whatsapp_templates')
          .update({
            provider_content_sid: sid,
            approval_status: STATUS[approval.status] ?? 'submitted',
            rejected_reason: approval.rejection_reason,
            synced_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        return json({ success: true, template_id: row.id, status: STATUS[approval.status] ?? 'submitted' });
      } catch (err) {
        // Keep the draft so the user can fix and resubmit; say what Twilio said
        await supabase.from('whatsapp_templates').update({ rejected_reason: (err as Error).message }).eq('id', row.id);
        throw err;
      }
    }

    if (body.action === 'sync') {
      const organizationId = body.organization_id;
      await assertOrgAccess(req, supabase, organizationId);
      const key = await orgTwilioKey(supabase, organizationId);

      const contents = await listContentTemplates(key.creds);
      const { data: existing } = await supabase
        .from('whatsapp_templates')
        .select('id, provider_content_sid, variables')
        .eq('organization_id', organizationId);
      const bySid = new Map((existing ?? []).filter((t) => t.provider_content_sid).map((t) => [t.provider_content_sid, t]));

      let synced = 0;
      for (const item of contents.slice(0, 200)) {
        const approval = await fetchWhatsAppApproval(key.creds, item.sid).catch(() => null);
        if (!approval || approval.status === 'unsubmitted') continue; // not a WhatsApp template
        const text = bodyOf(item);
        const quick = item.types?.['twilio/quick-reply'];
        const fields = {
          organization_id: organizationId,
          api_key_id: key.id,
          name: approval.name || item.friendly_name,
          language: item.language || 'en',
          category: (approval.category || 'marketing').toLowerCase(),
          body: text,
          buttons: (quick?.actions ?? []).map((a) => ({ title: a.title, id: a.id ?? a.title })),
          provider_content_sid: item.sid,
          approval_status: STATUS[approval.status] ?? 'pending',
          rejected_reason: approval.rejection_reason,
          synced_at: new Date().toISOString(),
        };
        const known = bySid.get(item.sid);
        if (known) {
          await supabase.from('whatsapp_templates').update(fields).eq('id', known.id);
        } else {
          // Made in the Twilio Console: slots start unmapped, the user maps them in ACA
          await supabase
            .from('whatsapp_templates')
            .upsert({ ...fields, variables: {} }, { onConflict: 'organization_id,name,language' });
        }
        synced++;
      }
      return json({ success: true, synced });
    }

    if (body.action === 'delete') {
      const { data: template } = await supabase
        .from('whatsapp_templates')
        .select('id, organization_id, provider_content_sid')
        .eq('id', body.template_id)
        .maybeSingle();
      if (!template) return json({ error: 'Template not found' }, 404);
      await assertOrgAccess(req, supabase, template.organization_id);
      if (template.provider_content_sid) {
        const key = await orgTwilioKey(supabase, template.organization_id);
        await deleteContentTemplate(key.creds, template.provider_content_sid).catch((err) => {
          if (!(err instanceof TwilioError && err.status === 404)) throw err;
        });
      }
      await supabase.from('whatsapp_templates').delete().eq('id', template.id);
      return json({ success: true });
    }

    if (body.action === 'send_template') {
      const { data: conv } = await supabase
        .from('crm_conversations')
        .select('id, organization_id, contact_id, channel, provider, messaging_sender_id, external_participant_id')
        .eq('id', body.conversation_id)
        .maybeSingle();
      if (!conv) return json({ error: 'Conversation not found' }, 404);
      await assertOrgAccess(req, supabase, conv.organization_id);
      if (conv.channel !== 'whatsapp' || conv.provider !== 'twilio' || !conv.messaging_sender_id) {
        return json({ error: 'Templates can only be sent on WhatsApp Business conversations' }, 400);
      }
      const to = conv.external_participant_id;
      if (!to?.startsWith('+')) return json({ error: 'Conversation has no phone number' }, 400);
      if (await isOptedOut(supabase, conv.organization_id, to, 'whatsapp_business')) {
        return json({ error: 'Contact opted out of WhatsApp' }, 400);
      }

      const { data: template } = await supabase
        .from('whatsapp_templates')
        .select('id, name, body, variables, provider_content_sid, approval_status')
        .eq('id', body.template_id)
        .eq('organization_id', conv.organization_id)
        .maybeSingle();
      if (!template || template.approval_status !== 'approved' || !template.provider_content_sid) {
        return json({ error: 'Pick an approved template' }, 400);
      }
      const { data: contact } = await supabase.from('crm_contacts').select('*').eq('id', conv.contact_id).maybeSingle();
      const filled = templateValues(template.body, template.variables ?? {}, contact ?? { id: conv.contact_id, organization_id: conv.organization_id });
      if ('missing' in filled) return json({ error: `This contact has no value for ${filled.missing}` }, 400);

      const loaded = await loadSender(supabase, conv.messaging_sender_id);
      if (!loaded || loaded.sender.status !== 'active') return json({ error: 'WhatsApp sender is not active' }, 400);

      const caller = await authenticateRequest(req, supabase).catch(() => null);
      const { sid } = await sendWhatsAppFrom(supabase, loaded.sender, loaded.creds, to,
        { contentSid: template.provider_content_sid, variables: filled.values },
        { organizationId: conv.organization_id, contactId: conv.contact_id, source: 'inbox', newContact: false });

      const content = renderTemplate(template.body, filled.values);
      const { data: message } = await supabase
        .from('crm_messages')
        .insert({
          organization_id: conv.organization_id,
          conversation_id: conv.id,
          contact_id: conv.contact_id,
          direction: 'outbound',
          sender_type: 'user',
          sender_user_id: caller?.user_id ?? null,
          content,
          content_type: 'text',
          status: 'sent',
          external_message_id: sid,
          metadata: { source: 'inbox', channel: 'whatsapp', provider: 'twilio', template_id: template.id, template_name: template.name },
        })
        .select('id')
        .single();
      return json({ success: true, message_id: message?.id ?? null, external_message_id: sid });
    }

    return json({ error: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    if (err instanceof AuthError) return unauthorized(err, corsHeaders);
    const message = err instanceof Error ? err.message : String(err);
    console.error('[whatsapp-templates]', message);
    return json({ error: message }, err instanceof TwilioError && err.status < 500 ? 400 : 500);
  }
});
