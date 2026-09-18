import * as fs from "node:fs";
import * as path from "node:path";
import { getSkillsDir, discoverWorkspaces, listDefaultSkills } from "./scanner.js";
import { safeResolve, safeSegment } from "./pathsafe.js";

/** Summary of a skill for AI-driven group classification */
export interface SkillGroupSummary {
  name: string;
  currentGroup: string | null;
  description: string;
  /** First 500 chars of body (after frontmatter) for context */
  bodyPreview: string;
}

/** Result of group_list */
export interface GroupListResult {
  workspace: string;
  skills: SkillGroupSummary[];
  /** Skills that already have a group */
  groupedCount: number;
  /** Skills missing a group */
  ungroupedCount: number;
}

/** Result of group_set */
export interface GroupSetResult {
  workspace: string;
  results: { name: string; group: string; success: boolean; error?: string }[];
}

/**
 * List all skills in a workspace with enough metadata for AI to suggest groups.
 * If workspace not specified, defaults to "default".
 */
export function listGroups(workspace?: string): GroupListResult {
  const ws = safeSegment(workspace || "default", "workspace");
  const skillsDir = getSkillsDir(ws);
  const skills: SkillGroupSummary[] = [];
  let groupedCount = 0;
  let ungroupedCount = 0;
  const dsSkills = listDefaultSkills();

  if (!fs.existsSync(skillsDir)) {
    return { workspace: ws, skills: [], groupedCount: 0, ungroupedCount: 0 };
  }

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".sync-backup") continue;
    if (dsSkills.has(entry.name)) continue;

    const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;

    let parsed: SkillGroupSummary = {
      name: entry.name,
      currentGroup: null,
      description: "",
      bodyPreview: "",
    };

    try {
      const content = fs.readFileSync(skillMd, "utf-8");
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);

      if (frontmatterMatch) {
        const fm = frontmatterMatch[1];

        // Extract group
        const groupMatch = fm.match(/^group:\s*(.+)$/m);
        parsed.currentGroup = groupMatch ? groupMatch[1].trim() : null;

        // Extract description (handle multi-line)
        const descMatch = fm.match(/^description:\s*"([^"]*)"$/m);
        if (descMatch) {
          parsed.description = descMatch[1].trim();
        } else {
          const descMatch2 = fm.match(/^description:\s*(.+)$/m);
          if (descMatch2) parsed.description = descMatch2[1].trim();
        }

        // Extract body preview (after frontmatter)
        const bodyStart = frontmatterMatch.index! + frontmatterMatch[0].length;
        parsed.bodyPreview = content.slice(bodyStart).replace(/\n{3,}/g, "\n\n").trim().slice(0, 500);
      }
    } catch {
      // skip unreadable files
    }

    if (parsed.currentGroup) {
      groupedCount++;
    } else {
      ungroupedCount++;
    }

    skills.push(parsed);
  }

  // Sort: ungrouped first, then alphabetical
  skills.sort((a, b) => {
    if (!a.currentGroup && b.currentGroup) return -1;
    if (a.currentGroup && !b.currentGroup) return 1;
    return a.name.localeCompare(b.name);
  });

  return { workspace: ws, skills, groupedCount, ungroupedCount };
}

/**
 * Write group fields into SKILL.md frontmatter for multiple skills.
 * groups: { "skill-name": "Group Name", ... }
 */
export function setGroups(workspace: string, groups: Record<string, string>): GroupSetResult {
  const wsSafe = safeSegment(workspace, "workspace");
  const skillsDir = getSkillsDir(wsSafe);
  const results: GroupSetResult["results"] = [];
  const dsSkills = listDefaultSkills();

  if (!fs.existsSync(skillsDir)) {
    return { workspace, results: [{ name: "*", group: "", success: false, error: `Skills dir not found: ${workspace}` }] };
  }

  for (const [skillName, groupValue] of Object.entries(groups)) {
    let skillNameSafe: string;
    try {
      skillNameSafe = safeSegment(skillName, "skill");
    } catch (e: any) {
      results.push({ name: skillName, group: groupValue, success: false, error: e.message });
      continue;
    }
    if (dsSkills.has(skillName)) {
      results.push({ name: skillName, group: groupValue, success: false, error: `Refused: "${skillName}" is a default-skill managed by workspace-watcher. Do not set group manually.` });
      continue;
    }
    const skillMd = safeResolve(skillsDir, path.join(skillNameSafe, "SKILL.md"), "SKILL.md path");

    if (!fs.existsSync(skillMd)) {
      results.push({ name: skillName, group: groupValue, success: false, error: "SKILL.md not found" });
      continue;
    }

    try {
      let content = fs.readFileSync(skillMd, "utf-8");

      // Check if group already exists
      if (content.match(/^group:\s*.+$/m)) {
        // Replace existing group
        content = content.replace(/^group:\s*.+$/m, `group: ${groupValue}`);
      } else {
        // Insert group after description line
        const fmEnd = content.indexOf("\n---");
        if (fmEnd === -1) {
          results.push({ name: skillName, group: groupValue, success: false, error: "No frontmatter found" });
          continue;
        }

        const fm = content.slice(0, fmEnd);
        // Find the line after description to insert group
        const descLineMatch = fm.match(/^description:.*$/m);
        if (descLineMatch) {
          const descEndIndex = fm.indexOf(descLineMatch[0]) + descLineMatch[0].length;
          const before = content.slice(0, descEndIndex);
          const after = content.slice(descEndIndex);
          content = before + "\ngroup: " + groupValue + after;
        } else {
          // No description line, insert after name line
          const nameMatch = fm.match(/^name:.*$/m);
          if (nameMatch) {
            const nameEndIndex = fm.indexOf(nameMatch[0]) + nameMatch[0].length;
            const before = content.slice(0, nameEndIndex);
            const after = content.slice(nameEndIndex);
            content = before + "\ngroup: " + groupValue + after;
          } else {
            results.push({ name: skillName, group: groupValue, success: false, error: "No name or description line found" });
            continue;
          }
        }
      }

      fs.writeFileSync(skillMd, content, "utf-8");
      results.push({ name: skillName, group: groupValue, success: true });
    } catch (e: any) {
      results.push({ name: skillName, group: groupValue, success: false, error: e.message });
    }
  }

  return { workspace, results };
}
