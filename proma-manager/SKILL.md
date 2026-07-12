---
name: proma-manager
description: "跨工作区 Skill 同步工具。当用户想把一个 skill 复制/分发/安装/推送到其他工作区、或提到'skill同步','同步skill','同步技能','skill版本','skill分叉','.source.json','补溯源','查skill版本','帮我装到其他工作区','把XXskill复制到','传到XX工作区','分发到','推送到','装上','这个skill也弄到'时触发。也用于保持跨工作区 MCP 配置一致：'MCP同步','同步MCP','MCP保持一致','mcp一致','检查mcp配置'。也用于自动管理 Skill 分组：'skill分组','自动分组','group缺失','补group','分组管理'。也用于管理 Proma 会话/对话：'列会话','列出会话','删除会话','删对话','会话管理','清理对话','清理会话'。TRIGGER: 用户想查看哪些 skill 分叉了、想同步 skill 到其他工作区、想把当前工作区的 skill 分发到其他工作区、想给缺溯源的 skill 补 .source.json、想让各工作区 MCP 配置保持一致、想查看或自动补全 skill 的 group 字段、想列出/删除 Chat 对话或 Agent 会话。不要用于 default-skills 管理的 19 个 skill（agent-collaboration/automation/brainstorming/docx/executing-plans/find-skills/guizang-ppt-skill/pdf/pptx/proma-build-ai-app/proma-cloud-sdk/proma-coach/proma-generate-image/proma-gpt-image-2/session-cleaner/skill-creator/tool-builder/writing-plans/xlsx）——它们由 workspace-watcher 自动同步。"
group: Proma
version: "1.5.0"
---

# Proma Manager — 跨工作区 Skill 同步 & 会话管理

> 通过 `proma-manager` MCP Server 管理 Proma 跨工作区 skill 的溯源、检测和同步，以及 Chat 对话和 Agent 会话的列出与删除。

## 排除规则

**以下 skill 由 `workspace-watcher` 自动管理，不要碰（MCP 所有工具均动态读取 `~/.proma/default-skills/` 自动排除/拒绝）：**

`agent-collaboration`, `automation`, `brainstorming`, `docx`, `executing-plans`, `find-skills`, `guizang-ppt-skill`, `pdf`, `pptx`, `proma-build-ai-app`, `proma-cloud-sdk`, `proma-coach`, `proma-generate-image`, `proma-gpt-image-2`, `session-cleaner`, `skill-creator`, `tool-builder`, `writing-plans`, `xlsx`

**其他规则：**
- 只在一个工作区出现的 skill → 原创，不参与同步
- 跨多工作区 + 有 `.source.json` → 受管理，可同步
- 跨多工作区 + 无 `.source.json` → 不受管理，需先 `bootstrap`

## 十个 MCP 工具

### 一、Skill 同步（8 个）

### `check` — 全量扫描

无参数。返回三组清单：

| 分组 | 含义 |
|------|------|
| `managed` | 有 `.source.json` 的 skill，含母/子 hash 对比 |
| `unmanaged` | 跨区但缺 `.source.json` 的 skill |
| `orphans` | `.source.json` 指向不存在的母工作区 |

**状态判断**：`ok`（hash 一致）、`diverged`（分叉）、`error`（无法读取）

另外 `check` 还会返回 `groupMismatches`，列出跨工作区 group 字段缺失或不一致的 skill（自动排除 default-skills 的 19 个）。

### `diff` — 查看差异

**参数**：`skill`（skill 目录名）、`workspace`（子工作区 slug）

输出母版与子版的完整目录差异（文件级 + 行级 unified diff）。

### `sync` — 同步（写操作）

**参数**：`skill`、`workspaces`（目标工作区 slug 数组）、`sourceWorkspace`（可选，首次分发时必填）

**行为**：
1. **守卫检查**：若 skill 在 `default-skills/` 中，自动拒绝并返回错误（workspace-watcher 管的事不能手动 sync）
2. 确定母工作区（从 .source.json 自动推断，或用 sourceWorkspace 参数指定）
3. 备份目标现有 skill 到 `.sync-backup/<skill>/<timestamp>/`（如果存在）
4. 从母版覆盖整个 skill 目录（目标不存在时会自动创建 skills 父目录）
5. 更新目标的 `.source.json`（`syncedAt` + `syncedHash`）

**确认**：这是破坏性写操作，执行前须向用户确认。

### `bootstrap` — 补溯源（写操作）

**参数**：`skill`、`workspace`（目标工作区）、`sourceWorkspace`（母工作区 slug）

给跨区但缺 `.source.json` 的 skill 创建溯源文件。母工作区通常是 `default`（默认）或 `proma`（dev-* 系列）。

**守卫**：若 skill 在 `default-skills/` 中，自动拒绝——它们不需要 bootstrap。

**确认**：写操作，执行前向用户确认。

### `info` — 单个 skill 全貌

**参数**：`skill`

返回：各工作区是否存在 / hash / `.source.json` 内容 / 文件清单 / 谁是母。

### `mcp_check` — MCP 配置一致性

**参数**：无

扫描所有工作区的 `mcp.json`，返回：
- 各工作区已有服务器列表
- 全工作区服务器合集（`unionServers`）
- 各工作区缺失的服务器（`missingServers`）
- 服务器配置差异（`serverDiffs`，仅当配置不一致时出现）

用于保持所有工作区 MCP 配置一致。每个服务器要么在所有工作区都有，要么只在需要的工作区有。

### `group_list` — 列出 Skill 分组状态

**参数**：`workspace`（可选，默认 `default`）

