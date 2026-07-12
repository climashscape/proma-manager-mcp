import * as fs from "node:fs";
import * as path from "node:path";
import { discoverWorkspaces, getSkillsDir, listDefaultSkills, buildCatalog } from "./scanner.js";
import { GroupMismatch } from "./types.js";

/**
 * Check group field consistency across workspaces.
 * Returns skills with missing or mismatched group fields.
 */
export function checkGroups(): GroupMismatch[] {
  const workspaces = discoverWorkspaces();
  const catalog = buildCatalog(workspaces);
  const mismatches: GroupMismatch[] = [];

  // Exclude default-skills
  const dsSkills = listDefaultSkills();

  for (const [skillName, wsList] of Object.entries(catalog)) {
    if (wsList.length <= 1) continue;
    if (dsSkills.has(skillName)) continue;

    const groups: Record<string, { group: string; hasSourceJson: boolean }> = {};
    const groupValues = new Set<string>();

    for (const ws of wsList) {
      const skillDir = path.join(getSkillsDir(ws), skillName);
      const skillMd = path.join(skillDir, "SKILL.md");
      const srcJson = path.join(skillDir, ".source.json");

      if (!fs.existsSync(skillMd)) continue;

      let group = "";
      try {
        const content = fs.readFileSync(skillMd, "utf-8");
        const match = content.match(/^group:\s*(.+)$/m);
        group = match ? match[1].trim() : "";
      } catch {
        group = "";
      }

      groups[ws] = {
        group,
        hasSourceJson: fs.existsSync(srcJson),
      };
      if (group) groupValues.add(group);
    }

    // Determine mother
    let motherWs: string | null = null;
    for (const [ws, info] of Object.entries(groups)) {
      if (!info.hasSourceJson) { motherWs = ws; break; }
    }
    if (!motherWs) motherWs = wsList[0];

    const motherGroup = groups[motherWs]?.group || "";

    // Classify issue
    let issue: GroupMismatch["issue"] | null = null;
    const groupsWithMissing = Object.entries(groups).filter(([, v]) => !v.group);
    const groupsWithValue = Object.entries(groups).filter(([, v]) => !!v.group);

    if (groupsWithMissing.length === Object.keys(groups).length) {
      // All missing — consistent, not an issue. Skip.
    } else if (groupsWithMissing.length > 0) {
      // Some have, some don't
      issue = "missing_in_some";
    } else if (groupValues.size > 1) {
      // Multiple different values
      issue = "mismatch";
    }

    if (issue) {
      mismatches.push({
        name: skillName,
        workspaces: groups,
        issue,
        motherGroup: motherGroup || undefined,
      });
    }
  }

  return mismatches;
}
