import { open, stat, mkdir, cp, rm } from "node:fs/promises";
import * as path from "node:path";
import { getSkillsDir, listDefaultSkills } from "./scanner.js";
import { hashSkillDir } from "./hasher.js";
import { safeSegment } from "./pathsafe.js";
import { SourceJson, SyncResult, SyncResultItem, BootstrapResult } from "./types.js";

/**
 * Same-module path guard (CWE-22): resolve `userInput` under `base` and
 * refuse anything outside it. Kept local to this module so the sanitizer
 * is visible at every filesystem sink here.
 */
function safeResolve(base: string, userInput: string, label = "path"): string {
  if (userInput === "" || userInput === "." || userInput.includes("\0")) {
    throw new Error(`${label}: Refusing empty/NUL path segment: "${userInput}"`);
  }
  if (userInput.split(/[\\/]+/).includes("..")) {
    throw new Error(`${label}: Refusing ".." segment in path: "${userInput}"`);
  }
  const baseAbs = path.resolve(base);
  const resolved = path.resolve(baseAbs, userInput);
  if (resolved !== baseAbs && !resolved.startsWith(baseAbs + path.sep)) {
    throw new Error(`${label}: Refusing path outside ${baseAbs}: ${userInput}`);
  }
  return resolved;
}

/** Existence probe without sync fs: stat resolves to a boolean. */
function pathExists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

/** Read a whole text file via an fs/promises FileHandle. */
async function readTextFile(p: string): Promise<string> {
  const fh = await open(p, "r");
  try {
    return await fh.readFile("utf-8");
  } finally {
    await fh.close();
  }
}

/** Write a whole text file via an fs/promises FileHandle. */
async function writeTextFile(p: string, data: string): Promise<void> {
  const fh = await open(p, "w");
  try {
    await fh.writeFile(data, "utf-8");
  } finally {
    await fh.close();
  }
}

/**
 * Sync: copy skill directory from mother to one or more child workspaces.
 * Backs up existing child directory before overwriting.
 * Accepts optional sourceWorkspace to skip auto-detection (needed for first-time deploy).
 * Refuses to operate on default-skills managed by workspace-watcher.
 */
