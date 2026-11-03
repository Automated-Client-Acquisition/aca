import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  listAvatars,
  listVoices,
  listTemplates,
  getTemplateDetails,
  createPhotoAvatarGroup,
  uploadAsset,
  getAvatarTrainingStatus,
  parseHeyGenError,
} from "../_shared/heygen-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decrypt API key using AES-256-GCM (same algorithm as validate-api-key encryption)
async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);

  const keyBytes = new Uint8Array(
    encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, cryptoKey, ciphertextWithTag
  );
  return new TextDecoder().decode(decrypted);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth context
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) throw new Error('Unauthorized');

    // Parse request body first to get organizationId
    const body = await req.json();
    const { action, organizationId, ...params } = body;

    if (!organizationId) throw new Error('organizationId is required');

    // Verify user belongs to the requested organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!membership) throw new Error('Access denied: you are not a member of this organization');
    const orgId = organizationId;

    // Get HeyGen API key
    const { data: apiKeyRecord } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'heygen')
      .eq('is_valid', true)
      .single();

    if (!apiKeyRecord) {
      throw new Error('HeyGen API key not configured. Add it in Settings → Integrations.');
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) throw new Error('ENCRYPTION_KEY not configured');

    let apiKey: string;
    try {
      apiKey = await decryptApiKey(apiKeyRecord.key_encrypted, encryptionKey);
    } catch (decryptError) {
      console.error('Failed to decrypt HeyGen API key:', decryptError);
      throw new Error('Failed to decrypt API key. The key may need to be re-added in Settings.');
    }

    console.log(`HeyGen manage avatar action: ${action}, org: ${orgId}`);

    let result: any;

    switch (action) {
      case 'list-avatars': {
        const avatars = await listAvatars(apiKey);
        result = { avatars };
        break;
      }

      case 'list-voices': {
        const voices = await listVoices(apiKey);
        result = { voices };
        break;
      }

      case 'list-templates': {
        const templates = await listTemplates(apiKey);
        result = { templates };
        break;
      }

      case 'get-template': {
        const { templateId } = params;
        if (!templateId) throw new Error('templateId is required');
        const template = await getTemplateDetails(apiKey, templateId);
        result = { template };
        break;
      }

      case 'create-avatar': {
        const { characterId } = params;
        if (!characterId) throw new Error('characterId is required');

        // Fetch character to get reference image
        const { data: character, error: charError } = await supabase
          .from('library_characters')
          .select('id, name, reference_images, heygen_avatar_group_id, heygen_avatar_status')
          .eq('id', characterId)
          .eq('organization_id', orgId)
          .single();

        if (charError || !character) throw new Error('Character not found');

        if (character.heygen_avatar_status === 'training') {
          throw new Error('Avatar is already being trained');
        }

        const referenceImages = character.reference_images || [];
        if (referenceImages.length === 0) {
          throw new Error('Character has no reference images. Upload an image first.');
        }

        // Upload first reference image to HeyGen
        const imageKey = await uploadAsset(apiKey, referenceImages[0]);

        // Create photo avatar group
        const avatarGroup = await createPhotoAvatarGroup(apiKey, character.name, imageKey);

        // Update character with training info
        await supabase
          .from('library_characters')
          .update({
            heygen_avatar_group_id: avatarGroup.group_id,
            heygen_avatar_status: 'training',
          })
          .eq('id', characterId);

        result = { groupId: avatarGroup.group_id, status: 'training' };
        break;
      }

      case 'check-training': {
        const { characterId: charId } = params;
        if (!charId) throw new Error('characterId is required');

        const { data: char } = await supabase
          .from('library_characters')
          .select('heygen_avatar_group_id, heygen_avatar_status')
          .eq('id', charId)
          .eq('organization_id', orgId)
          .single();

        if (!char?.heygen_avatar_group_id) {
          throw new Error('No avatar training in progress');
        }

        const training = await getAvatarTrainingStatus(apiKey, char.heygen_avatar_group_id);

        // Update character if training completed
        if (training.status === 'completed' && char.heygen_avatar_status !== 'ready') {
          await supabase
            .from('library_characters')
            .update({
              heygen_avatar_status: 'ready',
              heygen_avatar_id: char.heygen_avatar_group_id, // group_id becomes the avatar_id
            })
            .eq('id', charId);
          result = { status: 'ready', avatarId: char.heygen_avatar_group_id };
        } else if (training.status === 'failed') {
          await supabase
            .from('library_characters')
            .update({ heygen_avatar_status: 'failed' })
            .eq('id', charId);
          result = { status: 'failed' };
        } else {
          result = { status: 'training', progress: training.progress };
        }
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('HeyGen manage avatar error:', errorMessage);
    const parsed = parseHeyGenError(error);
    return new Response(
      JSON.stringify({ error: parsed.message, code: parsed.code, detail: errorMessage }),
      {
        status: parsed.code === 'AUTHENTICATION_FAILED' ? 401 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
