import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

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

const SKIP_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/**
 * Compute a content hash for a skill directory.
 * Recursively hashes all files (sorted by relative path), excludes .source.json.
 */
export function hashSkillDir(dirPath: string): string | null {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return null;
  }

  const files = collectFiles(dirPath);
  const filtered = files.filter(f => {
    const base = path.basename(f);
    return base !== ".source.json" && !SKIP_FILES.has(base);
  }).sort();

  if (filtered.length === 0) {
    return null;
  }

  const hasher = crypto.createHash("sha256");
  for (const relPath of filtered) {
    const absPath = path.join(dirPath, relPath);
    const content = fs.readFileSync(absPath);
    hasher.update(relPath);
    hasher.update("\0");
    hasher.update(content);
    hasher.update("\0");
  }

  return hasher.digest("hex");
}

export function hashSkillFiles(dirPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return result;
  }

  const files = collectFiles(dirPath)
    .filter(f => path.basename(f) !== ".source.json")
    .sort();

  for (const relPath of files) {
    const absPath = safeResolve(dirPath, relPath);
    const content = fs.readFileSync(absPath);
    result[relPath] = crypto.createHash("sha256").update(content).digest("hex");
  }

  return result;
}

function collectFiles(dirPath: string, basePath: string = dirPath): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".sync-backup") continue;
      result.push(...collectFiles(fullPath, basePath));
    } else if (entry.isFile()) {
      result.push(path.relative(basePath, fullPath));
    }
  }
  return result;
}
