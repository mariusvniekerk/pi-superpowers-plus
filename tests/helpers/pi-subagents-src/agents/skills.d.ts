export interface ResolvedSkill {
  name: string;
  path: string;
  content: string;
  source: string;
}

export function resolveSkills(skillNames: string[], cwd: string): { resolved: ResolvedSkill[]; missing: string[] };

export function buildSkillInjection(skills: ResolvedSkill[]): string;
