/**
 * Reschedule Enrollments
 *
 * Recalculates next_send_at for all active enrollments of a sequence
 * using the sequence's current settings (send_window, timezone, skip_weekends).
 * Called when a user changes scheduling-related settings.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { sequenceId } = await req.json();
    if (!sequenceId) {
      return new Response(JSON.stringify({ error: 'sequenceId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch sequence settings
    const { data: sequence, error: seqError } = await supabase
      .from('email_sequences')
      .select('id, organization_id, settings')
      .eq('id', sequenceId)
      .single();

    if (seqError || !sequence) {
      return new Response(JSON.stringify({ error: 'Sequence not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, sequence.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    const settings = (sequence.settings as Record<string, unknown>) || {};

    // Fetch all active enrollments with a future next_send_at
    const { data: enrollments, error: enrollError } = await supabase
      .from('email_sequence_enrollments')
      .select('id, next_send_at')
      .eq('sequence_id', sequenceId)
      .eq('status', 'active')
      .not('next_send_at', 'is', null);

    if (enrollError) {
      return new Response(JSON.stringify({ error: enrollError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!enrollments || enrollments.length === 0) {
      return new Response(JSON.stringify({ updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Recalculate each enrollment's next_send_at through the new send window
    const nowISO = new Date().toISOString();
    let updated = 0;

    for (const enrollment of enrollments) {
      const oldSendAt = new Date(enrollment.next_send_at);
      // Use whichever is later: the original scheduled time or now
      const candidate = oldSendAt.getTime() > Date.now() ? oldSendAt : new Date();
      const newSendAt = adjustToSendWindow(candidate, settings);

      if (newSendAt.toISOString() !== enrollment.next_send_at) {
        await supabase
          .from('email_sequence_enrollments')
          .update({ next_send_at: newSendAt.toISOString(), updated_at: nowISO })
          .eq('id', enrollment.id);
        updated++;
      }
    }

    return new Response(JSON.stringify({ updated, total: enrollments.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ---------- Scheduling helpers (same as sequence-sender worker) ----------

function getLocalTime(date: Date, timezone: string): { hours: number; minutes: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const weekday = parts.find(p => p.type === 'weekday')?.value || 'Mon';

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  // ?? not ||: Sunday is 0, and `|| 1` silently reported it as Monday,
  // letting skip_weekends sequences send all day Sunday.
  return { hours, minutes, dayOfWeek: dayMap[weekday] ?? 1 };
}

function setLocalTime(date: Date, hour: number, minute: number, timezone: string): Date {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateStr = dateFormatter.format(date);

  const localDateTimeStr = `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const localStr = date.toLocaleString('en-US', { timeZone: timezone });
  const offsetMs = new Date(utcStr).getTime() - new Date(localStr).getTime();

  return new Date(new Date(localDateTimeStr + 'Z').getTime() + offsetMs);
}

function adjustToSendWindow(candidate: Date, settings: Record<string, unknown>): Date {
  const tz = (settings.timezone as string) || 'America/New_York';
  const sendWindow = settings.send_window as { start: string; end: string } | undefined;
  if (!sendWindow) return candidate;

  const skipWeekends = settings.skip_weekends as boolean;
  const [startH, startM] = sendWindow.start.split(':').map(Number);
  const [endH, endM] = sendWindow.end.split(':').map(Number);
  const windowStartMin = startH * 60 + startM;
  const windowEndMin = endH * 60 + endM;

  let adjusted = new Date(candidate.getTime());
  for (let attempt = 0; attempt < 10; attempt++) {
    const local = getLocalTime(adjusted, tz);
    const localMin = local.hours * 60 + local.minutes;
    const isWeekendDay = local.dayOfWeek === 0 || local.dayOfWeek === 6;

    if (skipWeekends && isWeekendDay) {
      const daysUntilMonday = local.dayOfWeek === 0 ? 1 : (8 - local.dayOfWeek);
      adjusted = new Date(adjusted.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
      adjusted = setLocalTime(adjusted, startH, startM, tz);
      adjusted = new Date(adjusted.getTime() + Math.random() * 15 * 60 * 1000);
      continue;
    }

    if (localMin < windowStartMin) {
      adjusted = setLocalTime(adjusted, startH, startM, tz);
      adjusted = new Date(adjusted.getTime() + Math.random() * 15 * 60 * 1000);
      break;
    }

    if (localMin >= windowEndMin) {
      adjusted = new Date(adjusted.getTime() + 24 * 60 * 60 * 1000);
      adjusted = setLocalTime(adjusted, startH, startM, tz);
      adjusted = new Date(adjusted.getTime() + Math.random() * 15 * 60 * 1000);
      continue;
    }

    break;
  }

  return adjusted;
}
