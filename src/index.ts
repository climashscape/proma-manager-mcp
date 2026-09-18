#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { check, getSkillsDir, discoverWorkspaces, listDefaultSkills, validateSkillName } from "./scanner.js";
import { diffSkill } from "./diff.js";
import { syncSkill, bootstrap } from "./syncer.js";
import { checkMcp } from "./mcp-check.js";
import { listGroups, setGroups } from "./auto-group.js";
import { hashSkillDir, hashSkillFiles } from "./hasher.js";
import { listSessions, deleteConversation, deleteAgentSession } from "./session-manager.js";
import * as fs from "node:fs";
import * as path from "node:path";

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

const server = new Server(
  { name: "proma-manager", version: "1.4.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "check",
      description: "全量扫描所有工作区，返回跨工作区 skill 的同步状态。单工作区独有 skill 也会检测错误 .source.json（声称来源但源不存在）并报告为 orphan。排除 default-skills 管理的 watcher 同步 skill。返回 managed（有 .source.json）、unmanaged（跨区但缺 .source.json）、orphans（.source.json 指向不存在的母工作区）三组清单。",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "diff",
      description: "对比母版和某个子版 skill 的完整目录差异（文件级 + 行级）。需指定 skill 名和目标工作区 slug。自动拒绝 default-skills（workspace-watcher 管理的 19 个 skill）。",
      inputSchema: {
        type: "object",
        properties: {
          skill: { type: "string", description: "Skill 名称（目录名）" },
          workspace: { type: "string", description: "目标工作区 slug，如 academia / netem / proma / ws178" },
        },
        required: ["skill", "workspace"],
      },
    },
    {
      name: "sync",
      description: "从母工作区推送 skill 整目录到一个或多个子工作区。先备份子版到 .sync-backup/ 再覆盖，更新 .source.json。首次分发时用 sourceWorkspace 参数指定母工作区。自动拒绝 default-skills（workspace-watcher 管理的 19 个 skill）。",
      inputSchema: {
        type: "object",
        properties: {
          skill: { type: "string", description: "Skill 名称（目录名）" },
          workspaces: {
            type: "array",
            items: { type: "string" },
            description: "目标工作区 slug 列表，如 [\"academia\", \"netem\"]",
          },
          sourceWorkspace: {
            type: "string",
            description: "可选。母工作区 slug。首次分发到目标时必填，因为目标没有 .source.json 可自动推断。",
          },
        },
        required: ["skill", "workspaces"],
      },
    },
    {
      name: "bootstrap",
      description: "为跨工作区但缺少 .source.json 的 skill 补溯源文件。指定 skill 名、目标工作区和来源工作区。自动拒绝 default-skills（workspace-watcher 管理的 19 个 skill）。",
      inputSchema: {
        type: "object",
        properties: {
          skill: { type: "string", description: "Skill 名称（目录名）" },
          workspace: { type: "string", description: "目标工作区 slug" },
          sourceWorkspace: { type: "string", description: "来源（母）工作区 slug，如 default / proma" },
        },
        required: ["skill", "workspace", "sourceWorkspace"],
      },
    },
    {
      name: "info",
      description: "查看单个 skill 的完整溯源视图：各工作区是否存在、hash、文件清单、母/子关系。",
      inputSchema: {
        type: "object",
        properties: {
          skill: { type: "string", description: "Skill 名称（目录名）" },
        },
        required: ["skill"],
      },
    },
    {
      name: "mcp_check",
      description: "扫描所有工作区的 mcp.json，返回服务器合集和各工作区缺失的服务器。用于保持所有工作区 MCP 配置一致——每个服务器要么在所有工作区都有，要么只在需要的工作区有。",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "group_list",
      description: "列出指定工作区所有 skill 的 group 状态和内容摘要，供 AI 分析后自动分配 group。自动排除 default-skills 管理的 19 个 watcher 同步 skill。返回每个 skill 的 name、description、当前 group、正文预览。默认扫描 default 工作区。",
      inputSchema: {
        type: "object",
        properties: {
          workspace: { type: "string", description: "工作区 slug，默认 default。可选值由运行时动态扫描 ~/.proma/agent-workspaces/ 确定。" },
        },
        required: [],
      },
    },
    {
      name: "group_set",
      description: "写入 SKILL.md frontmatter 的 group 字段。接受 skill 名到 group 值的映射，批量更新。已有 group 的会被替换，没有的新增。自动拒绝 default-skills（workspace-watcher 管理的 19 个 skill）。",
      inputSchema: {
        type: "object",
        properties: {
          workspace: { type: "string", description: "工作区 slug，默认 default" },
          groups: {
            type: "object",
            description: "skill 名 → group 值的映射，如 { \"skill-a\": \"文档\", \"skill-b\": \"设计\" }",
            additionalProperties: { type: "string" },
          },
        },
        required: ["workspace", "groups"],
      },
    },
    {
      name: "list_sessions",
      description: "列出 Proma 的所有 Chat 对话和 Agent 会话。返回标题、时间、归档状态、工作区等元数据。可按 type 参数筛选。",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["conversations", "agent-sessions"],
            description: "可选。筛选类型：conversations 只返回 Chat 对话，agent-sessions 只返回 Agent 会话。不传则返回全部。",
          },
        },
        required: [],
      },
    },
    {
      name: "delete_session",
      description: "删除指定的 Chat 对话或 Agent 会话。不可逆操作——会同时清理消息文件（.jsonl）、附件和工作目录。建议在 Proma 关闭或切换到其他会话后操作，避免与运行中进程冲突。不传 confirm 或 confirm=false 时仅预览（dry-run），列出将删除的文件/目录及其大小；传 confirm=true 才真正执行删除。",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["conversation", "agent-session"],
            description: "会话类型：conversation 为 Chat 对话，agent-session 为 Agent 会话",
          },
          id: {
            type: "string",
            description: "会话/对话的 ID",
          },
          confirm: {
            type: "boolean",
            description: "安全栅栏。不传或 false 时仅 dry-run 预览将被删除的内容；传 true 才真正执行删除。",
          },
        },
        required: ["type", "id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "check": {
        const result = check();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "diff": {
        const skill = (args as any).skill as string;
        validateSkillName(skill);
        const workspace = (args as any).workspace as string;
        const text = diffSkill(skill, workspace);
        return { content: [{ type: "text", text }] };
      }

      case "sync": {
        const skill = (args as any).skill as string;
        validateSkillName(skill);
        const workspaces = (args as any).workspaces as string[];
        const sourceWorkspace = (args as any).sourceWorkspace as string | undefined;
        const result = await syncSkill(skill, workspaces, sourceWorkspace);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "bootstrap": {
        const skill = (args as any).skill as string;
        validateSkillName(skill);
        const workspace = (args as any).workspace as string;
        const sourceWorkspace = (args as any).sourceWorkspace as string;
        const result = await bootstrap(skill, workspace, sourceWorkspace);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "info": {
        const skill = (args as any).skill as string;
        validateSkillName(skill);
        if (listDefaultSkills().has(skill)) {
          return { content: [{ type: "text", text: JSON.stringify({ name: skill, error: `"${skill}" is a default-skill managed by workspace-watcher.` }, null, 2) }] };
        }
        const checkResult = check();
        const wsInfo: Record<string, any> = {};

        const allWs = discoverWorkspaces();
        for (const ws of allWs) {
          const slug = ws.slug;
          const dir = safeResolve(getSkillsDir(slug), skill, "skill directory");
          const exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
          wsInfo[slug] = {
            exists,
            isMother: false,
            hash: exists ? hashSkillDir(dir) : null,
            hasSourceJson: exists && fs.existsSync(path.join(dir, ".source.json")),
            files: exists ? fs.readdirSync(dir, { recursive: true, withFileTypes: true })
              .filter(e => e.isFile() && e.name !== ".source.json" && !SKIP_FILES.has(e.name) && !e.parentPath?.includes(path.sep + ".sync-backup" + path.sep))
              .map(e => {
                const full = path.join(e.parentPath || e.path, e.name);
                return path.relative(dir, full);
              })
              .sort() : [],
          };
          if (exists && fs.existsSync(path.join(dir, ".source.json"))) {
            wsInfo[slug].sourceJson = JSON.parse(fs.readFileSync(path.join(dir, ".source.json"), "utf-8"));
          }
        }

        // Determine mother
        for (const m of checkResult.managed) {
          if (m.name === skill) {
            wsInfo[m.sourceWorkspace].isMother = true;
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ name: skill, workspaces: wsInfo }, null, 2),
          }],
        };
      }

      case "mcp_check": {
        const result = checkMcp();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "group_list": {
        const workspace = (args as any).workspace as string | undefined;
        const result = listGroups(workspace);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "group_set": {
        const workspace = (args as any).workspace as string;
        const groups = (args as any).groups as Record<string, string>;
        const result = setGroups(workspace, groups);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "list_sessions": {
        const type = (args as any).type as string | undefined;
        const result = listSessions(type as "conversations" | "agent-sessions" | undefined);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "delete_session": {
        const type = (args as any).type as string;
        const id = (args as any).id as string;
        const confirm = !!(args as any).confirm;
        if (!id) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "id 不能为空" }) }] };
        }
        if (type === "conversation") {
          const result = deleteConversation(id, confirm);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } else if (type === "agent-session") {
          const result = deleteAgentSession(id, confirm);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } else {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `无效的 type: ${type}，应为 conversation 或 agent-session` }) }] };
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    // Structured tool error (PathTraversalError included) instead of a JSON-RPC protocol-level error; non-Error throwables are stringified, not swallowed.
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("proma-manager MCP server running");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
