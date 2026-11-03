/**
 * Queueing an autopilot's finished piece for publishing. Shared by approve-stage
 * (staged pipelines, when the last stage completes) and dispatch-generation-job
 * (one-shot pipelines such as articles, which never pass through approve-stage
 * and so were never published).
 */
import { getTimezoneOffset } from './autopilot-schedule.ts';
import { mediaKindForOutput, skipReason } from './platform-fit.ts';

/**
 * Queue content for publishing to the autopilot's enabled destinations: only
 * the accounts its blueprint posts to (content_mix[].destination_account_ids),
 * and only those that can take this kind of piece (platform-fit.ts).
 */
export async function queueForPublish(
  supabase: any,
  autopilotId: string,
  outputId: string,
  jobId: string | null,
  jobConfig: Record<string, any> | null = null
): Promise<void> {
  try {
    // Fetch autopilot configuration
    const { data: autopilot, error: autopilotError } = await supabase
      .from('autopilots')
      .select('*')
      .eq('id', autopilotId)
      .single();

    if (autopilotError || !autopilot) {
      console.error(`❌ [Autopilot] Failed to fetch autopilot ${autopilotId}:`, autopilotError);
      return;
    }

    // Get enabled destinations
    const enabled = (autopilot.destinations || []).filter((d: any) => d.enabled);

    if (enabled.length === 0) {
      console.log(`⚠️ [Autopilot] No enabled destinations for autopilot ${autopilotId}`);
      await logAutomation(supabase, autopilotId, outputId, jobId, 'no_destinations', null, {});
      return;
    }

    const { data: output } = await supabase
      .from('content_outputs')
      .select('pipeline, stage_data')
      .eq('id', outputId)
      .single();

    // The accounts this blueprint posts to (all of them unless the mix narrows it),
    // and the run's configuration (publish_at) when the caller didn't pass it.
    let blueprintId: string | null = null;
    if (jobId) {
      const { data: job } = await supabase.from('content_generation_jobs').select('blueprint_id, configuration').eq('id', jobId).maybeSingle();
      blueprintId = job?.blueprint_id ?? null;
      jobConfig = jobConfig ?? job?.configuration ?? null;
    }
    const mixEntry = blueprintId
      ? (autopilot.content_mix || []).find((m: any) => m?.enabled && m.blueprint_id === blueprintId && m.destination_account_ids?.length)
      : null;
    const onlyAccounts: Set<string> | null = mixEntry ? new Set(mixEntry.destination_account_ids) : null;
    const kind = mediaKindForOutput(output || {});

    const destinations: any[] = [];
    for (const dest of enabled) {
      const reason = onlyAccounts && !onlyAccounts.has(dest.account_id)
        ? 'This blueprint doesn\'t post to this account'
        : skipReason(dest.platform, kind);
      if (reason) {
        console.log(`⏭️ [Autopilot] Skipping ${dest.platform} ${dest.account_id}: ${reason}`);
        await logAutomation(supabase, autopilotId, outputId, jobId, 'destination_skipped', null, {
          account_id: dest.account_id,
          platform: dest.platform,
          reason,
        });
      } else {
        destinations.push(dest);
      }
    }

    if (destinations.length === 0) {
      console.log(`⚠️ [Autopilot] No destination can take output ${outputId}`);
      await logAutomation(supabase, autopilotId, outputId, jobId, 'no_destinations', null, { all_skipped: true });
      return;
    }

    console.log(`📤 [Autopilot] Queueing to ${destinations.length} destinations`);

    // For twitter_thread pipeline: parse thread tweets from stage_data so publish_queue
    // has them ready — process-publish-queue reads tweet_thread directly from the row.
    let tweetThread: Array<{ text: string; media_urls?: string[] }> | null = null;
    if (output?.pipeline === 'twitter_thread') {
      const raw = output.stage_data?.thread_tweets?.content || output.stage_data?.thread_tweets?.text || '';
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const tweets = Array.isArray(parsed?.tweets) ? parsed.tweets : Array.isArray(parsed) ? parsed : [];
        const parsedTweets: Array<{ text: string; media_urls?: string[] }> = tweets
          .filter((t: any) => t.text?.trim())
          .map((t: any) => ({ text: t.text, media_urls: t.media_urls }));
        tweetThread = parsedTweets;
        if (parsedTweets.length > 0) {
          console.log(`📝 [Autopilot] twitter_thread: parsed ${parsedTweets.length} tweets for queue`);
        }
      } catch (e) {
        console.warn(`⚠️ [Autopilot] Failed to parse thread_tweets JSON:`, e);
      }
    }

    // Days-and-times autopilots post at the slot the run was made for (it starts an
    // hour early), or straight away when it finished late or was a "Run now".
    // This used to wait for the NEXT scheduled time, so every post went out a day late.
    const scheduledFor = autopilot.scheduling_mode === 'scheduled'
      ? scheduledPublishTime(jobConfig?.publish_at)
      : calculateOptimalTime(autopilot.scheduling_mode, autopilot.timezone, autopilot.scheduled_times);

    // Queue to each enabled destination
    for (const dest of destinations) {
      const queueRow: any = {
        autopilot_id: autopilotId,
        output_id: outputId,
        account_id: dest.account_id,
        platform: dest.platform || 'ghl',
        scheduled_for: scheduledFor.toISOString(),
        status: 'pending',
      };

      if (tweetThread && tweetThread.length > 1) {
        queueRow.tweet_thread = tweetThread;
      }

      const { error: queueError } = await supabase.from('publish_queue').insert(queueRow);

      if (queueError) {
        console.error(`❌ [Autopilot] Failed to queue for ${dest.account_id}:`, queueError);
        await logAutomation(supabase, autopilotId, outputId, jobId, 'queue_failed', null, {
          account_id: dest.account_id,
          error: queueError.message
        });
      } else {
        console.log(`✅ [Autopilot] Queued for ${dest.account_id} at ${scheduledFor.toISOString()}`);
        await logAutomation(supabase, autopilotId, outputId, jobId, 'publish_queued', null, {
          account_id: dest.account_id,
          scheduled_for: scheduledFor.toISOString()
        });
      }
    }
  } catch (error) {
    console.error(`❌ [Autopilot] Queue for publish error:`, error);
  }
}

