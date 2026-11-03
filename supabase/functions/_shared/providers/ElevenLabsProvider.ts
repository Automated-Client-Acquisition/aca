/**
 * ElevenLabs Provider
 *
 * Handles text-to-speech generation via ElevenLabs API.
 * Synchronous - returns audio data directly.
 */

import { BaseProvider, ProviderFactory, retryWithBackoff } from './BaseProvider.ts';
import type { ProviderRequest, ProviderResponse } from '../execution/types.ts';

// Default voice IDs
export const ELEVENLABS_VOICES = {
  RACHEL: '21m00Tcm4TlvDq8ikWAM',
  ADAM: 'pNInz6obpgDQGcFmaJgB',
  ANTONI: 'ErXwobaYiN019PkySvjV',
  BELLA: 'EXAVITQu4vr4xnSDxMaL',
  DOMI: 'AZnzlk1XvdvUeBnXmlld',
  ELLI: 'MF3mGyEYCl7XYWbV9V6O',
  JOSH: 'TxGEqnHWrfWFTfGW9XjX',
  SAM: 'yoZ06aMxZJJ28mfd3POQ',
} as const;

// Available models
export const ELEVENLABS_MODELS = {
  MULTILINGUAL_V2: 'eleven_multilingual_v2',
  TURBO_V2: 'eleven_turbo_v2',
  TURBO_V2_5: 'eleven_turbo_v2_5',
  MONOLINGUAL_V1: 'eleven_monolingual_v1',
} as const;

interface ElevenLabsVoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export class ElevenLabsProvider extends BaseProvider {
  constructor(
    apiKey: string,
    options?: {
      baseUrl?: string;
    }
  ) {
    super(apiKey, {
      baseUrl: options?.baseUrl || 'https://api.elevenlabs.io/v1',
    });
  }

  getProviderName(): string {
    return 'ElevenLabs';
  }

  isAsync(): boolean {
    return false; // ElevenLabs TTS is synchronous
  }

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    this.validateRequest(request, ['prompt']); // prompt = text to speak
    this.logRequest(request);

    return retryWithBackoff(
      async () => {
        const voiceId = request.config.voiceId || ELEVENLABS_VOICES.RACHEL;
        const modelId = request.model || ELEVENLABS_MODELS.MULTILINGUAL_V2;

        // Build request body
        const requestBody: Record<string, any> = {
          text: request.prompt,
          model_id: modelId,
        };

        // Add voice settings if provided
        const voiceSettings: ElevenLabsVoiceSettings = {};
        if (request.config.stability !== undefined) {
          voiceSettings.stability = request.config.stability;
        }
        if (request.config.similarityBoost !== undefined) {
          voiceSettings.similarity_boost = request.config.similarityBoost;
        }
        if (request.config.style !== undefined) {
          voiceSettings.style = request.config.style;
        }
        if (request.config.useSpeakerBoost !== undefined) {
          voiceSettings.use_speaker_boost = request.config.useSpeakerBoost;
        }

        if (Object.keys(voiceSettings).length > 0) {
          requestBody.voice_settings = voiceSettings;
        }

        console.log(
          `[ElevenLabs] Generating TTS: voice=${voiceId}, model=${modelId}, textLength=${request.prompt.length}`
        );

        const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`ElevenLabs API error ${response.status}: ${errorBody}`);
        }

        // Get audio data as ArrayBuffer
        const audioData = await response.arrayBuffer();

        // Estimate cost based on character count
        // ElevenLabs charges per character
        const cost = this.calculateCost(request.prompt.length);

        const providerResponse: ProviderResponse = {
          content: audioData,
          model: modelId,
          cost,
          status: 'completed',
        };

        this.logResponse({
          ...providerResponse,
          content: `[AudioData: ${audioData.byteLength} bytes]`,
        });

        return providerResponse;
      },
      { maxRetries: 3, operationName: 'ElevenLabs TTS' }
    );
  }

  /**
   * Get available voices for the account.
   */
  async getVoices(): Promise<
    Array<{
      voice_id: string;
      name: string;
      category: string;
      description?: string;
    }>
  > {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`ElevenLabs voices API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    return data.voices || [];
  }

  /**
   * Get available models.
   */
  async getModels(): Promise<
    Array<{
      model_id: string;
      name: string;
      can_be_finetuned: boolean;
      languages: Array<{ language_id: string; name: string }>;
    }>
  > {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`ElevenLabs models API error ${response.status}: ${errorBody}`);
    }

    return response.json();
  }

  /**
   * Calculate cost based on character count.
   * ElevenLabs pricing: ~$0.30 per 1000 characters (varies by plan)
   */
  private calculateCost(characterCount: number): number {
    const costPer1000Chars = 0.30; // Approximate
    return (characterCount / 1000) * costPer1000Chars;
  }

  /**
   * Convert audio ArrayBuffer to base64 data URL.
   */
  static arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType = 'audio/mpeg'): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${mimeType};base64,${base64}`;
  }

  /**
   * Helper to upload audio to Supabase storage.
   */
  static async uploadToStorage(
    supabase: any,
    audioData: ArrayBuffer,
    fileName: string,
    bucket = 'content-media'
  ): Promise<string> {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, audioData, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload audio: ${error.message}`);
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(fileName);

    return publicUrl;
  }
}

// Register with factory
ProviderFactory.register('elevenlabs', ElevenLabsProvider);

export default ElevenLabsProvider;
