/**
 * What an autopilot posted recently, so its writers don't repeat it. Each
 * writer call starts fresh, so similar ideas came back with the same kind of
 * opening line and the same kind of picture, post after post.
 *
 * Autopilot pieces only: manual runs are deliberate and often re-runs of the
 * same topic, where "be different from last time" is the wrong instruction.
 */
export interface RecentPiece {
  caption: string;
  imagePrompt: string;
}

export const RECENT_PIECES_LIMIT = 6;

/** The autopilot's pieces made before this one, most recent first. */
export async function loadRecentPieces(supabase: any, output: any, limit = RECENT_PIECES_LIMIT): Promise<RecentPiece[]> {
  if (!output?.autopilot_id || !output?.id) return [];
  try {
    const { data, error } = await supabase
      .from('content_outputs')
      .select('caption:stage_data->caption->>content, image_prompt:stage_data->image_prompt->>content')
      .eq('autopilot_id', output.autopilot_id)
      .neq('id', output.id)
      .neq('status', 'failed')
      .lt('created_at', output.created_at ?? new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      caption: typeof r?.caption === 'string' ? r.caption : '',
      imagePrompt: typeof r?.image_prompt === 'string' ? r.image_prompt : '',
    }));
  } catch (e) {
    console.warn('[recent-pieces] Could not load recent pieces:', e instanceof Error ? e.message : e);
    return [];
  }
}

/** Opening lines of an autopilot's latest posts, most recent first (for picking a hook). */
export async function loadRecentOpenings(supabase: any, autopilotId: string, limit = RECENT_PIECES_LIMIT): Promise<string[]> {
  if (!autopilotId) return [];
  try {
    const { data, error } = await supabase
      .from('content_outputs')
      .select('caption:stage_data->caption->>content')
      .eq('autopilot_id', autopilotId)
      .neq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? [])
      .map((r: any) => (typeof r?.caption === 'string' ? openingLine(r.caption) : ''))
      .filter((o: string) => o.length > 0);
  } catch (e) {
    console.warn('[recent-pieces] Could not load recent openings:', e instanceof Error ? e.message : e);
    return [];
  }
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A caption's opening: its first non-empty line, clipped. */
export function openingLine(caption: string, max = 140): string {
  const first = caption.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return clip(first, max);
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const key = s.toLowerCase();
    if (!s || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * For the image-prompt writer: the last images' prompts, and to show something
 * else. With a fixed style (a look or a style reference) only the content and
 * framing should change, not the look.
 */
export function recentImagesBrief(pieces: RecentPiece[], opts: { keepStyle?: boolean } = {}): string {
  const prompts = unique(pieces.map((p) => clip(p.imagePrompt, 220)));
  if (prompts.length === 0) return '';
  const change = opts.keepStyle
    ? 'Keep the required visual style, but choose a clearly different subject, composition, framing and setting from these.'
    : 'Choose a clearly different subject, composition, camera angle, setting and colour mood from these.';
  return `\nRECENT IMAGES FROM THIS ACCOUNT (make this one clearly different):
${prompts.map((p) => `- ${p}`).join('\n')}
${change}\n`;
}
