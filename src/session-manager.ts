import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { safeSegment } from "./pathsafe.js";

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

// ============================================================
// 类型定义
// ============================================================

export interface Conversation {
  id: string;
  title: string;
  modelId?: string;
  channelId?: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
}

export interface AgentSession {
  id: string;
  title: string;
  workspaceId?: string;
  channelId?: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived: boolean;
  stoppedByUser?: boolean;
  sdkSessionId?: string;
  forkSourceSdkSessionId?: string;
  permissionMode?: string;
  attachedDirectories?: string[];
}

export interface ListResult {
  conversations: Conversation[];
  agentSessions: AgentSession[];
  counts: {
    conversations: number;
    agentSessions: number;
    archivedConversations: number;
    archivedAgentSessions: number;
  };
}

/** 单个待删除的文件/目录条目 */
export interface DeletePreviewItem {
  path: string;
  type: "file" | "directory";
  sizeBytes?: number;
}

/** 删除预览（dry-run 时返回） */
export interface DeletePreview {
  /** 固定为 false，区分于真正删除成功的 success:true */
  success: false;
  stage: "preview";
  id: string;
  type: "conversation" | "agent-session";
  title: string;
  /** 将删除的条目清单 */
  items: DeletePreviewItem[];
  totalSizeBytes: number;
  hint: string;
}

/** 真正删除的返回结果 */
export interface DeleteResult {
  success: boolean;
  id: string;
  title?: string;
  type: "conversation" | "agent-session";
  error?: string;
}

// ============================================================
// 路径常量
// ============================================================

const HOME = os.homedir();
const PROMA_DIR = path.join(HOME, ".proma");
const CONVERSATIONS_JSON = path.join(PROMA_DIR, "conversations.json");
const CONVERSATIONS_DIR = path.join(PROMA_DIR, "conversations");
const ATTACHMENTS_DIR = path.join(PROMA_DIR, "attachments");
const AGENT_SESSIONS_JSON = path.join(PROMA_DIR, "agent-sessions.json");
const AGENT_SESSIONS_DIR = path.join(PROMA_DIR, "agent-sessions");
const WORKSPACES_JSON = path.join(PROMA_DIR, "agent-workspaces.json");
const WORKSPACES_ROOT = path.join(PROMA_DIR, "agent-workspaces");
const SDK_CONFIG_DIR = path.join(PROMA_DIR, "sdk-config");

// ============================================================
// 工具函数
// ============================================================

function readJsonSafe(filePath: string): any {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function getWorkspaceSlugMap(): Map<string, string> {
  const map = new Map<string, string>();
  const data = readJsonSafe(WORKSPACES_JSON);
  if (!data?.workspaces) return map;
  for (const ws of data.workspaces) {
    if (ws.id && ws.slug) {
      map.set(ws.id, ws.slug);
    }
  }
  return map;
}

function fileSizeSafe(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function dirSizeSafe(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const stack = [dirPath];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(full);
        } else {
          total += fileSizeSafe(full);
        }
      }
    }
  } catch {
    // 读取失败返回 0
  }
  return total;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================
// 列出会话
// ============================================================

export function listSessions(
  type?: "conversations" | "agent-sessions"
): ListResult {
  const conversations: Conversation[] = [];
  const agentSessions: AgentSession[] = [];

  const convData = readJsonSafe(CONVERSATIONS_JSON);
  if (convData?.conversations && type !== "agent-sessions") {
    for (const c of convData.conversations) {
      conversations.push({
        id: c.id,
        title: c.title ?? "(无标题)",
        modelId: c.modelId,
        channelId: c.channelId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        pinned: !!c.pinned,
        archived: !!c.archived,
      });
    }
  }

  const sessData = readJsonSafe(AGENT_SESSIONS_JSON);
  if (sessData?.sessions && type !== "conversations") {
    for (const s of sessData.sessions) {
      agentSessions.push({
        id: s.id,
        title: s.title ?? "(无标题)",
        workspaceId: s.workspaceId,
        channelId: s.channelId,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        pinned: s.pinned,
        archived: !!s.archived,
        stoppedByUser: s.stoppedByUser,
        sdkSessionId: s.sdkSessionId,
        forkSourceSdkSessionId: s.forkSourceSdkSessionId,
        permissionMode: s.permissionMode,
        attachedDirectories: s.attachedDirectories,
      });
    }
  }

  return {
    conversations,
    agentSessions,
    counts: {
      conversations: conversations.length,
      agentSessions: agentSessions.length,
      archivedConversations: conversations.filter((c) => c.archived).length,
      archivedAgentSessions: agentSessions.filter((s) => s.archived).length,
    },
  };
}

