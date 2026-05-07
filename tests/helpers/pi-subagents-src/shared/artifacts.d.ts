import type { ArtifactPaths } from "./types";

export function getArtifactPaths(artifactsDir: string, runId: string, agent: string, index?: number): ArtifactPaths;
export function ensureArtifactsDir(dir: string): void;
export function writeArtifact(filePath: string, content: string): void;
export function writeMetadata(filePath: string, metadata: object): void;
