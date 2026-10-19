# pi-wingman 移交文档（HANDOFF）

> 新会话开场：读 [PROJECT_MEMORY.md](./PROJECT_MEMORY.md)（决策与状态记忆）→ 本文件（实现蓝图）→ [AGENTS.md](./AGENTS.md)（命令与陷阱）。证据锚点见末节。

## 现状

- repo：https://github.com/master-g/pi-wingman（public），本地 `~/github/pi-wingman`，main 分支。
- 骨架已建仓：`config.ts` 真实可用（读写 `~/.pi/agent/wingman.json`）；`index.ts` 已注册 `/wingman`（状态）、`/advisor <provider/model|off>`（配置）命令；`llm.ts` / `audit.ts` / `hint.ts` / `advisor.ts` / `headsup.ts` 为带契约注释的桩。
- 已验证：`bun install` 后 `npm run typecheck` 通过。
- **未验证**：未在真实 pi 中加载过。新会话第一步：`pi --extension ~/github/pi-wingman/index.ts` 跑 `/wingman` 确认骨架加载。

## 任务目标（三功能）

| 功能 | 参照 | 行为 | 输出通道 |
|---|---|---|---|
| heads-up | — | 主 agent 工作时后台去抖审计近期动作，提前发现潜在问题 | 只给用户：`notify` + widget 行（只读旁路，不阻塞、不注入） |
| advisor | oh-my-pi advisor | 用户指定的模型读主 agent 每个 turn，产出 aside/concern/blocker | 注入主 agent：`pi.sendUserMessage(note, { deliverAs: "steer" })`，同时 notify 用户 |
| hint | Claude Code prompt suggestions | `agent_end` 后按目标+上下文生成 1 条 ≤120 字符的下一步 prompt | CustomEditor ghost text：Tab 填入可编辑、Enter 直接发送、任意其他按键清除 |

heads-up 与 advisor 复用 `audit.ts` 审计管线（digest → Verdict），只差输出通道。

## 关键 API 事实（已核实）

证据位置：本 repo `node_modules/@earendil-works/pi-coding-agent/`（装依赖后才有）。

- 旁路调模型：`ctx.modelRegistry.complete(model, context, options)` / `streamSimple`（dist/core/model-registry.d.ts:39-40）。idle 时 `ctx.signal` 不存在，旁路调用用自有 AbortController，`session_shutdown` 统一 abort。
- 注入运行中的 agent：`pi.sendUserMessage(text, { deliverAs: "steer" })`（dist/core/extensions/types.d.ts:1267）。
- 事件：`before_agent_start`（含 `messageType` 与用户 `prompt`，hint 的"目标"来源）、`tool_execution_end`、`turn_end`（可返回 `continue: true`）、`agent_end`（hint 触发点）、`session_start` / `session_shutdown`。
- 输入框：`ctx.ui.setEditorText()` / `getEditorText()`（types.d.ts:135-137）。
- ghost text：`ctx.ui.setEditorComponent()` 安装 `CustomEditor` 子类，未拥有的按键转发基类（示例 `examples/extensions/border-status-editor.ts`、`modal-editor.ts`）。**不要**用 `pi.registerShortcut` 绑 Tab（与编辑器补全冲突，已否决）。
- 降级方案备件：`ctx.ui.addAutocompleteProvider(cur => wrapped)`（示例 `github-issue-autocomplete.ts`）。
- widget：工厂形式 `ctx.ui.setWidget` 只挂一次，之后 `tui.requestRender()` 更新；重复 setWidget 会沉到 below-editor 栈底（pi-usage-hud/index.ts 头部注释）。
- 持久化：配置走 `config.ts`（wingman.json）；需随会话分支走的状态用 `pi.appendEntry()`。

## 里程碑与验收

**M1 hint**（当前任务）
1. `llm.ts`：`resolveModel(registry, "provider/model-id")` + `complete()` 包装（统一超时、AbortController）；未配置模型时回退当前模型。
2. `hint.ts`：`agent_end` 触发生成（输入：用户目标 + 最近工作摘要；输出 1 条 ≤120 字符建议）；`HintEditor extends CustomEditor` 实现 ghost text 与 Tab/Enter/清除状态机；`session_start` / `before_agent_start` 清除 pending hint。
3. 验收：`pi --extension ./index.ts` 真实会话中 Tab 填入、Enter 发送、打字清除均正常；`npm run typecheck` + `bun test` 通过。

**M2 advisor**：`audit.ts`（buildDigest + runAudit，冷却互斥，Verdict: ok/note/concern/blocker）→ `advisor.ts`（turn_end 审计 → steer 注入，注入消息打标防循环；`/ask-advisor <问题>` 手动咨询）。

**M3 heads-up**：`headsup.ts`（`tool_execution_end` 聚合，去抖 ~8s 或每 6 次调用 → audit → notify + widget 行，错误静默降级保留 last-good）。

## 陷阱

- 旁路调用只读非阻塞：永不阻塞 `tool_call`；失败返回结果对象（`ok:false` + reason），不抛进 pi 事件循环。
- 渲染行宽不得超过给定宽度：超宽让 pi-tui `doRender` 抛错，拖垮整个 pi 进程。
- CustomEditor 未拥有的按键必须转发基类，恢复默认用 `setEditorComponent(undefined)`。
- advisor steer 注入必须打标，advisor 触发的 turn 不再触发 advisor（防循环）。
- 提交规范见 AGENTS.md 审查规则；`git push` / `npm publish` 须用户确认。

## 未验证点（实现时确认）

- CustomEditor 拦截 Tab/Enter 的转发细节与提交机制（M1 第一个手动场景试出）。
- steer 注入在高频 turn 下的体感与成本（M2 用冷却 + 用户自选便宜模型兜底）。

## 证据锚点

- 调研来源：Claude Code prompt suggestions（ghost text + Tab 预填/Enter 发送/按键清除）、oh-my-pi advisor（reviewer 模型读 turn 内联注入便签）。
- 参考实现：`~/github/pi-usage-hud`（widget 生命周期、provider 注册表模式、发布约定）。
