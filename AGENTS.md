# pi-wingman — 项目上下文

> 项目指令与常用命令，供 AI 编码代理按任务需要查阅。

## 技术栈

- TypeScript（strict，ESM），pi 扩展：由 pi 的 jiti 运行时直接加载源码，无构建步骤，npm 包直接发布 `.ts` 源文件。
- 运行/测试用 Bun（`bun test`），类型检查用 `tsc`（typescript ^5.9）；pi SDK `@earendil-works/pi-coding-agent` 是 peerDependency。

## 导航

- 单包扁平仓库：`index.ts` 入口（命令注册 + 配置加载），`config.ts` 读写 `~/.pi/agent/wingman.json`。
- 共享层：`llm.ts` 旁路模型调用（`ctx.modelRegistry.complete()`，统一超时/AbortController），`audit.ts` 审计管线（digest → Verdict）。
- 功能层：`hint.ts`（M1，CustomEditor ghost text，Tab 填入 / Enter 发送）、`advisor.ts`（M2，turn 审计 + `deliverAs: "steer"` 注入）、`headsup.ts`（M3，去抖审计 + notify/widget 告警）。heads-up 与 advisor 复用 audit.ts，只差输出通道。

## 命令

- 安装依赖: `bun install`（或 `npm install`）
- 构建: 无构建步骤
- 测试: `bun test`
- 类型检查: `npm run typecheck`（`tsc --noEmit`）

## 工作流与陷阱

- `git push` 和 `npm publish` 须用户确认：包以 `@master.g/pi-wingman` 公开发布，发出去的版本无法撤回。
- 旁路 LLM 调用（headsup/advisor/hint）必须是只读非阻塞旁路：永不阻塞 `tool_call`，错误静默降级；idle 时 `ctx.signal` 不存在，用自有 AbortController，`session_shutdown` 统一 abort。
- 渲染出的每行宽度不得超过给定宽度：超宽会让 pi-tui 的 `doRender` 抛错并拖垮整个 pi 进程。
- widget 只通过工厂形式的 `ctx.ui.setWidget` 挂载一次，之后用 `tui.requestRender()` 更新：每次 `setWidget` 都会把 widget 移到 below-editor 栈底。
- advisor 用 steer 注入主 agent 时，注入消息必须打标：advisor 触发的 turn 不再触发 advisor，防循环。
- 发布前用 `npm pack --dry-run` 核对 tarball 内容。

## 代码风格

- 无 lint/formatter 配置；沿用 pi-usage-hud 风格：tab 缩进、双引号、分号，相对导入写 `.js` 后缀（`./config.js`）。
- 旁路调用失败统一返回结果对象（`ok: false` + reason），不抛异常到 pi 事件循环。
