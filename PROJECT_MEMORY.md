# 项目记忆 — pi-wingman

> 跨会话的持久信息，只记代码、Git 和文档推导不出的内容。回写约定见 [AGENTS.md](./AGENTS.md)。
> 门槛：全文 ≤ 24 KB，单行 ≤ 300 字符；改写节各只留一块。

## 已验证的事实

<!-- 追加：确认过的决策和约束，每条一行：结论 + 原因 + 来源。同主题改写既有条目，不追加第二条。 -->

- 命名 pi-wingman：npm 上 pi-sidekick/pi-radar/pi-nudge/pi-whisper 均已被 pi 生态占用（sidekick 还是第二模型委派，概念撞车），@master.g/pi-wingman 空闲——2026-10-19 逐个 `npm view` 核实。
- heads-up 与 advisor 共享 audit.ts 审计管线，仅输出通道不同：heads-up 只 notify/widget 告警给用户，advisor 以 `deliverAs: "steer"` 注入主 agent——参照 oh-my-pi advisor 设计，用户确认。
- hint 的 Tab/Enter 接受交互走 CustomEditor 子类（`ctx.ui.setEditorComponent` + 按键转发基类），对齐 Claude Code prompt suggestions：Tab 填入可编辑、Enter 直接发送、任意按键清除——依据 pi-tui types 与 border-status-editor.ts 示例。
- 旁路模型调用统一经 llm.ts 封装 `ctx.modelRegistry.complete()`/`streamSimple()`；idle 时 `ctx.signal` 不存在，用自有 AbortController，session_shutdown 统一 abort——依据 extensions.md 与 model-registry.d.ts。

## 失败尝试

<!-- 追加：走不通的路径及原因，每条一行。 -->

- 不用 `pi.registerShortcut` 绑 Tab 做 hint 接受：会与编辑器补全/默认行为冲突且无法条件触发——否决于 2026-10-19 方案调研，改走 CustomEditor。

## 上次会话

<!-- 整块改写：分支、验证命令及实际结果、停在何处；接下来做什么。 -->

- [2026-10-19] main 分支：骨架建仓完成（github.com/master-g/pi-wingman，public）；bootstrap-claude 已初始化（CLAUDE.md 指针 + 本记忆 + AGENTS.md 禁止文件/审查规则节）。验证：`bun install` 后 `npm run typecheck` 通过；测试未写（骨架无逻辑）。移交蓝图在 [HANDOFF.md](./HANDOFF.md)。停在：配置与 `/wingman`、`/advisor` 命令可用，三个功能控制器为桩；未在真实 pi 中加载验证过。

## 下次运行

<!-- 整块改写：接下来的任务和优先级，含仍受阻的项。 -->

- [2026-10-19] 按 [HANDOFF.md](./HANDOFF.md) 走：先 `pi --extension ./index.ts` 验证骨架加载，再做 M1 hint（llm.ts 封装 + HintEditor ghost text，Tab/Enter 接受）；之后 M2 advisor、M3 heads-up。
