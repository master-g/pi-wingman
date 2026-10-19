# pi-wingman — 项目上下文

> 项目指令与常用命令，供 AI 编码代理按任务需要查阅。

## 技术栈

- TypeScript（strict，ESM），pi 扩展：由 pi 的 jiti 运行时直接加载源码，无构建步骤，npm 包直接发布 `.ts` 源文件。
- 运行/测试用 Bun（`bun test`），类型检查用 `tsc`（typescript ^5.9）；pi SDK `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-tui` 是 peerDependency。

## 导航

- 单包扁平仓库：`index.ts` 入口（命令注册 + 配置加载），`config.ts` 读写 `~/.pi/agent/wingman.json`。
- 共享层：`llm.ts` 旁路模型调用（`ctx.modelRegistry.streamSimple()` 以便传 effort，统一超时/AbortController），`audit.ts` 审计管线（digest → Verdict）。
- `editor.ts`：全扩展唯一的 `WingmanEditor`（`setEditorComponent` 只能装一个），hint 的内联 ghost 文本与 heads-up 的数字键共用；`EditorManager` 在 `hint.enabled || headsup.enabled` 时安装。
- `picker.ts`：`/wingman <feature>` 不带值时复用 pi 的 `ModelSelectorComponent` / `ThinkingSelectorComponent`。
- 功能层：`hint.ts`（M1，CustomEditor ghost text，Tab 填入 / Enter 发送）、`advisor.ts`（M2，turn 审计 + `deliverAs: "steer"` 注入）、`headsup.ts`（M3，去抖审计 + notify/widget 告警）。heads-up 与 advisor 复用 audit.ts，只差输出通道。

## 命令

- 安装依赖: `bun install`（或 `npm install`）
- 构建: 无构建步骤
- 测试: `bun test`
- 类型检查: `npm run typecheck`（`tsc --noEmit`）

## 工作流与陷阱

- `git push` 和 `npm publish` 须用户确认：包以 `@master.g/pi-wingman` 公开发布，发出去的版本无法撤回。
- 旁路 LLM 调用（headsup/advisor/hint）必须是只读非阻塞旁路：pi 串行 await 每个事件 handler（含 `turn_end`/`agent_end`/`tool_execution_end`），handler 里只能后台发起调用（`fn().catch(() => {})`，不能 await 或 return promise；脱离 runner 的 try/catch 后必须自己兜底，否则未处理 rejection 会拖垮进程）；错误静默降级；idle 时 `ctx.signal` 不存在，用自有 AbortController，`session_shutdown` 统一 abort。
- 渲染出的每行宽度不得超过给定宽度：超宽会让 pi-tui 的 `doRender` 抛错并拖垮整个 pi 进程。
- widget 只通过工厂形式的 `ctx.ui.setWidget` 挂载一次，之后用 `tui.requestRender()` 更新：每次 `setWidget` 都会把 widget 移到 below-editor 栈底。
- advisor 用 steer 注入主 agent 时，注入消息必须打标：advisor 触发的 turn 不再触发 advisor，防循环。
- 发布前用 `npm pack --dry-run` 核对 tarball 内容。

## 代码风格

- 无 lint/formatter 配置；沿用 pi-usage-hud 风格：tab 缩进、双引号、分号，相对导入写 `.js` 后缀（`./config.js`）。
- 旁路调用失败统一返回结果对象（`ok: false` + reason），不抛异常到 pi 事件循环。

## 禁止文件

- `bun.lock`、`package-lock.json`：由包管理器生成，不手改。
- `node_modules/`。
- `~/.pi/agent/wingman.json`：用户本地配置，由 `/wingman` 命令写入，不进仓库、不手改结构。

## 审查规则

- 无 CI；提交前本地跑 `bun test` 和 `npm run typecheck`，测试与源文件同目录（`*.test.ts`）。
- 提交信息用 Conventional Commits（`feat:` / `fix(scope):` / `chore:`），描述中英文均可。

## 项目记忆 (回写约定)

跨会话的持久信息记录在 [PROJECT_MEMORY.md](./PROJECT_MEMORY.md)，只写代码、Git 和文档推导不出的内容。

收尾顺序：验证 → 回写记忆 → 提交 → 推送。回写与本次改动进同一个提交；不提交的任务在结束前回写。

回写是提炼，不是记录：

- 「上次会话」「下次运行」整节改写成一块（分支、验证命令与实际结果、停在何处；接下来做什么），旧块直接删，历史由 Git 保存。
- 本次确认的决策追加到「已验证的事实」，走不通的路径及原因追加到「失败尝试」；每条一行，写结论、原因和来源或适用范围。能从 `git log`、代码或计划文档 30 秒内推出来的（commit SHA、进度状态、计划内容）不写，只留一行指向证据目录。
- 同主题已有条目就改写它，不追加；结论被推翻就删旧条。写不进两行的长期知识搬进 docs/ 后只留一行指针；反复出现或每次会话都要先知道的陷阱，晋升到本文件「工作流与陷阱」后从记忆里删掉。
- 结束前核对门槛：全文 ≤ 24 KB，单行 ≤ 300 字符，改写节各一块。装了 bootstrap-claude 技能的会话用它的 `scripts/memory.py check` 校验，`compact` 只压改写节；追加节条目由人合并或搬出，脚本不自动删。

<!-- bootstrap-claude convention v3 -->

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `master-g/pi-wingman`, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
