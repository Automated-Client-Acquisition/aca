/**
 * REST resource: /v1/scheduler (the Social Scheduler)
 *
 *   GET    /v1/scheduler/accounts                accounts the org can post to
 *   POST   /v1/scheduler/accounts/connect        { platform } → a sign-in link (through Zernio)
 *   GET    /v1/scheduler/posts                   ?from&to&status&platform&limit
 *   POST   /v1/scheduler/posts                   create (scheduled, or status: "draft")
 *   POST   /v1/scheduler/posts/approve           { ids } drafts and agent proposals → scheduled
 *   GET    /v1/scheduler/posts/{id}              one post, every destination, stats
 *   PATCH  /v1/scheduler/posts/{id}              reschedule or edit (until it goes out)
 *   DELETE /v1/scheduler/posts/{id}              remove (what went out stays)
 *   POST   /v1/scheduler/posts/{id}/publish      out at the next queue run (≤ 5 min)
 *   POST   /v1/scheduler/posts/{id}/retry        failed destinations back in the queue
 *   GET    /v1/scheduler/posts/{id}/stats        reach, likes, comments… (?refresh=true reads the platform now)
 *   POST   /v1/scheduler/plan                    the scheduling agent drafts posts into the best free slots
 *
 * Vercel rewrites turn the paths into ?resource=…&id=…&action=… (see vercel.json). The logic is
 * _shared/scheduler-api.ts, shared with both MCP servers.
 */
import { ApiError, createResource, json, type Handler } from '../_shared/rest-api.ts';
import {
  approveSchedulerPosts,
  connectSchedulerAccount,
  createSchedulerPost,
  deleteSchedulerPost,
  getSchedulerPost,
  getSchedulerPostStats,
  listSchedulerAccounts,
  listSchedulerPosts,
  planSchedulerPosts,
  publishSchedulerPostNow,
  retrySchedulerPost,
  SchedulerError,
  updateSchedulerPost,
} from '../_shared/scheduler-api.ts';

type Ctx = Parameters<Handler>[0];

/** Runs one operation for the caller's org; a SchedulerError keeps its status and details. */
function route(fn: (ctx: Ctx, orgId: string) => Promise<unknown>, status = 200) {
  return async (ctx: Ctx): Promise<Response> => {
    const orgId = ctx.caller.organization_id;
    if (!orgId) throw new ApiError('This endpoint acts on an organization: call it with a user session or an API token', 403);
    try {
      return json({ success: true, data: await fn(ctx, orgId) }, status);
    } catch (error) {
      if (error instanceof SchedulerError) {
        return json({ success: false, error: error.message, ...(error.details && typeof error.details === 'object' ? error.details : {}) }, error.status);
      }
      throw error;
    }
  };
}

const q = (ctx: Ctx, key: string) => ctx.url.searchParams.get(key);
const unknownRoute = (ctx: Ctx) => {
  throw new ApiError(`No such scheduler endpoint: ${ctx.req.method} ${ctx.url.searchParams.get('resource') ?? ''} ${ctx.url.searchParams.get('action') ?? ''}`.trim(), 404);
};

Deno.serve(createResource({
  GET: async (ctx) => {
    const resource = q(ctx, 'resource') ?? 'posts';
    const id = q(ctx, 'id');
    if (resource === 'accounts') return route((_c, org) => listSchedulerAccounts(ctx.supabase, org))(ctx);
    if (resource === 'stats' && id) return route((_c, org) => getSchedulerPostStats(ctx.supabase, org, id, { refresh: q(ctx, 'refresh') === 'true' }))(ctx);
    if (resource === 'posts' && id) return route((_c, org) => getSchedulerPost(ctx.supabase, org, id, { history: q(ctx, 'history') === 'true' }))(ctx);
    if (resource === 'posts') {
      return route((_c, org) => listSchedulerPosts(ctx.supabase, org, {
        from: q(ctx, 'from') ?? undefined,
        to: q(ctx, 'to') ?? undefined,
        status: q(ctx, 'status') ?? undefined,
        platform: q(ctx, 'platform') ?? undefined,
        limit: q(ctx, 'limit') ?? undefined,
      }))(ctx);
    }
    return unknownRoute(ctx);
  },

  POST: async (ctx) => {
    const resource = q(ctx, 'resource') ?? 'posts';
    const id = q(ctx, 'id');
    const action = q(ctx, 'action');
    const userId = (ctx.caller as { user_id?: string | null }).user_id ?? null;
    if (resource === 'accounts' && action === 'connect') return route((_c, org) => connectSchedulerAccount(org, ctx.body.platform))(ctx);
    if (resource === 'plan') return route((_c, org) => planSchedulerPosts(ctx.supabase, org, ctx.body), 201)(ctx);
    if (resource === 'posts' && action === 'approve') return route((_c, org) => approveSchedulerPosts(ctx.supabase, org, ctx.body.ids))(ctx);
    if (resource === 'posts' && id && action === 'publish') return route((_c, org) => publishSchedulerPostNow(ctx.supabase, org, id))(ctx);
    if (resource === 'posts' && id && action === 'retry') return route((_c, org) => retrySchedulerPost(ctx.supabase, org, id))(ctx);
    if (resource === 'posts' && !id && !action) return route((_c, org) => createSchedulerPost(ctx.supabase, org, ctx.body, userId), 201)(ctx);
    return unknownRoute(ctx);
  },

  PATCH: async (ctx) => {
    const id = q(ctx, 'id');
    if (!id) throw new ApiError('PATCH needs a post id: /v1/scheduler/posts/{id}', 400);
    return route((_c, org) => updateSchedulerPost(ctx.supabase, org, id, ctx.body))(ctx);
  },

  DELETE: async (ctx) => {
    const id = q(ctx, 'id');
    if (!id) throw new ApiError('DELETE needs a post id: /v1/scheduler/posts/{id}', 400);
    return route((_c, org) => deleteSchedulerPost(ctx.supabase, org, id))(ctx);
  },
}));