// ============================================================
// 删除栅栏：confirm=true 才执行，否则 dry-run 预览
// ============================================================

export function deleteConversation(id: string, confirm: boolean): DeletePreview | DeleteResult {
  let idSafe: string;
  try {
    idSafe = safeSegment(id, "id");
  } catch (e: any) {
    return { success: false, id, type: "conversation", error: e.message };
  }

  const data = readJsonSafe(CONVERSATIONS_JSON);
  if (!data?.conversations) {
    return { success: false, id, type: "conversation", error: "conversations.json 读取失败" };
  }

  const conv = data.conversations.find((c: any) => c.id === id);
  if (!conv) {
    return { success: false, id, type: "conversation", error: `对话不存在: ${id}` };
  }

  const items: DeletePreviewItem[] = [];

  // 消息文件
  const msgFile = safeResolve(CONVERSATIONS_DIR, `${idSafe}.jsonl`, "conversation message file");
  if (fs.existsSync(msgFile)) {
    items.push({ path: msgFile, type: "file", sizeBytes: fileSizeSafe(msgFile) });
  }

  // 附件目录
  const attDir = safeResolve(ATTACHMENTS_DIR, idSafe, "conversation attachments dir");
  if (fs.existsSync(attDir)) {
    const sz = dirSizeSafe(attDir);
    items.push({ path: attDir, type: "directory", sizeBytes: sz });
  }

  // 索引入口（不占磁盘，只标记）
  items.push({ path: CONVERSATIONS_JSON, type: "file", sizeBytes: 0 });

  const totalSizeBytes = items.reduce((sum, i) => sum + (i.sizeBytes ?? 0), 0);

  if (!confirm) {
    return {
      success: false,
      stage: "preview",
      id,
      type: "conversation",
      title: conv.title ?? "(无标题)",
      items,
      totalSizeBytes,
      hint: `将删除 1 条索引入口 + ${items.length - 1} 个文件/目录，释放约 ${formatSize(totalSizeBytes)}。确认删除请传 confirm: true。`,
    };
  }

  // —— 以下真正删除 ——
  const idx = data.conversations.findIndex((c: any) => c.id === id);
  data.conversations.splice(idx, 1);
  fs.writeFileSync(CONVERSATIONS_JSON, JSON.stringify(data, null, 2), "utf-8");

  if (fs.existsSync(msgFile)) {
    try { fs.unlinkSync(msgFile); } catch (e: any) {
      console.warn(`[session-manager] 删除消息文件失败: ${msgFile}`, e.message);
    }
  }
  if (fs.existsSync(attDir)) {
    try { fs.rmSync(attDir, { recursive: true, force: true }); } catch (e: any) {
      console.warn(`[session-manager] 删除附件目录失败: ${attDir}`, e.message);
    }
  }

  return { success: true, id, type: "conversation", title: conv.title };
}

