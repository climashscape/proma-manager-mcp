import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  CheckResult, ManagedSkill, UnmanagedSkill, OrphanSkill,
  ChildStatus, SkillCatalog, SourceJson, WorkspaceConfig,
} from "./types.js";
import { hashSkillDir } from "./hasher.js";
import { checkGroups } from "./group-check.js";

export const WORKSPACES_ROOT = path.join(os.homedir(), ".proma", "agent-workspaces");
export const DEFAULT_SKILLS_DIR = path.join(os.homedir(), ".proma", "default-skills");

/**
 * Discover all workspaces at runtime by scanning the workspaces root directory.
 * Each subdirectory that contains a `skills/` dir is a workspace.
 */
export function discoverWorkspaces(): WorkspaceConfig[] {
  const result: WorkspaceConfig[] = [];
  if (!fs.existsSync(WORKSPACES_ROOT)) return result;

  for (const entry of fs.readdirSync(WORKSPACES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillsDir = path.join(WORKSPACES_ROOT, entry.name, "skills");
    if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
      result.push({
        slug: entry.name,
        skillsDir: path.join(entry.name, "skills"),
      });
    }
  }
  return result;
}

/**
 * Resolve a workspace slug to its skills directory absolute path.
 */
export function getSkillsDir(slug: string): string {
  return path.join(WORKSPACES_ROOT, slug, "skills");
}

/**
 * Scan a single workspace's .source.json for a given skill and push any bogus
 * claim into the orphans list. Used for both single-workspace and multi-workspace
 * skill detection.
 */
function collectOrphans(skillName: string, wsList: string[], orphans: OrphanSkill[]) {
  for (const ws of wsList) {
    const srcFile = path.join(getSkillsDir(ws), skillName, ".source.json");
    if (!fs.existsSync(srcFile)) continue;
    try {
      const raw = fs.readFileSync(srcFile, "utf-8");
      const sj: SourceJson = JSON.parse(raw);
      const claimedSource = sj.sourceWorkspaceSlug;
      if (!fs.existsSync(path.join(getSkillsDir(claimedSource), skillName))) {
        orphans.push({
          name: skillName,
          workspace: ws,
          claimedSource,
          issue: "source_workspace_does_not_have_this_skill",
        });
      }
    } catch {
      // Corrupt .source.json — skip silently
    }
  }
}

/**
 * Full scan: discover all skills across workspaces, classify into managed/unmanaged/orphan.
 *
 * Classification rules:
 * - Single-workspace skill (wsList.length === 1): only checked for bogus .source.json
 *   (orphan detection). These skills are NOT classified as managed/unmanaged — there's
 *   no cross-workspace relationship to trace.
 * - Multi-workspace skill (wsList.length >= 2): full classification into managed,
 *   unmanaged, or orphan. Default-skills (workspace-watcher managed) are excluded.
 */
