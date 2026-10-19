# 项目记忆 — pi-wingman

> 跨会话的持久信息，只记代码、Git 和文档推导不出的内容。回写约定见 [AGENTS.md](./AGENTS.md)。
> 门槛：全文 ≤ 24 KB，单行 ≤ 300 字符；改写节各只留一块。

## 已验证的事实

<!-- 追加：确认过的决策和约束，每条一行：结论 + 原因 + 来源。同主题改写既有条目，不追加第二条。 -->

- 命名 pi-wingman：npm 上 pi-sidekick/pi-radar/pi-nudge/pi-whisper 均已被 pi 生态占用（sidekick 还是第二模型委派，概念撞车），@master.g/pi-wingman 空闲——2026-10-19 逐个 `npm view` 核实。
- heads-up 与 advisor 共享 audit.ts 审计管线，仅输出通道不同：heads-up 只 notify/widget 告警给用户，advisor 以 `deliverAs: "steer"` 注入主 agent——参照 oh-my-pi advisor 设计，用户确认。
- hint 的 Tab/Enter 接受交互走 CustomEditor 子类（`ctx.ui.setEditorComponent` + 按键转发基类），对齐 Claude Code prompt suggestions：Tab 填入可编辑、Enter 直接发送、任意按键清除——依据 pi-tui types 与 border-status-editor.ts 示例。
- 旁路模型调用统一经 llm.ts 封装 `ctx.modelRegistry.complete()`/`streamSimple()`;idle 时 `ctx.signal` 不存在,用自有 AbortController,session_shutdown 统一 abort——依据 extensions.md 与 model-registry.d.ts。
- 骨架/命令可无头验证:print 模式 `pi --no-extensions -e <ext> --no-session -p "/cmd args"` 会加载扩展并派发斜杠命令(加载错误直接打印),但 `ctx.ui.notify` 无可见输出,验证处理器要用文件写入等副作用探针——2026-10-19 用 throw 探针+文件探针双向核实。
- heads-up 交互对齐 Claude Code 真实样例:widget 三态(折叠一句话+1/2/0 选项 → 展开要点 → 按 2 用 setEditorText 拷进输入框),不自动注入主 agent;数字键仅编辑器为空时捕获,且与 hint 共用一个 WingmanEditor(setEditorComponent 全局限一个)——2026-10-19 用户提供的 claude-code 实际样例。
- 无头单测 CustomEditor:mock `tui.terminal.{rows,cols}`(render 读 terminal.rows)与 `theme.borderColor`(构造函数赋值)即可跑通 render/handleInput/onSubmit——2026-10-19 hint.test.ts 逐错误试出。
- 交互验收可用 pty 烟测:`( sleep; printf 'hi\r'; sleep 30; printf '\t'; … ) | script -q log pi -e ./index.ts --no-session`,从日志找 ghost 文本与新 turn 的 Working spinner 佐证;timeout 强杀收尾——2026-10-19 M1 实测有效。

## 失败尝试

<!-- 追加：走不通的路径及原因，每条一行。 -->

- 不用 `pi.registerShortcut` 绑 Tab 做 hint 接受：会与编辑器补全/默认行为冲突且无法条件触发——否决于 2026-10-19 方案调研，改走 CustomEditor。

## 上次会话

<!-- 整块改写：分支、验证命令及实际结果、停在何处；接下来做什么。 -->

- [2026-10-19] main 分支:M1 hint 完成——llm.ts(resolveModel + completeText)与 hint.ts(WingmanEditor ghost 行 + Tab/Enter/清除状态机 + agent_end 生成)实现并接线;12 测试全过、tsc 干净、pty 烟测实测 ghost 渲染与 Tab→Enter 提交。agent-skills 脚手架(docs/agents/*)也在本分支。移交蓝图在 [HANDOFF.md](./HANDOFF.md)。停在:M1 完成未推送,M2 advisor 未开始。

## 下次运行

<!-- 整块改写：接下来的任务和优先级，含仍受阻的项。 -->

- [2026-10-19] 按 [HANDOFF.md](./HANDOFF.md) 做 M2 advisor:audit.ts(buildDigest + runAudit,冷却互斥,Verdict: ok/note/concern/blocker)→ advisor.ts(turn_end 审计 → steer 注入,注入消息打标防循环;`/ask-advisor <问题>` 手动咨询);之后 M3 heads-up 复用 audit.ts 与 WingmanEditor 数字键位。本地 4 个提交未推送,push 需用户确认。
