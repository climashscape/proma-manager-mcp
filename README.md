# Proma Manager MCP Server

**Proma 的瑞士军刀——一个 MCP Server，管完 Skills、MCP、会话。**

还在 Proma 侧边栏一个个右键删对话？想让 Skills 在所有工作区保持一致却手动复制？想知道哪些 Skill 分叉了、哪些工作区 MCP 配置掉了？**这个 Server 就是答案。**

---

## 它能干什么

### 🔄 Skill 跨工作区同步

5 个工作区的 Skill 都一致吗？一条命令查清：

```
Agent → check → 返回 managed / unmanaged / orphans 三张清单
```

分叉的 Skill？`diff` 看差异，`sync` 一键从母版覆盖到全部子工作区。新工作区缺 Skill？`bootstrap` 补溯源，`sync` 分发过去。再也不用手动复制粘贴了。

### 🛡️ MCP 配置审计

某天突然发现某个工作区少了 `tavily` MCP？`mcp_check` 一扫，哪些工作区缺哪些服务器、哪里配置不一致，一览无余。

### 📊 Skill 自动分组

侧边栏 Skill 列表太长？`group_list` 列出所有 Skill 的内容摘要，AI 分析后自动归纳分组，`group_set` 批量写入。文档类归文档，设计类归设计，半天翻不完的列表变成三五个折叠分组。

### 🗑️ 会话/对话管理

这是最顺手的功能——再也不用开 Proma GUI 侧边栏一个个右键删了。

- `list_sessions` — 列出所有 Chat 对话和 Agent 会话（标题、时间、归档状态）
- `delete_session` — **双重安全栅栏**：不传 `confirm` 时自动 dry-run 预览（展示将删除的全部文件路径和大小），传 `confirm: true` 才真删。删的是真删——消息文件 `.jsonl`、附件、工作目录、SDK 关联数据，一个不留。

"帮我把最近一周所有叫'新对话'的无意义对话删了"——一句话，Agent 帮你搞定。

---

## 安装

```bash
git clone https://github.com/climashscape/proma-manager-mcp.git
cd proma-manager-mcp
npm install
npm run build
```

## 配置

在你的 Proma 工作区 `mcp.json` 中加入（所有工作区都建议加）：

```json
{
  "servers": {
    "proma-manager": {
      "type": "stdio",
      "enabled": true,
      "command": "node",
      "args": ["/absolute/path/to/proma-manager-mcp/build/index.js"]
    }
  }
}
```

重启 Proma，`mcp__proma-manager__*` 系列工具自动可用。

## 配套 Skill

本仓库自带 `proma-manager` Skill（`proma-manager/SKILL.md`），安装后需手动复制到工作区才能生效：

```bash
# 以默认工作区为例
cp proma-manager/ ~/.proma/agent-workspaces/default/skills/proma-manager/
```

或者通过 Proma Manager 自身的 `sync` 工具分发到所有工作区。

装好 Skill 后，AI 就知道什么场景该用哪个工具了——比如你说"帮我删了所有叫新对话的无意义对话"，AI 会自动调用 `list_sessions` 列出 + `delete_session` 批量删除。

---

## 10 个工具一览

| 工具 | 一句话 |
|------|--------|
| `check` | 全量扫描所有工作区 skill 同步状态（managed / unmanaged / orphans） |
| `diff` | 对比母版与子版 skill 的完整差异（文件级 + 行级） |
| `sync` | 从母工作区推送 skill 到子工作区（自动备份 + 覆盖 + 更新溯源） |
| `bootstrap` | 给跨工作区但缺 `.source.json` 的 Skill 补溯源文件 |
| `info` | 查看一个 Skill 在各工作区的完整状态（是否存在 / hash / 文件清单） |
| `mcp_check` | 扫描所有工作区 mcp.json，找出缺失和不一致的 MCP 配置 |
| `group_list` | 列出 Skill 的分组状态和内容摘要（供 AI 自动分组用） |
| `group_set` | 批量写入 Skill 分组（与 group_list 配合实现 AI 自动归类） |
| `list_sessions` | 列出所有 Chat 对话和 Agent 会话（标题 / 时间 / 归档状态） |
| `delete_session` | 删除对话或会话——不传 confirm 时 dry-run 预览，confirm:true 才真删 |

## 依赖

- Node.js >= 18
- `@modelcontextprotocol/sdk` ^1.0.0

## License

MIT