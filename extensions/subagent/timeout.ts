export const DEFAULT_SUBAGENT_TIMEOUT_MS = 1_200_000; // 20 minutes

export function getSubagentTimeoutMs(agentTimeout?: number): number {
  if (agentTimeout !== undefined && agentTimeout > 0) return agentTimeout;

  const envVal = process.env.PI_SUBAGENT_TIMEOUT_MS;
  if (envVal) {
    const parsed = Number.parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return DEFAULT_SUBAGENT_TIMEOUT_MS;
}
