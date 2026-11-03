import type { JobContentSummary, JobPublicationTarget } from "@/hooks/useJobContentSummaries";

const platformKey = (platform: string) => ["x", "twitter"].includes(platform.toLowerCase()) ? "twitter" : platform.toLowerCase();
const destinationKey = (target: JobPublicationTarget) =>
  JSON.stringify([target.outputId, platformKey(target.platform), target.accountId || target.id]);

/** Provider publishing and the queue both record the same successful delivery. */
export function deduplicatePublicationTargets(targets: JobPublicationTarget[]): JobPublicationTarget[] {
  const groups = new Map<string, JobPublicationTarget[]>();
  for (const target of targets) {
    const key = JSON.stringify([destinationKey(target), target.status,
      target.status === "scheduled" || target.status === "pending" ? target.scheduledFor || "" : ""]);
    groups.set(key, [...(groups.get(key) || []), target]);
  }
  const result: JobPublicationTarget[] = [];
  for (const group of groups.values()) {
    const withPostIds = group.filter(target => target.postId);
    if (withPostIds.length) {
      // Different provider IDs represent distinct posts/reposts. A queue row
      // without a provider ID is only a fallback for these provider records.
      const uniquePosts = new Map<string, JobPublicationTarget>();
      for (const target of withPostIds) {
        const existing = uniquePosts.get(target.postId!);
        uniquePosts.set(target.postId!, existing ? mergeTarget(existing, target) : target);
      }
      result.push(...uniquePosts.values());
    } else {
      const preferred = group.find(target => target.source === "provider") || group[0];
      result.push(group.reduce((merged, target) => mergeTarget(merged, target), preferred));
    }
  }
  return result;
}

function mergeTarget(preferred: JobPublicationTarget, fallback: JobPublicationTarget): JobPublicationTarget {
  return { ...fallback, ...preferred,
    accountName: preferred.accountName || fallback.accountName,
    url: preferred.url || fallback.url,
    publishedAt: preferred.publishedAt || fallback.publishedAt,
    error: preferred.error || fallback.error,
  };
}

/** Counts content pieces separately from their social destinations. */
export function getJobContentCounts(summary?: JobContentSummary) {
  const outputs = summary?.outputs || [];
  const targets = deduplicatePublicationTargets(summary?.targets || []);
  const publishedTargets = targets.filter(target => target.status === "published");
  const scheduledTargets = targets.filter(target => target.status === "scheduled");
  const ready = outputs.filter(output => output.state === "ready" || output.state === "done").length;
  return {
    created: ready,
    ready,
    // Final-stage outputs retain status=review even after publishing. Only
    // an actual intermediate approval/stalled stage needs the person's OK.
    review: outputs.filter(output => output.state === "waiting").length,
    generating: outputs.filter(output => output.state === "generating").length,
    failed: outputs.filter(output => output.state === "failed").length,
    discarded: outputs.filter(output => output.state === "discarded").length,
    published: new Set(publishedTargets.map(target => target.outputId)).size,
    publishedTargets: publishedTargets.length,
    scheduled: new Set(scheduledTargets.map(target => target.outputId)).size,
    scheduledTargets: scheduledTargets.length,
    pendingTargets: targets.filter(target => target.status === "pending").length,
    publishingTargets: targets.filter(target => target.status === "publishing").length,
    publicationFailedTargets: targets.filter(target => target.status === "failed" || target.status === "error").length,
    savedTargets: targets.filter(target => target.status === "saved").length,
  };
}