返回：每个 skill 的 `name`、`description`、当前 `group`（可能为 null）、正文前 500 字符预览（`bodyPreview`）。同时返回 `groupedCount` / `ungroupedCount` 统计。

**自动排除**：运行时动态读取 `~/.proma/default-skills/`，自动排除 workspace-watcher 管理的 19 个 default-skill。

用途：作为 AI 自动分组的输入——先 `group_list` 列出所有 skill 的元数据，AI 分析后确定分组方案，再通过 `group_set` 写入。

### `group_set` — 批量写入分组

**参数**：`workspace`（工作区 slug）、`groups`（`{ "skill-name": "分组名", ... }` 映射对象）

**行为**：
1. **守卫检查**：若 skill 在 `default-skills/` 中，自动拒绝并返回错误——它们的 group 由 workspace-watcher 管理
2. 已有 `group:` 字段 → 替换值
3. 没有 `group:` 字段 → 在 `description:` 行后插入新行
4. 返回每个 skill 的写入结果（`success` / `error`）

### 二、会话管理（2 个）

### `list_sessions` — 列出会话/对话

**参数**：`type`（可选，`"conversations"` 只返回 Chat 对话，`"agent-sessions"` 只返回 Agent 会话，不传返回全部）

返回：所有对话和会话的标题、时间、归档状态、工作区等元数据，以及按类型分组的计数统计。

### `delete_session` — 删除会话/对话（写操作）

**参数**：`type`（`"conversation"` 或 `"agent-session"`）、`id`（会话/对话 ID）、`confirm`（布尔值）

**安全栅栏**：
- 不传 `confirm` 或 `confirm: false` → **dry-run 预览**，列出将被删除的所有文件/目录及其大小，不执行实际删除。返回 `stage: "preview"`。
- `confirm: true` → 真正执行删除，同时清理索引、消息文件（`.jsonl`）、附件目录、session 工作目录和 SDK 关联数据。

**确认**：不可逆操作，必须先 dry-run 预览确认再传 `confirm: true` 执行。

## 工作流

### 自动分组工作流

```
1. group_list <workspace> → 列出所有 skill 及内容摘要
2. AI 分析每个 skill 的 description + bodyPreview，归纳分组
   - 分组克制：优先让用户快速折叠/浏览，不把每个细分场景做成新组
   - 同平台/同能力域归到同一 group
   - 已有 group 的 skill 如果明显准确则保留，不准确再修正
   - 证据不足的放入 "未分组"
3. 展示分组方案给用户确认
4. group_set <workspace> --groups {...} → 批量写入
5. group_list <workspace> → 验证 groupedCount 符合预期
```

### 日常检测

```
1. check → 查看全貌
2. 对每个 diverged 的 skill 调 diff 看差异
3. 向用户报告分叉情况
```

### 修复分叉

```
1. check → 列出所有 diverged skill
2. 对每个 diverged 的 skill 调 diff <skill> <workspace>
   → 分析差异本质：是母版更新了新功能/修了bug，还是子版独立演化
3. 向用户汇总每项差异的本质，让用户逐项决策：
   - 母版更新 → sync 覆盖子版
   - 子版独立演化且有价值 → 反向合入母版（手动，skill-sync 不处理）
   - 子版已无用 → 直接删除子版目录
4. sync <skill> --workspaces [目标] → 覆盖 + 备份
5. check → 验证 hash 一致
6. 同步完成后清理备份（确认无误后 rm -rf .sync-backup/）
```

### 补溯源

```
1. check → 查看 unmanaged 清单
2. diff <skill> <workspace> → 确认子版内容和母版差异
3. 向用户报告差异本质，确认母工作区
4. bootstrap <skill> --workspace <ws> --sourceWorkspace <母>
5. check → 确认已移入 managed
```

### 分发新 Skill 到其他工作区

当用户想把母工作区的一个 skill 首次推到其他工作区时：

```
1. 确认 skill 不在 default-skills 中（如在则交给 watcher）
2. info <skill> → 确认母工作区 + 当前内容完好
3. 列出目标工作区，向用户确认
4. sync <skill> --workspaces [目标列表] --sourceWorkspace <母>
   → 首次分发用 sync + sourceWorkspace 参数，一步完成复制 + .source.json
5. check → 确认全部 ok
```

### 同步 MCP 配置

当用户要求 MCP 配置保持一致时：

```
1. mcp_check → 查看各工作区缺失和差异
2. 向用户报告：哪些工作区缺哪些 server、配置是否有差异
3. 按用户决策，用默认工作区的 mcp.json 为模板同步到其他工作区
4. mcp_check → 确认 missingServers 为空
```

### 删除对话/会话

```
1. list_sessions → 列出全部或按类型筛选
2. 按用户确认要删除的 ID 列表
3. 对每个 ID 调 delete_session，先不传 confirm → 预览删除范围
4. 向用户确认预览结果
5. delete_session confirm:true → 执行删除
6. list_sessions → 确认已移除
```

## 工作区发现

工作区列表由 `check` 在运行时动态扫描 `~/.proma/agent-workspaces/` 下的所有子目录（含 `skills/` 子目录的即为工作区）。不要在本文件或任何地方固化工作区清单。slug 就是 `agent-workspaces/` 下的目录名。

母 Skill 分布由 `check` 动态发现，不要固化。`.source.json` 的 `sourceWorkspaceSlug` 就是唯一真源。

## 哈希机制

- 递归遍历 skill 目录下所有文件
- **排除** `.source.json`（避免自引用哈希循环）
- 文件排序后，对每个文件：`SHA256(相对路径 + "\0" + 文件内容 + "\0")`
- 合成最终目录哈希
- 不信任 `version` 字段——只看内容
