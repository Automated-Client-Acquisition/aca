/**
 * REST resource: /v1/signals
 *
 *   POST /v1/signals   push one signal, or { signals: [...] } for a batch
 *
 * Exists so an integration needs exactly one credential. Everything else on
 * /v1 authenticates with an `aca_` API token, while `push-public-signal`
 * accepted only a shared secret or a Supabase user JWT — the secret is
 * write-only in the platform (never readable again once set) and the JWT
 * expires hourly, so neither suits an unattended workflow. Same writer, same
 * validation, same idempotency; only the front door is new.
 *
 * Authorization is org membership, not merely a valid token: the public feed is
 * one shared surface, so a token belonging to any other organization is
 * rejected rather than silently writing into someone else's feed.
 *
 * @see _shared/public-signals.ts for the payload contract and publish gate.
 */

import { ApiError, createResource, json } from '../_shared/rest-api.ts';
import {
  PushValidationError,
  upsertPublicSignals,
  type PushSignalInput,
} from '../_shared/public-signals.ts';
import { HOUSE_ORG_ID } from "../_shared/site-config.ts";

/** Batches are validated per item, so this only bounds one request's work. */
const MAX_BATCH = 100;

const PUBLIC_SIGNALS_ORG_ID =
  Deno.env.get('PUBLIC_SIGNALS_ORG_ID') ?? HOUSE_ORG_ID;

Deno.serve(createResource({
  POST: async ({ supabase, caller, body }) => {
    if (caller.organization_id !== PUBLIC_SIGNALS_ORG_ID) {
      throw new ApiError('This token may not write to the public signals feed', 403);
    }

    const raw = Array.isArray(body.signals) ? body.signals : [body];
    const signals = raw as PushSignalInput[];

    if (signals.length === 0) {
      throw new ApiError('Provide a signal object, or { "signals": [...] }');
    }
    if (signals.length > MAX_BATCH) {
      throw new ApiError(
        `Maximum ${MAX_BATCH} signals per request (received ${signals.length})`,
      );
    }

    try {
      const { ok, errors } = await upsertPublicSignals(supabase, signals, {
        createdBy: caller.user_id ?? null,
      });

      // A partial success is still a 200: per-item errors are reported in the
      // body so a caller pushing a batch can retry only what failed.
      return json({
        success: errors.length === 0,
        pushed: ok.length,
        failed: errors.length,
        results: ok,
        errors,
      }, errors.length && !ok.length ? 400 : 200);
    } catch (e) {
      if (e instanceof PushValidationError) throw new ApiError(e.message, 400);
      throw e;
    }
  },
}));
