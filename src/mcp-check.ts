import * as fs from "node:fs";
import * as path from "node:path";
import { discoverWorkspaces, WORKSPACES_ROOT } from "./scanner.js";
import { McpCheckResult, McpServerDiff } from "./types.js";

/**
 * Scan all workspace mcp.json files.
 * Returns union of servers, missing per workspace, and config diffs.
 */
export function checkMcp(): McpCheckResult {
  const workspaces = discoverWorkspaces();
  const wsData: McpCheckResult["workspaces"] = {};

  // Collect all servers across workspaces
  const allServers = new Set<string>();
  // For each server, track which workspaces have it and with what config
  const serverMeta = new Map<string, Map<string, { command: string; args?: string[]; env?: Record<string, string> }>>();

  for (const ws of workspaces) {
    const mcpFile = path.join(WORKSPACES_ROOT, ws.slug, "mcp.json");
    const servers: string[] = [];
    let serverCount = 0;
    let errors: string | undefined;

    if (fs.existsSync(mcpFile)) {
      try {
        const raw = fs.readFileSync(mcpFile, "utf-8");
        const config = JSON.parse(raw);
        const serverMap = config.servers || {};

        for (const [name, def] of Object.entries(serverMap) as [string, any][]) {
          if (!def || def.type !== "stdio") continue;
          servers.push(name);
          serverCount++;

          if (!serverMeta.has(name)) serverMeta.set(name, new Map());
          serverMeta.get(name)!.set(ws.slug, {
            command: def.command || "",
            args: def.args,
            env: redactEnv(def.env),
          });
        }

        for (const s of servers) allServers.add(s);
      } catch (e: any) {
        errors = e.message;
      }
    }

    wsData[ws.slug] = {
      exists: fs.existsSync(mcpFile),
      serverCount,
      servers: servers.sort(),
      errors,
    };
  }

  const unionServers = [...allServers].sort();
  const missingServers: Record<string, string[]> = {};

  for (const ws of workspaces) {
    const have = new Set(wsData[ws.slug]?.servers || []);
    const missing = unionServers.filter(s => !have.has(s));
    if (missing.length > 0) {
      missingServers[ws.slug] = missing;
    }
  }

  // Build diffs for servers present in at least 2 workspaces
  const serverDiffs: McpServerDiff[] = [];
  for (const [name, wsMap] of serverMeta) {
    const presentIn = [...wsMap.keys()].sort();
    const allWs = workspaces.map(w => w.slug);
    const missingIn = allWs.filter(w => !wsMap.has(w));

    // Only report if there are differences worth surfacing
    if (presentIn.length < workspaces.length || configVaries(wsMap)) {
      serverDiffs.push({
        name,
        presentIn,
        missingIn,
        configVariations: Object.fromEntries(wsMap),
      });
    }
  }

  return { workspaces: wsData, unionServers, missingServers, serverDiffs };
}

function redactEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;
  const sensitive = /(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)/i;
  const redacted: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    redacted[k] = sensitive.test(k) ? "***REDACTED***" : v;
  }
  return redacted;
}

function configVaries(wsMap: Map<string, { command: string; args?: string[]; env?: Record<string, string> }>): boolean {
  if (wsMap.size <= 1) return false;
  const entries = [...wsMap.values()];
  const first = JSON.stringify(entries[0]);
  for (let i = 1; i < entries.length; i++) {
    if (JSON.stringify(entries[i]) !== first) return true;
  }
  return false;
}