export function check(): CheckResult {
  const workspaces = discoverWorkspaces();
  const catalog = buildCatalog(workspaces);
  const dsSkills = listDefaultSkills();

  const managed: ManagedSkill[] = [];
  const unmanaged: UnmanagedSkill[] = [];
  const orphans: OrphanSkill[] = [];

  for (const [skillName, wsList] of Object.entries(catalog)) {
    if (dsSkills.has(skillName)) continue;

    // ── Single-workspace skill ──
    // Only check for bogus .source.json. These are workspace-local skills that
    // happen to carry a dead .source.json claiming they came from somewhere else.
    if (wsList.length === 1) {
      collectOrphans(skillName, wsList, orphans);
      continue;
    }

    // ── Multi-workspace skill ──
    const hasSourceJson = new Map<string, SourceJson>();
    const noSourceJson: string[] = [];
    let motherWs: string | null = null;

    for (const ws of wsList) {
      const skillsDir = getSkillsDir(ws);
      const srcFile = path.join(skillsDir, skillName, ".source.json");
      if (fs.existsSync(srcFile)) {
        try {
          const raw = fs.readFileSync(srcFile, "utf-8");
          hasSourceJson.set(ws, JSON.parse(raw) as SourceJson);
        } catch {
          noSourceJson.push(ws);
        }
      } else {
        noSourceJson.push(ws);
      }
    }

    // Determine mother workspace: the one claimed as source by a child's .source.json
    for (const [ws, sj] of hasSourceJson) {
      if (sj.sourceWorkspaceSlug && !hasSourceJson.has(sj.sourceWorkspaceSlug)) {
        motherWs = sj.sourceWorkspaceSlug;
        break;
      }
    }

    // If no .source.json claims a mother, first workspace WITHOUT .source.json is mother
    if (!motherWs) {
      for (const ws of wsList) {
        if (!hasSourceJson.has(ws) && fs.existsSync(path.join(getSkillsDir(ws), skillName))) {
          motherWs = ws;
          break;
        }
      }
    }

    // Fallback: all bootstrapped — pick first workspace with .source.json
    if (!motherWs && hasSourceJson.size > 0) {
      motherWs = hasSourceJson.keys().next().value!;
    }

    const hashes = new Map<string, string | null>();
    for (const ws of wsList) {
      hashes.set(ws, hashSkillDir(path.join(getSkillsDir(ws), skillName)));
    }

    // Detect orphans: .source.json points to a workspace that doesn't have this skill
    collectOrphans(skillName, wsList, orphans);

    // Detect unmanaged children (cross-workspace but missing .source.json)
    if (noSourceJson.length > 0) {
      const childNoSource = noSourceJson.filter(ws => ws !== motherWs);
      if (childNoSource.length > 0) {
        const hashesRec: Record<string, string> = {};
        for (const ws of wsList) {
          const h = hashes.get(ws);
          if (h) hashesRec[ws] = h;
        }
        unmanaged.push({
          name: skillName,
          probableMother: motherWs || wsList[0],
          workspaces: childNoSource,
          hashes: hashesRec,
        });
      }
    }

    // Classify as managed if we have a mother workspace
    if (motherWs) {
      const motherHash = hashes.get(motherWs) || null;
      if (!motherHash) continue;

      const children: ChildStatus[] = [];
      for (const ws of wsList) {
        if (ws === motherWs) continue;
        const childHash = hashes.get(ws);

        let status: ChildStatus["status"] = "ok";
        if (!childHash) {
          status = "error";
        } else if (childHash !== motherHash) {
          status = "diverged";
        }

        children.push({
          workspace: ws,
          hash: childHash ?? null,
          status,
          hasSourceJson: hasSourceJson.has(ws),
        });
      }

      managed.push({
        name: skillName,
        sourceWorkspace: motherWs,
        sourceHash: motherHash,
        children,
      });
    }
  }

  return { managed, unmanaged, orphans, groupMismatches: checkGroups() };
}

export function buildCatalog(workspaces: WorkspaceConfig[]): SkillCatalog {
  const catalog: SkillCatalog = {};
  for (const ws of workspaces) {
    const skillsDir = getSkillsDir(ws.slug);
    if (!fs.existsSync(skillsDir)) continue;
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === ".sync-backup") continue;
      if (!catalog[name]) catalog[name] = [];
      catalog[name].push(ws.slug);
    }
  }
  return catalog;
}

/** Validate skill name for path traversal attacks */
export function validateSkillName(name: string): void {
  if (/[\/\\]/.test(name) || name === "." || name === ".." || !name) {
    throw new Error(`Invalid skill name: "${name}" — must not contain path separators or be relative`);
  }
}

export function listDefaultSkills(): Set<string> {
  const set = new Set<string>();
  if (fs.existsSync(DEFAULT_SKILLS_DIR)) {
    for (const entry of fs.readdirSync(DEFAULT_SKILLS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) set.add(entry.name);
    }
  }
  return set;
}
