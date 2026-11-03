// Estimated durations for different pipeline stages (in seconds)
export const STAGE_TIMING_ESTIMATES = {
  // Text generation stages
  script: {
    min: 5,
    max: 15,
    average: 10,
    description: 'Script generation'
  },
  
  // Image generation stages
  image: {
    min: 8,
    max: 20,
    average: 12,
    description: 'Image generation'
  },
  
  // Audio/Voice generation
  tts: {
    min: 10,
    max: 30,
    average: 20,
    description: 'Voice generation'
  },
  
  // Video generation stages
  
  world_simulator: {
    min: 90,
    max: 240,
    average: 150,
    description: 'AI video generation'
  },
  
  // Assembly/stitching
  assembly: {
    min: 15,
    max: 45,
    average: 30,
    description: 'Video assembly'
  },

  // Transcription (ElevenLabs STT)
  transcribe: {
    min: 10,
    max: 60,
    average: 20,
    description: 'Speech transcription'
  },

  // Text rewrite (LLM call)
  rewrite: {
    min: 5,
    max: 20,
    average: 10,
    description: 'Script rewrite'
  }
} as const;

export type StageType = keyof typeof STAGE_TIMING_ESTIMATES;

/**
 * Calculate estimated completion time for a pipeline stage
 */
export function estimateStageTime(stageType: StageType, itemCount: number = 1): {
  min: number;
  max: number;
  average: number;
  formatted: string;
} {
  const timing = STAGE_TIMING_ESTIMATES[stageType];
  
  const min = timing.min * itemCount;
  const max = timing.max * itemCount;
  const average = timing.average * itemCount;
  
  return {
    min,
    max,
    average,
    formatted: formatDuration(average)
  };
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  
  if (minutes < 60) {
    return remainingSeconds > 0 
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

/**
 * Calculate total pipeline time estimate
 */
export function estimateTotalPipelineTime(
  stages: Array<{ type: StageType }>,
  itemCount: number = 1
): {
  min: number;
  max: number;
  average: number;
  formatted: string;
  breakdown: Array<{ stage: string; time: string }>;
} {
  let totalMin = 0;
  let totalMax = 0;
  let totalAverage = 0;
  const breakdown: Array<{ stage: string; time: string }> = [];
  
  stages.forEach(stage => {
    const estimate = estimateStageTime(stage.type, itemCount);
    totalMin += estimate.min;
    totalMax += estimate.max;
    totalAverage += estimate.average;
    
    breakdown.push({
      stage: STAGE_TIMING_ESTIMATES[stage.type].description,
      time: estimate.formatted
    });
  });
  
  return {
    min: totalMin,
    max: totalMax,
    average: totalAverage,
    formatted: formatDuration(totalAverage),
    breakdown
  };
}
