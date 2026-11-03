import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export interface TrimRange {
  start: number;
  end: number;
}

export interface CutRange {
  start: number;
  end: number;
}

interface UseVideoTrimOptions {
  onProgress?: (progress: number) => void;
  onComplete?: (url: string) => void;
  onError?: (error: string) => void;
}

export function useVideoTrim(options: UseVideoTrimOptions = {}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const loadedRef = useRef(false);

  const loadFFmpeg = useCallback(async () => {
    if (loadedRef.current && ffmpegRef.current) {
      return ffmpegRef.current;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      ffmpeg.on('progress', ({ progress: p }) => {
        const progressPercent = Math.round(p * 100);
        setProgress(progressPercent);
        options.onProgress?.(progressPercent);
      });

      ffmpeg.on('log', ({ message }) => {
        console.log('[FFmpeg]', message);
      });

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      loadedRef.current = true;
      setIsLoading(false);
      return ffmpeg;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load FFmpeg';
      setError(errorMsg);
      setIsLoading(false);
      options.onError?.(errorMsg);
      throw err;
    }
  }, [options]);

  const trimVideo = useCallback(async (
    videoUrl: string,
    trimRange: TrimRange
  ): Promise<string> => {
    setIsProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const ffmpeg = await loadFFmpeg();
      if (!ffmpeg) throw new Error('FFmpeg not loaded');

      const inputFileName = 'input.mp4';
      const outputFileName = 'output.mp4';

      // Fetch and write input file
      const videoData = await fetchFile(videoUrl);
      await ffmpeg.writeFile(inputFileName, videoData);

      const duration = trimRange.end - trimRange.start;

      // Trim video using ffmpeg
      await ffmpeg.exec([
        '-i', inputFileName,
        '-ss', trimRange.start.toFixed(3),
        '-t', duration.toFixed(3),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        outputFileName
      ]);

      // Read output file
      const data = await ffmpeg.readFile(outputFileName);
      const blob = new Blob([data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      // Cleanup
      await ffmpeg.deleteFile(inputFileName);
      await ffmpeg.deleteFile(outputFileName);

      setIsProcessing(false);
      setProgress(100);
      options.onComplete?.(url);
      return url;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to trim video';
      setError(errorMsg);
      setIsProcessing(false);
      options.onError?.(errorMsg);
      throw err;
    }
  }, [loadFFmpeg, options]);

  const cutVideo = useCallback(async (
    videoUrl: string,
    cutRange: CutRange,
    totalDuration: number
  ): Promise<string> => {
    setIsProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const ffmpeg = await loadFFmpeg();
      if (!ffmpeg) throw new Error('FFmpeg not loaded');

      const inputFileName = 'input.mp4';
      const part1FileName = 'part1.mp4';
      const part2FileName = 'part2.mp4';
      const concatFileName = 'concat.txt';
      const outputFileName = 'output.mp4';

      // Fetch and write input file
      const videoData = await fetchFile(videoUrl);
      await ffmpeg.writeFile(inputFileName, videoData);

      const hasPart1 = cutRange.start > 0.1;
      const hasPart2 = cutRange.end < totalDuration - 0.1;

      if (!hasPart1 && !hasPart2) {
        throw new Error('Cannot cut entire video');
      }

      const filesToConcat: string[] = [];

      // Extract part before the cut
      if (hasPart1) {
        await ffmpeg.exec([
          '-i', inputFileName,
          '-ss', '0',
          '-t', cutRange.start.toFixed(3),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          part1FileName
        ]);
        filesToConcat.push(part1FileName);
      }

      // Extract part after the cut
      if (hasPart2) {
        await ffmpeg.exec([
          '-i', inputFileName,
          '-ss', cutRange.end.toFixed(3),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          part2FileName
        ]);
        filesToConcat.push(part2FileName);
      }

      // If only one part, just rename it
      if (filesToConcat.length === 1) {
        const data = await ffmpeg.readFile(filesToConcat[0]);
        const blob = new Blob([data], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);

        // Cleanup
        await ffmpeg.deleteFile(inputFileName);
        if (hasPart1) await ffmpeg.deleteFile(part1FileName);
        if (hasPart2) await ffmpeg.deleteFile(part2FileName);

        setIsProcessing(false);
        setProgress(100);
        options.onComplete?.(url);
        return url;
      }

      // Create concat file
      const concatContent = filesToConcat.map(f => `file '${f}'`).join('\n');
      await ffmpeg.writeFile(concatFileName, concatContent);

      // Concatenate parts
      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFileName,
        '-c', 'copy',
        outputFileName
      ]);

      // Read output file
      const data = await ffmpeg.readFile(outputFileName);
      const blob = new Blob([data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      // Cleanup
      await ffmpeg.deleteFile(inputFileName);
      if (hasPart1) await ffmpeg.deleteFile(part1FileName);
      if (hasPart2) await ffmpeg.deleteFile(part2FileName);
      await ffmpeg.deleteFile(concatFileName);
      await ffmpeg.deleteFile(outputFileName);

      setIsProcessing(false);
      setProgress(100);
      options.onComplete?.(url);
      return url;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to cut video';
      setError(errorMsg);
      setIsProcessing(false);
      options.onError?.(errorMsg);
      throw err;
    }
  }, [loadFFmpeg, options]);

  const preloadFFmpeg = useCallback(async () => {
    try {
      await loadFFmpeg();
    } catch {
      // Silently fail on preload
    }
  }, [loadFFmpeg]);

  return {
    trimVideo,
    cutVideo,
    preloadFFmpeg,
    isLoading,
    isProcessing,
    progress,
    error,
    isReady: loadedRef.current,
  };
}
