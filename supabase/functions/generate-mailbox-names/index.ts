import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { DEFAULT_FAST_TEXT_MODEL, DEFAULT_IMAGE_MODEL } from '../_shared/default-models.ts';
import OpenRouterImageProvider from '../_shared/providers/OpenRouterImageProvider.ts';
import { buildMailboxAvatarPrompt, inferGenderFromName, parseInferredGender } from '../_shared/mailbox-avatar.ts';
import { resolveApiKey, resolveEffectiveOrgId } from '../_shared/resolve-api-key.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const organizationId = await resolveEffectiveOrgId(supabase, user.id);
    if (!organizationId) return new Response(JSON.stringify({ error: 'No organization found for this user.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Org's own key, or its agency parent's when it inherits keys.
    const apiKeyData = await resolveApiKey(supabase, organizationId, 'openrouter');
    if (!apiKeyData) {
      return new Response(JSON.stringify({ error: 'OpenRouter API key not configured. Add one in Settings → API Keys to generate names with AI.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    const { count, niche, generate_avatars, avatar_only, display_name: avatarDisplayName, existing_usernames } = await req.json();

    // Avatar-only mode: skip name generation, just generate an avatar for an existing name
    if (avatar_only && avatarDisplayName) {
      const openRouterApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey!);

      console.log(`[generate-mailbox-names] avatar_only mode for: "${avatarDisplayName}"`);

      // Ask LLM to infer gender and ethnicity from the name
      const inferResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openRouterApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEFAULT_FAST_TEXT_MODEL,
          messages: [{ role: 'user', content: `What is the gender and ethnicity of someone named "${avatarDisplayName}"?\nRespond with EXACTLY two words separated by a comma: gender, ethnicity\nExample: female, French\nExample: male, Indian\nGender MUST be "male" or "female". Ethnicity should be a visual descriptor.` }],
          temperature: 0.1,
          max_tokens: 20,
        }),
      });

      let gender = inferGenderFromName(avatarDisplayName);
      let ethnicity = '';
      if (inferResponse.ok) {
        const inferData = await inferResponse.json();
        const inferText = inferData.choices?.[0]?.message?.content?.trim() ?? '';
        console.log(`[generate-mailbox-names] LLM inference raw response: "${inferText}"`);
        const llmGender = parseInferredGender(inferText);
        if (gender === 'unspecified' && llmGender !== 'unspecified') gender = llmGender;
        // Extract ethnicity from comma-separated parts
        const parts = inferText.split(',').map((p: string) => p.trim());
        if (parts.length >= 2) {
          ethnicity = parts.slice(1).join(', ').replace(/^[\s.]+|[\s.]+$/g, '');
        }
      } else {
        const errText = await inferResponse.text();
        console.error(`[generate-mailbox-names] LLM inference FAILED (${inferResponse.status}): ${errText}`);
      }

      console.log(`[generate-mailbox-names] Inferred: gender="${gender}", ethnicity="${ethnicity}" for "${avatarDisplayName}"`);

      const avatarPrompt = buildMailboxAvatarPrompt({
        displayName: avatarDisplayName,
        gender,
        ethnicity,
      });

      const imageProvider = new OpenRouterImageProvider(openRouterApiKey, { referer: supabaseUrl });
      const username = avatarDisplayName.toLowerCase().replace(/\s+/g, '.');
      try {
        const publicUrl = await imageProvider.generateAndUpload(supabase, avatarPrompt, DEFAULT_IMAGE_MODEL, {
          aspectRatio: '1:1',
          fileName: `mailbox/${username}-${Date.now()}.jpg`,
          bucket: 'avatars',
        });
        return new Response(JSON.stringify({ success: true, avatars: { [username]: publicUrl } }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: true, avatars: {}, avatarErrors: [{ username, error: err instanceof Error ? err.message : String(err) }] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (!count || count < 1 || count > 100) {
      return new Response(JSON.stringify({ error: 'count must be between 1 and 100' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const openRouterApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey!);

    const nicheContext = niche?.trim()
      ? `The company/niche is: "${niche}". Generate names that feel like real employees at this type of company.`
      : 'Generate common Western professional first and last names.';

    const existingList = Array.isArray(existing_usernames) && existing_usernames.length > 0
      ? `\n\nIMPORTANT — These usernames already exist. Do NOT generate any of these names again:\n${existing_usernames.join(', ')}`
      : '';

    const prompt = `Generate exactly ${count} realistic, varied professional names for cold email senders.
${nicheContext}

Critical rules:
- NO generic placeholder names like John Smith, Jane Doe, John Doe, James Brown etc.
- Mix nationalities: include American, British, European (French, German, Italian, Scandinavian), Hispanic, South Asian, East Asian, Middle Eastern, and other names naturally — not every name is Anglo-Saxon
- Vary first name styles: some common (Michael, Laura), some less common but real (Elise, Matteo, Soren, Camille, Rhys, Ingrid, Tariq)
- Last names should be equally varied and real-sounding
- The full list should feel like a real company's employee directory, not a fake name generator
- Username format: firstname.lastname (all lowercase, no special characters)
- Display Name format: Firstname Lastname (title case)
- Gender must match the name (e.g. "Camille Dubois" → female, "Matteo Ricci" → male)
- Ethnicity must match the name's cultural origin (e.g. "Tariq Hassan" → Middle Eastern, "Ingrid Larsen" → Scandinavian, "Priya Sharma" → South Asian)
- No duplicates
- Output ONLY one entry per line in this exact format: username, Display Name, gender, ethnicity
  - gender: male or female
  - ethnicity: a short descriptor (e.g. South Asian, East Asian, Middle Eastern, Black, White, Hispanic/Latino, Scandinavian, etc.)
- No header, no numbering, no explanation, nothing else${existingList}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_FAST_TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 1.0,
        // ~80 tokens per name, plus headroom: DEFAULT_FAST_TEXT_MODEL reasons
        // before answering and that pass is billed against the same budget.
        max_tokens: Math.min(16000, 4000 + count * 80),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: `AI call failed: ${err}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) {
      const finishReason = data.choices?.[0]?.finish_reason;
      console.error(`[generate-mailbox-names] Empty AI response (finish_reason=${finishReason}) for count=${count}`);
      return new Response(JSON.stringify({ error: `The AI returned no names (finish_reason: ${finishReason ?? 'unknown'}). Try again or lower the count.` }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!generate_avatars) {
      return new Response(JSON.stringify({ success: true, text }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse name list into { username, display_name, gender, ethnicity }[]
    const names: Array<{ username: string; display_name: string; gender: string; ethnicity: string }> = text
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((line: string) => {
        const parts = line.split(',').map((p: string) => p.trim());
        if (parts.length >= 4) {
          // Robust gender extraction from LLM output
          const rawGender = parts[2].toLowerCase().trim();
          const parsedGender = rawGender.includes('female') ? 'female' : rawGender.includes('male') ? 'male' : rawGender;
          return {
            username: parts[0].toLowerCase(),
            display_name: parts[1],
            gender: parsedGender,
            ethnicity: parts.slice(3).join(', ').trim(),
          };
        }
        if (parts.length >= 2) {
          return { username: parts[0].toLowerCase(), display_name: parts[1], gender: '', ethnicity: '' };
        }
        return { username: line.toLowerCase(), display_name: line, gender: '', ethnicity: '' };
      })
      .filter((n: { username: string }) => n.username.length > 0);

    // Generate avatars in parallel, batches of 5
    const avatars: Record<string, string> = {};
    const avatarErrors: Array<{ username: string; error: string; debug?: string }> = [];

    const imageProvider = new OpenRouterImageProvider(openRouterApiKey, { referer: supabaseUrl });

    const generateAvatar = async (entry: { username: string; display_name: string; gender: string; ethnicity: string }) => {
      try {
        // Robust gender extraction — look for "female"/"male" keywords
        const effectiveGender = parseInferredGender(entry.gender);
        const avatarPrompt = buildMailboxAvatarPrompt({
          displayName: entry.display_name,
          gender: effectiveGender !== 'unspecified' ? effectiveGender : inferGenderFromName(entry.display_name),
          ethnicity: entry.ethnicity,
        });
        console.log(`[generate-mailbox-names] Avatar for ${entry.display_name}: gender=${effectiveGender}, ethnicity=${entry.ethnicity}, prompt="${avatarPrompt.substring(0, 100)}..."`);
        const publicUrl = await imageProvider.generateAndUpload(supabase, avatarPrompt, DEFAULT_IMAGE_MODEL, {
          aspectRatio: '1:1',
          fileName: `mailbox/${entry.username}-${Date.now()}.jpg`,
          bucket: 'avatars',
        });
        avatars[entry.username] = publicUrl;
        console.log(`[generate-mailbox-names] Avatar generated for ${entry.username}: ${publicUrl}`);
      } catch (err) {
        avatarErrors.push({ username: entry.username, error: err instanceof Error ? err.message : String(err) });
      }
    };

    // Process in batches of 5
    const batchSize = 5;
    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize);
      await Promise.all(batch.map(generateAvatar));
    }

    return new Response(JSON.stringify({ success: true, text, avatars, avatarErrors: avatarErrors.length > 0 ? avatarErrors : undefined }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