export async function syncSkill(skill: string, targetWorkspaces: string[], sourceWorkspace?: string): Promise<SyncResult> {
  const skillSafe = safeSegment(skill, "skill");
  const targets = targetWorkspaces.map(ws => safeSegment(ws, "workspace"));
  const sourceWsSafe = sourceWorkspace !== undefined ? safeSegment(sourceWorkspace, "sourceWorkspace") : undefined;
  if (listDefaultSkills().has(skill)) {
    return { skill, results: [{ workspace: "*", success: false, error: `Refused: "${skill}" is a default-skill managed by workspace-watcher. Do not sync manually.` }] };
  }
  const results: SyncResultItem[] = [];
  let motherWs: string | null = sourceWsSafe || null;

  // Auto-detect mother if not provided
  if (!motherWs) {
    for (const ws of targets) {
      const srcFile = safeResolve(getSkillsDir(ws), path.join(skillSafe, ".source.json"), "source file");
      if (await pathExists(srcFile)) {
        try {
          const sj: SourceJson = JSON.parse(await readTextFile(srcFile));
          motherWs = safeSegment(sj.sourceWorkspaceSlug, "sourceWorkspaceSlug");
          break;
        } catch { /* keep looking */ }
      }
    }
  }

  if (!motherWs) {
    for (const ws of targets) {
      const wsDir = safeResolve(getSkillsDir(ws), skillSafe, "skill directory");
      if ((await pathExists(wsDir)) && !(await pathExists(path.join(wsDir, ".source.json")))) {
        motherWs = ws;
        break;
      }
    }
  }

  if (!motherWs) {
    results.push({
      workspace: "*",
      success: false,
      error: "Cannot determine mother workspace. Provide sourceWorkspace parameter or run bootstrap first.",
    });
    return { skill, results };
  }

  const motherDir = safeResolve(getSkillsDir(motherWs), skillSafe, "mother skill directory");
  if (!(await pathExists(motherDir))) {
    results.push({
      workspace: motherWs,
      success: false,
      error: `Mother skill "${skill}" not found in workspace "${motherWs}"`,
    });
    return { skill, results };
  }

  const motherHash = hashSkillDir(motherDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (const ws of targets) {
    if (ws === motherWs) {
      results.push({ workspace: ws, success: true, error: "same as mother, skipped" });
      continue;
    }

    const childDir = safeResolve(getSkillsDir(ws), skillSafe, "child skill directory");
    const childExists = await pathExists(childDir);
    let backupPath: string | undefined;

    // Backup existing child
    if (childExists) {
      const backupDir = safeResolve(getSkillsDir(ws), path.join(".sync-backup", skillSafe, timestamp), "backup directory");
      try {
        await mkdir(path.dirname(backupDir), { recursive: true });
        await cp(childDir, backupDir, { recursive: true });
        backupPath = backupDir;
      } catch (e: any) {
        results.push({ workspace: ws, success: false, error: `Backup failed: ${e.message}` });
        continue;
      }
    }

    // Copy mother → target
    try {
      if (childExists) {
        await rm(childDir, { recursive: true, force: true });
      }
      // Ensure parent skills dir exists (needed for first-time deploy into empty workspace)
      await mkdir(getSkillsDir(ws), { recursive: true });
      await cp(motherDir, childDir, { recursive: true });
    } catch (e: any) {
      results.push({ workspace: ws, success: false, error: `Copy failed: ${e.message}` });
      continue;
    }

    // Write .source.json
    const srcFile = path.join(childDir, ".source.json");
    try {
      let sj: SourceJson;
      if (await pathExists(srcFile)) {
        sj = JSON.parse(await readTextFile(srcFile));
      } else {
        sj = {
          sourceWorkspaceSlug: motherWs,
          sourceWorkspaceName: motherWs,
          importedAt: new Date().toISOString(),
          sourceVersion: "unknown",
        };
      }
      sj.syncedAt = new Date().toISOString();
      sj.syncedHash = motherHash || undefined;
      await writeTextFile(srcFile, JSON.stringify(sj, null, 2) + "\n");
    } catch (e: any) {
      results.push({
        workspace: ws,
        success: true,
        error: `Synced but .source.json update failed: ${e.message}`,
        backupPath,
      });
      continue;
    }

    results.push({ workspace: ws, success: true, backupPath });
  }

  return { skill, results };
}

/**
 * Bootstrap: create .source.json for a skill in a workspace that lacks one.
 */
export async function bootstrap(skill: string, workspace: string, sourceWorkspace: string): Promise<BootstrapResult> {
  const skillSafe = safeSegment(skill, "skill");
  const wsSafe = safeSegment(workspace, "workspace");
  const srcWsSafe = safeSegment(sourceWorkspace, "sourceWorkspace");
  if (listDefaultSkills().has(skill)) {
    return { skill, workspace, sourceWorkspace, created: false, sourceJson: { error: `Refused: "${skill}" is a default-skill managed by workspace-watcher. Do not bootstrap manually.` } };
  }
  const childDir = safeResolve(getSkillsDir(wsSafe), skillSafe, "skill directory");
  const srcFile = path.join(childDir, ".source.json");

  if (!(await pathExists(childDir))) {
    return {
      skill,
      workspace,
      sourceWorkspace,
      created: false,
      sourceJson: { error: `skill "${skill}" not found in workspace "${workspace}"` },
    };
  }

  const motherDir = safeResolve(getSkillsDir(srcWsSafe), skillSafe, "mother skill directory");
  if (!(await pathExists(motherDir))) {
    return {
      skill,
      workspace,
      sourceWorkspace,
      created: false,
      sourceJson: { error: `source skill "${skill}" not found in workspace "${sourceWorkspace}"` },
    };
  }

  if (await pathExists(srcFile)) {
    return {
      skill,
      workspace,
      sourceWorkspace,
      created: false,
      sourceJson: JSON.parse(await readTextFile(srcFile)),
    };
  }

  const sj: SourceJson = {
    sourceWorkspaceSlug: sourceWorkspace,
    sourceWorkspaceName: sourceWorkspace,
    importedAt: new Date().toISOString(),
    sourceVersion: "unknown",
    syncedAt: new Date().toISOString(),
    syncedHash: hashSkillDir(motherDir) || undefined,
  };

  await writeTextFile(srcFile, JSON.stringify(sj, null, 2) + "\n");

  return { skill, workspace, sourceWorkspace, created: true, sourceJson: sj };
}
