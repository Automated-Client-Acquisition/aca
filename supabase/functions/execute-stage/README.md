# Execute Stage Function

## Overview
Handles execution of individual stages in multi-stage content generation pipelines with real API integrations.

## Features

### API Integrations
- **OpenRouter**: Text/script generation with multiple LLM models
- **ElevenLabs**: Text-to-speech with voice selection
- **Replicate**: Image generation, image-to-video, world simulator (Sora/Veo style)

### Error Handling
- Exponential backoff retry logic (3 attempts)
- Detailed error logging
- Graceful failure with informative messages

### Cost Tracking
- Per-stage cost calculation
- Cumulative cost tracking across pipeline
- Provider-specific pricing models

### Storage Integration
- Automatic upload of generated audio files
- Public URL generation for media assets

## Stage Types

### text_llm
- Calls OpenRouter for text/script generation
- Supports multiple models
- Tracks token usage and cost

### tts
- Calls ElevenLabs for voice generation
- Uploads audio to Supabase storage
- Estimates duration from character count

### image_generator
- Calls Replicate for image generation
- Polls for completion (async)
- Returns public URLs

### image_to_video
- Converts images to video clips
- Supports multiple images → multiple clips
- Long-running async operations

### world_simulator
- Text-to-video generation (Sora/Veo style)
- 8-second video clips
- Highest cost operations

## Cost Calculation
- OpenRouter: $0-$5 per million tokens (model-dependent)
- ElevenLabs: $0.30 per 1000 characters
- Replicate: $0.02 (image), $0.15 (video clip), $0.25 (world simulator)

## Usage
Called automatically by `approve-stage` function when stage is approved and next stage needs execution.
