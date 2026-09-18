import * as path from "node:path";

/**
 * Shared path-traversal guard (CWE-22 mitigation).
 *
 * Every path segment derived from request arguments must pass through
 * safeSegment() (identifier-like values: skill name, workspace slug,
 * session id, ...), and every filesystem path composed from such values
 * must pass through safeResolve() (strict containment inside a trusted
 * base directory). Both reject absolute-path escapes and any ".." segment.
 */

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

/** True if `candidate` resolves to `base` itself or to a path strictly inside it. */
export function isInsideBase(base: string, candidate: string): boolean {
  const b = path.resolve(base);
  const c = path.resolve(candidate);
  // c === b: the base directory itself is considered "inside".
  return c === b || c.startsWith(b + path.sep);
}

/**
 * Validate that `name` is a single clean path segment (no traversal,
 * no separators). Returns the value unchanged so legitimate names keep
 * working as before. Throws PathTraversalError otherwise.
 */
export function safeSegment(name: string, label = "name"): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new PathTraversalError(`${label}: must be a non-empty string`);
  }
  if (name.includes("\0")) {
    throw new PathTraversalError(`${label}: NUL byte is not allowed`);
  }
  if (name === "." || name === ".." || /[/\\]/.test(name)) {
    throw new PathTraversalError(`${label}: path separators and dot segments are not allowed ("${name}")`);
  }
  // Win32 path normalization strips trailing dots/spaces from segments and
  // collapses dot/space-only segments, so a value like ".. " or "skill." that
  // passes the lexical checks above would still be rewritten by the OS after
  // resolve() — a contained path could then point outside base (e.g. for
  // rmSync). Reject them outright.
  if (/^[\s.]+$/.test(name)) {
    throw new PathTraversalError(`${label}: segment made only of dots/spaces is not allowed ("${name}")`);
  }
  if (/^[.\s]|[.\s]$/.test(name)) {
    throw new PathTraversalError(`${label}: leading or trailing dots/spaces are not allowed ("${name}")`);
  }
  return name;
}

/**
 * Resolve `userInput` against a trusted `base` directory and enforce strict
 * containment: the resolved result must live strictly inside `base`. Empty
 * input and "." are rejected because they resolve to `base` itself — a target
 * no caller of this helper can meaningfully use.
 * Rejects absolute-path escapes (containment check) and any ".." segment in
 * the raw input (defense in depth), so the result can never point outside
 * the base directory. Purely lexical — does not require the path to exist.
 */
export function safeResolve(base: string, userInput: string, label = "path"): string {
  if (typeof userInput !== "string") {
    throw new PathTraversalError(`${label}: must be a string`);
  }
  if (userInput === "" || userInput === ".") {
    throw new PathTraversalError(`${label}: empty or "." input resolves to the base itself, which is not a meaningful target`);
  }
  if (userInput.includes("\0")) {
    throw new PathTraversalError(`${label}: NUL byte is not allowed`);
  }
  const segments = userInput.split(/[\\/]+/);
  if (segments.includes("..")) {
    throw new PathTraversalError(`${label}: ".." segments are not allowed ("${userInput}")`);
  }
  const resolved = path.resolve(base, userInput);
  if (!isInsideBase(base, resolved)) {
    throw new PathTraversalError(`${label}: resolved path escapes base directory ("${userInput}")`);
  }
  return resolved;
}
