export interface ContactDeletionResult {
  deleted: number;
  errors: number;
  total?: number;
}

/** Small deletes return JSON; larger deletes stream newline-delimited JSON. */
export async function readContactDeletionResponse(
  response: Response,
  onProgress?: (result: ContactDeletionResult) => void,
): Promise<ContactDeletionResult> {
  const parse = (value: unknown): ContactDeletionResult & { done?: boolean; success?: boolean } => {
    const data = value as Record<string, unknown> | null;
    if (data?.success === false) {
      throw new Error(typeof data.error === "string" ? data.error : "Contact deletion failed");
    }
    if (!data || ![data.deleted, data.errors].every(
      count => typeof count === "number" && Number.isInteger(count) && count >= 0,
    )) {
      throw new Error("Invalid contact deletion response. Refresh the list before retrying.");
    }
    return data as unknown as ContactDeletionResult & { done?: boolean; success?: boolean };
  };

  if (response.headers.get("content-type")?.includes("application/json")) {
    const result = parse(await response.json());
    if (result.success !== true) throw new Error("Contact deletion was not confirmed. Refresh the list before retrying.");
    onProgress?.(result);
    return result;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing contact deletion response");
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: ContactDeletionResult | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const result = parse(JSON.parse(line));
    onProgress?.(result);
    if (result.done === true && result.success === true) finalResult = result;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    consume(buffer);
    if (!finalResult) {
      throw new Error("Contact deletion was interrupted. Refresh the list to check which contacts remain before retrying.");
    }
    return finalResult;
  } finally {
    reader.releaseLock();
  }
}
