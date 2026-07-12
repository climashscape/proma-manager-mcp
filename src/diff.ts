import * as fs from "node:fs";
import * as path from "node:path";
import { getSkillsDir, listDefaultSkills } from "./scanner.js";
import { hashSkillFiles } from "./hasher.js";

/**
 * Generate a human-readable diff between mother and child skill directories.
 * Refuses to operate on default-skills managed by workspace-watcher.
 */
export function diffSkill(skill: string, workspace: string): string {
  if (listDefaultSkills().has(skill)) {
    return `ERROR: "${skill}" is a default-skill managed by workspace-watcher. Diff not applicable.`;
  }
  // Find the mother workspace by reading child's .source.json
  const childDir = path.join(getSkillsDir(workspace), skill);
  const srcFile = path.join(childDir, ".source.json");

  if (!fs.existsSync(childDir)) {
    return `ERROR: skill "${skill}" not found in workspace "${workspace}"`;
  }

  let motherSlug: string | null = null;
  if (fs.existsSync(srcFile)) {
    try {
      const sj = JSON.parse(fs.readFileSync(srcFile, "utf-8"));
      motherSlug = sj.sourceWorkspaceSlug || null;
    } catch {
      return "ERROR: failed to parse .source.json";
    }
  }

  if (!motherSlug) {
    return "ERROR: no sourceWorkspaceSlug in .source.json — run bootstrap first";
  }

  const motherDir = path.join(getSkillsDir(motherSlug), skill);
  if (!fs.existsSync(motherDir)) {
    return `ERROR: mother skill "${skill}" not found in workspace "${motherSlug}"`;
  }

  const motherFiles = hashSkillFiles(motherDir);
  const childFiles = hashSkillFiles(childDir);

  const allPaths = new Set([...Object.keys(motherFiles), ...Object.keys(childFiles)]);
  const sorted = [...allPaths].sort();

  const lines: string[] = [];
  lines.push(`diff --skill ${skill}: ${motherSlug} → ${workspace}`);
  lines.push(`--- ${motherDir}`);
  lines.push(`+++ ${childDir}`);

  for (const fp of sorted) {
    const mh = motherFiles[fp];
    const ch = childFiles[fp];
    if (mh && ch && mh === ch) continue; // identical
    if (mh && !ch) {
      lines.push(`  - ${fp}  (only in mother)`);
    } else if (!mh && ch) {
      lines.push(`  + ${fp}  (only in child)`);
    } else {
      lines.push(`  M ${fp}  (modified)`);
      // Read and show line-level diff
      const mContent = fs.readFileSync(path.join(motherDir, fp), "utf-8");
      const cContent = fs.readFileSync(path.join(childDir, fp), "utf-8");
      if (mContent !== cContent) {
        lines.push(...simpleTextDiff(mContent, cContent, `mother/${fp}`, `child/${fp}`));
      }
    }
  }

  return lines.join("\n");
}

function simpleTextDiff(a: string, b: string, labelA: string, labelB: string): string[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const maxLen = Math.max(aLines.length, bLines.length);
  const out: string[] = [];

  // Simple line-by-line comparison
  let i = 0, j = 0;
  while (i < maxLen || j < maxLen) {
    const al = i < aLines.length ? aLines[i] : undefined;
    const bl = j < bLines.length ? bLines[j] : undefined;
    if (al === bl) {
      i++; j++;
      continue;
    }
    // Find where they re-sync
    let syncFound = false;
    for (let k = 1; k < 5 && i + k <= aLines.length; k++) {
      if (aLines[i + k - 1] === bl) {
        // Mother has extra lines
        for (let x = 0; x < k; x++) {
          out.push(`< ${aLines[i + x]}`);
        }
        i += k;
        syncFound = true;
        break;
      }
    }
    if (syncFound) continue;

    for (let k = 1; k < 5 && j + k <= bLines.length; k++) {
      if (bLines[j + k - 1] === al) {
        // Child has extra lines
        for (let x = 0; x < k; x++) {
          out.push(`> ${bLines[j + x]}`);
        }
        j += k;
        syncFound = true;
        break;
      }
    }
    if (syncFound) continue;

    // Plain mismatch
    if (al !== undefined) out.push(`< ${al}`);
    if (bl !== undefined) out.push(`> ${bl}`);
    i++; j++;
  }

  return out;
}
