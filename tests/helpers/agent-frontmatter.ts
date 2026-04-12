import * as fs from "node:fs";
import * as path from "node:path";

export type AgentFrontmatter = Record<string, string>;

export function loadAgentFrontmatter(relativePath: string): AgentFrontmatter {
  const filePath = path.join(process.cwd(), relativePath);
  const contents = fs.readFileSync(filePath, "utf-8");
  const match = contents.match(/^---\n([\s\S]*?)\n---/);

  if (!match) {
    throw new Error(`Missing frontmatter in ${relativePath}`);
  }

  const frontmatter: AgentFrontmatter = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    frontmatter[key] = value;
  }

  return frontmatter;
}
