export interface SingleOutputSnapshot {
  exists: boolean;
  mtimeMs?: number;
  size?: number;
}

export function captureSingleOutputSnapshot(outputPath: string | undefined): SingleOutputSnapshot | undefined;

export function resolveSingleOutput(
  outputPath: string | undefined,
  fallbackOutput: string,
  beforeRun: SingleOutputSnapshot | undefined,
): { fullOutput: string; savedPath?: string; saveError?: string };
