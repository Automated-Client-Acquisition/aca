import { supabase } from "@/integrations/supabase/client";

/**
 * Wrapper around supabase.functions.invoke that properly extracts
 * error messages from edge function responses.
 *
 * The raw supabase.functions.invoke() returns a generic
 * "Edge Function returned a non-2xx status code" on any non-2xx response.
 * The actual error details are buried in error.context (the raw Response).
 * This wrapper reads and throws the real error message.
 */
/**
 * Error thrown by invokeEdgeFunction that preserves the full structured
 * response body from the edge function. Use `details` to access fields like
 * `error_title`, `error_message`, `next_steps`, `help_url`, etc.
 */
export class EdgeFunctionError extends Error {
  public readonly details: Record<string, unknown>;
  public readonly code?: string;
  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "EdgeFunctionError";
    this.details = details;
    this.code = typeof details.error === "string" ? details.error : undefined;
  }
}

export async function invokeEdgeFunction<T = Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    let message = error.message;
    let details: Record<string, unknown> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = (error as any).context;
    if (context && typeof context.json === "function") {
      try {
        const errorBody = await context.json();
        details = errorBody || {};
        message = errorBody?.error_title || errorBody?.error_message || errorBody?.error || errorBody?.message || message;
      } catch {
        // Response body not JSON-parseable, use default message
      }
    }
    throw new EdgeFunctionError(message, details);
  }

  return data as T;
}
