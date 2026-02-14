import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../logging.js";

// extensions/workflow-monitor/reference-tool.ts is 2 levels below package root
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const TOPIC_MAP: Record<string, string> = {
  "tdd-rationalizations": "skills/test-driven-development/reference/rationalizations.md",
  "tdd-examples": "skills/test-driven-development/reference/examples.md",
  "tdd-when-stuck": "skills/test-driven-development/reference/when-stuck.md",
  "tdd-anti-patterns": "skills/test-driven-development/testing-anti-patterns.md",
  "debug-rationalizations": "skills/systematic-debugging/reference/rationalizations.md",
  "debug-tracing": "skills/systematic-debugging/root-cause-tracing.md",
  "debug-defense-in-depth": "skills/systematic-debugging/defense-in-depth.md",
  "debug-condition-waiting": "skills/systematic-debugging/condition-based-waiting.md",
};

export const REFERENCE_TOPICS = Object.keys(TOPIC_MAP);

export async function loadReference(topic: string): Promise<string> {
  const relativePath = TOPIC_MAP[topic];
  if (!relativePath) {
    return `Unknown topic: "${topic}". Available topics: ${REFERENCE_TOPICS.join(", ")}`;
  }

  const fullPath = resolve(PACKAGE_ROOT, relativePath);

  try {
    return await readFile(fullPath, "utf-8");
  } catch (err) {
    log.warn(`Failed to load reference "${topic}" from ${fullPath}: ${err instanceof Error ? err.message : err}`);
    return `Error loading reference "${topic}": file not found at ${fullPath}`;
  }
}
