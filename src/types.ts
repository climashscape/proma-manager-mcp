/** Cross-workspace sync status for a single child */
export interface ChildStatus {
  workspace: string;
  hash: string | null;
  status: "ok" | "diverged" | "error";
  error?: string;
  hasSourceJson: boolean;
}

/** A managed skill with full traceability */
export interface ManagedSkill {
  name: string;
  sourceWorkspace: string;
  sourceHash: string;
  children: ChildStatus[];
}

/** A cross-workspace skill missing .source.json in child workspaces */
export interface UnmanagedSkill {
  name: string;
  /** The workspace that has this skill as original (no .source.json = mother) */
  probableMother: string;
  /** Workspaces that have a copy without .source.json */
  workspaces: string[];
  /** Current hash in each workspace */
  hashes: Record<string, string>;
}

/** An orphan: .source.json points to a workspace that no longer has this skill */
export interface OrphanSkill {
  name: string;
  workspace: string;
  claimedSource: string;
  issue: string;
}

/** Result of check() */
export interface CheckResult {
  managed: ManagedSkill[];
  unmanaged: UnmanagedSkill[];
  orphans: OrphanSkill[];
  /** Skills with missing or mismatched group across workspaces */
  groupMismatches: GroupMismatch[];
}

/** A skill with group field issues across workspaces */
export interface GroupMismatch {
  name: string;
  workspaces: Record<string, { group: string; hasSourceJson: boolean }>;
  issue: "missing" | "mismatch" | "missing_in_some";
  /** The mother workspace's group value (if determinable) */
  motherGroup?: string;
}

/** Result of mcp_check() */
export interface McpCheckResult {
  /** Per-workspace MCP config summary */
  workspaces: Record<string, {
    exists: boolean;
    serverCount: number;
    servers: string[];
    errors?: string;
  }>;
  /** The union of all server names across workspaces */
  unionServers: string[];
  /** Servers missing from each workspace (compared to union) */
  missingServers: Record<string, string[]>;
  /** Per-server config diff across workspaces */
  serverDiffs: McpServerDiff[];
}

export interface McpServerDiff {
  name: string;
  /** Workspaces that have this server */
  presentIn: string[];
  /** Workspaces missing this server */
  missingIn: string[];
  /** Config differences (command/args/env) across workspaces that have it */
  configVariations: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

/** Result of sync() for one target workspace */
export interface SyncResultItem {
  workspace: string;
  success: boolean;
  error?: string;
  backupPath?: string;
}

/** Result of sync() */
export interface SyncResult {
  skill: string;
  results: SyncResultItem[];
}

/** Result of bootstrap() */
export interface BootstrapResult {
  skill: string;
  workspace: string;
  sourceWorkspace: string;
  created: boolean;
  sourceJson: Record<string, unknown> | SourceJson;
}

/** Result of info() */
export interface InfoResult {
  name: string;
  /** Per-workspace status */
  workspaces: Record<string, {
    exists: boolean;
    isMother: boolean;
    hash: string | null;
    hasSourceJson: boolean;
    sourceJson?: Record<string, unknown>;
    files: string[];
    version?: string;
  }>;
  /** If managed, the mother workspace */
  motherWorkspace?: string;
}

/** Internal scan cache: skill name → list of workspaces it appears in */
export interface SkillCatalog {
  [skillName: string]: string[];
}

/** The .source.json file structure */
export interface SourceJson {
  sourceWorkspaceSlug: string;
  sourceWorkspaceName: string;
  importedAt: string;
  sourceVersion: string;
  /** Added by skill-sync on sync */
  syncedAt?: string;
  syncedHash?: string;
}

/** Workspace configuration discovered at runtime */
export interface WorkspaceConfig {
  slug: string;
  skillsDir: string;
}