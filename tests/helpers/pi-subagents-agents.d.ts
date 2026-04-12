declare module "pi-subagents/agents.ts" {
  export type AgentSource = "builtin" | "user" | "project";
  export type AgentScope = "user" | "project" | "both";

  export interface AgentConfig {
    name: string;
    description: string;
    source: AgentSource;
    filePath?: string;
  }

  export interface AgentDiscoveryResult {
    agents: AgentConfig[];
    projectAgentsDir?: string | null;
  }

  export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult;
}
