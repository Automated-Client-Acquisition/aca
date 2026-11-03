/**
 * The text of a stage_data entry, for publishing.
 *
 * `content` wins over `text`: the job panel saves hand edits to
 * stage_data[stage].content only and spreads the old object, so outputs that
 * stored both fields (pre-2026-10-01 carousel captions, submit-content posts
 * after an edit) keep the unedited copy in `text`. Reading `text` first
 * silently published the original. Non-string values are skipped, since some
 * stages keep an object in `content`.
 */
export function stageText(stage: unknown): string {
  if (!stage || typeof stage !== 'object') return '';
  const { content, text } = stage as { content?: unknown; text?: unknown };
  if (typeof content === 'string' && content) return content;
  if (typeof text === 'string' && text) return text;
  return '';
}