export function deleteAgentSession(id: string, confirm: boolean): DeletePreview | DeleteResult {
  let idSafe: string;
  try {
    idSafe = safeSegment(id, "id");
  } catch (e: any) {
    return { success: false, id, type: "agent-session", error: e.message };
  }

  const data = readJsonSafe(AGENT_SESSIONS_JSON);
  if (!data?.sessions) {
    return { success: false, id, type: "agent-session", error: "agent-sessions.json 读取失败" };
  }

  const sess = data.sessions.find((s: any) => s.id === id);
  if (!sess) {
    return { success: false, id, type: "agent-session", error: `会话不存在: ${id}` };
  }

  const items: DeletePreviewItem[] = [];

  // 消息文件
  const msgFile = safeResolve(AGENT_SESSIONS_DIR, `${idSafe}.jsonl`, "agent session message file");
  if (fs.existsSync(msgFile)) {
    items.push({ path: msgFile, type: "file", sizeBytes: fileSizeSafe(msgFile) });
  }

  // session 工作目录
  if (sess.workspaceId) {
    const slugMap = getWorkspaceSlugMap();
    const slug = slugMap.get(sess.workspaceId);
    if (slug) {
      const sessionDir = safeResolve(path.join(WORKSPACES_ROOT, safeSegment(slug, "workspace slug")), idSafe, "session work dir");
      if (fs.existsSync(sessionDir)) {
        const sz = dirSizeSafe(sessionDir);
        items.push({ path: sessionDir, type: "directory", sizeBytes: sz });
      }
    }
  }

  // SDK 关联数据
  const sdkSessionIds = [sess.sdkSessionId, sess.forkSourceSdkSessionId].filter(Boolean) as string[];
  if (sdkSessionIds.length > 0) {
    const fileHistoryDir = path.join(SDK_CONFIG_DIR, "file-history");
    for (const sid of sdkSessionIds) {
      const histDir = safeResolve(fileHistoryDir, safeSegment(sid, "sdkSessionId"), "file-history dir");
      if (fs.existsSync(histDir)) {
        items.push({ path: histDir, type: "directory", sizeBytes: dirSizeSafe(histDir) });
      }
    }

    const projectsDir = path.join(SDK_CONFIG_DIR, "projects");
    if (fs.existsSync(projectsDir)) {
      try {
        for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          for (const sid of sdkSessionIds) {
            if (entry.name.endsWith(`-${sid}`)) {
              const fullPath = path.join(projectsDir, entry.name);
              items.push({ path: fullPath, type: "directory", sizeBytes: dirSizeSafe(fullPath) });
            }
          }
        }
      } catch { /* 忽略读取错误 */ }
    }
  }

  // 索引入口
  items.push({ path: AGENT_SESSIONS_JSON, type: "file", sizeBytes: 0 });

  const totalSizeBytes = items.reduce((sum, i) => sum + (i.sizeBytes ?? 0), 0);

  if (!confirm) {
    return {
      success: false,
      stage: "preview",
      id,
      type: "agent-session",
      title: sess.title ?? "(无标题)",
      items,
      totalSizeBytes,
      hint: `将删除 1 条索引入口 + ${items.length - 1} 个文件/目录，释放约 ${formatSize(totalSizeBytes)}。确认删除请传 confirm: true。`,
    };
  }

  // —— 以下真正删除 ——
  const idx = data.sessions.findIndex((s: any) => s.id === id);
  data.sessions.splice(idx, 1);
  fs.writeFileSync(AGENT_SESSIONS_JSON, JSON.stringify(data, null, 2), "utf-8");

  if (fs.existsSync(msgFile)) {
    try { fs.unlinkSync(msgFile); } catch (e: any) {
      console.warn(`[session-manager] 删除消息文件失败: ${msgFile}`, e.message);
    }
  }

  // 清理 session 工作目录
  if (sess.workspaceId) {
    const slugMap = getWorkspaceSlugMap();
    const slug = slugMap.get(sess.workspaceId);
    if (slug) {
      const sessionDir = safeResolve(path.join(WORKSPACES_ROOT, safeSegment(slug, "workspace slug")), idSafe, "session work dir");
      if (fs.existsSync(sessionDir)) {
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e: any) {
          console.warn(`[session-manager] 清理工作目录失败: ${sessionDir}`, e.message);
        }
      }
    }
  }

  // 清理 SDK 关联数据
  if (sdkSessionIds.length > 0) {
    const fileHistoryDir = path.join(SDK_CONFIG_DIR, "file-history");
    for (const sid of sdkSessionIds) {
      const histDir = safeResolve(fileHistoryDir, safeSegment(sid, "sdkSessionId"), "file-history dir");
      if (fs.existsSync(histDir)) {
        try { fs.rmSync(histDir, { recursive: true, force: true }); } catch (e: any) {
          console.warn(`[session-manager] 清理 file-history 失败: ${histDir}`, e.message);
        }
      }
    }
    const projectsDir2 = path.join(SDK_CONFIG_DIR, "projects");
    if (fs.existsSync(projectsDir2)) {
      try {
        for (const entry of fs.readdirSync(projectsDir2, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          for (const sid of sdkSessionIds) {
            if (entry.name.endsWith(`-${sid}`)) {
              fs.rmSync(path.join(projectsDir2, entry.name), { recursive: true, force: true });
            }
          }
        }
      } catch (e: any) {
        console.warn(`[session-manager] 清理 projects 子目录失败`, e.message);
      }
    }
  }

  return { success: true, id, type: "agent-session", title: sess.title };
}