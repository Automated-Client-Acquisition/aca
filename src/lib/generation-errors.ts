/**
 * Plain-language versions of the generation errors people actually hit
 * (content_generation_jobs.error, last 90 days): revoked keys, withdrawn
 * models, rate limits, empty credit balances, missing storage.
 */
export function humanizeGenerationError(raw: string | null | undefined): string {
  const error = (raw ?? "").trim();
  if (!error) return "Unknown error";
  const e = error.toLowerCase();

  if (e.includes("flagged as invalid") || e.includes("invalid api key") || e.includes("401")) {
    const provider = error.match(/Your (\w+) API key/)?.[1] ?? "The provider";
    return `${provider} rejected the API key. Update it in Settings.`;
  }
  if (e.includes("api key is required") || e.includes("no api keys configured") || e.includes("key not configured")) {
    return "An API key is missing. Add it in Settings.";
  }
  if (e.includes("unavailable for free") || e.includes("no endpoints found") || e.includes("not a valid model")) {
    return "The model this blueprint uses was withdrawn by the provider.";
  }
  if (e.includes("requires more credits") || e.includes("402")) {
    return "Out of OpenRouter credits. Top up, or pick a cheaper quality.";
  }
  if (e.includes("429") || e.includes("rate limit")) {
    return "The model provider rate-limited the request. It usually passes on a retry.";
  }
  if (e.includes("cloud storage is required")) {
    return "No cloud storage connected for images and videos.";
  }
  const firstSentence = error.split(/(?<=\.)\s/)[0];
  return firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}...` : firstSentence;
}