/** A scheduled run's slot, or now when it's already passed (or the run had none). */
function scheduledPublishTime(publishAt: string | null | undefined): Date {
  const now = new Date();
  const at = publishAt ? new Date(publishAt) : null;
  return at && !Number.isNaN(at.getTime()) && at.getTime() > now.getTime() ? at : now;
}

/**
 * Calculate optimal publish time based on autopilot settings
 */
export function calculateOptimalTime(
  mode: string,
  timezone: string,
  scheduledTimes?: string[]
): Date {
  const now = new Date();

  if (mode === 'immediate') {
    return now;
  }

  if (mode === 'scheduled' && scheduledTimes?.length) {
    // Find next scheduled time
    return getNextScheduledTime(scheduledTimes, timezone);
  }

  // Optimal mode: find next good slot
  // Default optimal hours for social media posting
  const OPTIMAL_HOURS = [9, 12, 14, 17, 19];

  // Get current hour in the target timezone
  const tzOffset = getTimezoneOffset(timezone);
  const localHour = (now.getUTCHours() + tzOffset + 24) % 24;

  // Find next optimal hour
  for (const hour of OPTIMAL_HOURS) {
    if (hour > localHour) {
      const scheduledDate = new Date(now);
      scheduledDate.setUTCHours(hour - tzOffset, 0, 0, 0);
      return scheduledDate;
    }
  }

  // All optimal hours passed today, schedule for tomorrow's first slot
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setUTCHours(OPTIMAL_HOURS[0] - tzOffset, 0, 0, 0);
  return tomorrow;
}

/**
 * Get next scheduled time from a list of times
 */
function getNextScheduledTime(scheduledTimes: string[], timezone: string): Date {
  const now = new Date();
  const tzOffset = getTimezoneOffset(timezone);

  // Parse scheduled times (format: "HH:MM")
  const times = scheduledTimes.map(t => {
    const [hours, minutes] = t.split(':').map(Number);
    return { hours, minutes };
  }).sort((a, b) => a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes));

  const localHour = (now.getUTCHours() + tzOffset + 24) % 24;
  const localMinute = now.getUTCMinutes();
  const localTimeInMinutes = localHour * 60 + localMinute;

  // Find next time slot
  for (const time of times) {
    const slotInMinutes = time.hours * 60 + time.minutes;
    if (slotInMinutes > localTimeInMinutes) {
      const scheduledDate = new Date(now);
      scheduledDate.setUTCHours(time.hours - tzOffset, time.minutes, 0, 0);
      return scheduledDate;
    }
  }

  // All times passed today, schedule for tomorrow's first slot
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setUTCHours(times[0].hours - tzOffset, times[0].minutes, 0, 0);
  return tomorrow;
}

/**
 * Log an automation event
 */
async function logAutomation(
  supabase: any,
  autopilotId: string,
  outputId: string | null,
  jobId: string | null,
  eventType: string,
  stageId: string | null,
  details: any
): Promise<void> {
  try {
    await supabase.from('automation_logs').insert({
      autopilot_id: autopilotId,
      output_id: outputId,
      job_id: jobId,
      event_type: eventType,
      stage_id: stageId,
      details
    });
  } catch (error) {
    console.error('Failed to log automation event:', error);
  }
}
