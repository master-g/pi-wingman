# pi-wingman 移交文档（HANDOFF）

> 新会话开场：读 [PROJECT_MEMORY.md](./PROJECT_MEMORY.md)（决策与状态记忆）→ 本文件（实现蓝图）→ [AGENTS.md](./AGENTS.md)（命令与陷阱）。证据锚点见末节。

## 现状

- repo：https://github.com/master-g/pi-wingman（public），本地 `~/github/pi-wingman`，main 分支。
- 骨架已建仓并两次迭代:`config.ts` 读写 `~/.pi/agent/wingman.json`;`index.ts` 注册 `/wingman`(状态)+ 对称配置命令 `/advisor`、`/hint`、`/headsup`(`<provider/model>` 开 / `off` 关 / 无参看状态);`editor.ts` 的 EditorManager 统一管理共享 WingmanEditor(安装条件 `hint.enabled || headsup.enabled`,配置命令后立即 sync);`llm.ts`/`audit.ts`/`hint.ts`/`advisor.ts` 已实现,`headsup.ts` 仍为桩。
- 已验证：`bun install` 后 `npm run typecheck` 通过。
- 已验证(2026-10-19):print 模式 `pi --no-extensions -e ./index.ts --no-session -p "/advisor probe/test-model"` 全链路通过——扩展加载、斜杠命令派发(带参数)、配置读写均正常;typecheck 通过。未验:TUI 内 `ctx.ui.notify` 渲染(print 模式 notify 无可见输出但不报错)。

## 任务目标（三功能）

| 功能 | 参照 | 行为 | 输出通道 |
|---|---|---|---|
| heads-up | Claude Code heads-up | 主 agent 工作时后台去抖审计近期动作,提前发现潜在问题 | 只给用户:widget 三态交互(折叠→展开→拷进输入框),不自动注入主 agent |
| advisor | oh-my-pi advisor | 用户指定的模型读主 agent 每个 turn,产出 note/concern/blocker | 注入主 agent:`pi.sendUserMessage(note, { deliverAs: "steer" })`,同时 notify 用户 |
| hint | Claude Code prompt suggestions | `agent_end` 后按目标+上下文生成 1 条 ≤120 字符的下一步 prompt | CustomEditor ghost text：Tab 填入可编辑、Enter 直接发送、任意其他按键清除 |

heads-up 与 advisor 复用 `audit.ts` 审计管线（digest → Verdict），只差输出通道。

## 关键 API 事实（已核实）

证据位置：本 repo `node_modules/@earendil-works/pi-coding-agent/`（装依赖后才有）。

- 旁路调模型：`ctx.modelRegistry.complete(model, context, options)` / `streamSimple`（dist/core/model-registry.d.ts:39-40）。idle 时 `ctx.signal` 不存在，旁路调用用自有 AbortController，`session_shutdown` 统一 abort。
- 注入运行中的 agent：`pi.sendUserMessage(text, { deliverAs: "steer" })`（dist/core/extensions/types.d.ts:1267）。
- 事件：`before_agent_start`（含 `messageType` 与用户 `prompt`，hint 的"目标"来源）、`tool_execution_end`、`turn_end`（可返回 `continue: true`）、`agent_end`（hint 触发点）、`session_start` / `session_shutdown`。
- 输入框：`ctx.ui.setEditorText()` / `getEditorText()`（types.d.ts:135-137）。
- ghost text：`ctx.ui.setEditorComponent()` 安装 `CustomEditor` 子类，未拥有的按键转发基类（示例 `examples/extensions/border-status-editor.ts`、`modal-editor.ts`）。**不要**用 `pi.registerShortcut` 绑 Tab（与编辑器补全冲突，已否决）。
- 降级方案备件:`ctx.ui.addAutocompleteProvider(cur => wrapped)`(示例 `github-issue-autocomplete.ts`);heads-up 数字捕获不灵时用 `ctx.ui.select(title, options)` 模态选项框(types.d.ts:74)。
- widget：工厂形式 `ctx.ui.setWidget` 只挂一次，之后 `tui.requestRender()` 更新；重复 setWidget 会沉到 below-editor 栈底（pi-usage-hud/index.ts 头部注释）。
- 持久化:配置走 `config.ts`(wingman.json);需随会话分支走的状态用 `pi.appendEntry()`。
- 无头验证法:print 模式 `pi --no-extensions -e <ext> --no-session -p "/cmd args"` 会加载扩展并派发斜杠命令;扩展加载错误会在启动时打印;`ctx.ui.notify` 在 print 模式无输出不报错——用文件写入等副作用做探针。

## 里程碑与验收

**M1 hint**(已完成 2026-10-19)
1. `llm.ts`:resolveModel + completeText(超时/AbortController/失败返回结果对象),7 个单测。
2. `hint.ts`:WingmanEditor(hint 与 M3 共用)ghost 行 + Tab/Enter/清除状态机,5 个单测;agent_end 生成,静默降级。
3. 验收通过:tsc 干净、12 测试过、pty 烟测(script + printf 注入按键)实测 ghost 渲染与 Tab→Enter 提交(新 turn 启动)。
4. 学到的接口事实:无头测 CustomEditor 需 mock `tui.terminal.{rows,cols}` 与 `theme.borderColor`;ghost 用"输入行下方插一行"而非内联覆盖(shortcut 注释在代码里);hint 生成延迟 = agent_end 后几秒,用户已打字时 getText() 守卫自动不显示。

**M2 advisor**(已完成 2026-10-19):`audit.ts`(buildDigest + parseVerdict + runAudit + Auditor 冷却互斥)→ `advisor.ts`(turn_end 审计 → steer 注入;`/ask-advisor` 手动咨询)。验收:tsc 干净、30 测试全过、print 模式加载无错;两轴 code-review 无硬性违规。定名的决定:aside 统一为 note;`/ask-advisor` 答案以 steer 注入主会话(失败时 notify 报错,手动路径不静默)。防循环语义(AdvisorState):旁注 run 不更新用户目标、不审计;steer 被中断时跳过量在下一次真实 prompt 重置。未验:真实 TUI 里 steer 注入的体感与成本(冷却 60s 先挡)。

**M3 heads-up**(交互对齐 Claude Code heads-up 真实样例:折叠一句话 + `1: Learn more 2: Knew this already 0: Dismiss` → 展开标题+要点 + `1: Understood 2: Chat in main session 0: Dismiss` → 按 2 把格式化引用块拷进输入框)
1. 触发:`tool_execution_end` 聚合,去抖 ~8s 或每 6 次调用 → audit;只有 concern/blocker 上屏,ok/note 静默;错误静默降级,保留 last-good。
2. 折叠态:widget 显示 `✦ Heads up · <一句话>` + 选项行 `1: 展开  2: 已知悉  0: 忽略`。
3. 展开态(按 1):widget 换成标题 + 要点列表(每行 ≤ 渲染宽度,超宽会拖垮 pi-tui),选项变 `1: 知道了  2: 带到主会话  0: 忽略`。
4. 带到主会话(展开态按 2):`setEditorText()` 填入 `Here is a note offered by a side agent:` + `> ` 引用块,用户自己编辑/发送——不自动注入。
5. 按键捕获:仅编辑器为空时 0/1/2 是命令,其余按键照常输入、不动 widget。与 hint 的 Tab/Enter 合进同一个 WingmanEditor(setEditorComponent 全局只能装一个)。
6. 抑制:0/2 都把 finding digest 记入本会话抑制集,同一发现不再弹;v1 两者语义相同(预留按类别抑制)。

## 陷阱

- 旁路调用只读非阻塞：永不阻塞 `tool_call`；失败返回结果对象（`ok:false` + reason），不抛进 pi 事件循环。
- 渲染行宽不得超过给定宽度：超宽让 pi-tui `doRender` 抛错，拖垮整个 pi 进程。
- CustomEditor 未拥有的按键必须转发基类，恢复默认用 `setEditorComponent(undefined)`。
- advisor steer 注入必须打标,advisor 触发的 turn 不再触发 advisor(防循环)。
- `setEditorComponent` 全局只能装一个:hint(Tab/Enter)与 heads-up(数字键)必须合并为一个 WingmanEditor 状态机,不能各装各的。
- 激活语义:advisor/heads-up 必须 `enabled && model` 才激活(不回退当前模型,防双份成本);hint 无 model 时回退当前模型。
- 提交规范见 AGENTS.md 审查规则；`git push` / `npm publish` 须用户确认。

## 未验证点（实现时确认）

- heads-up 数字键与正常输入的边界:仅编辑器为空时捕获 0/1/2;用户打字中途弹出的 heads-up 不得抢键盘(M3 试出)。
- steer 注入在高频 turn 下的体感与成本（M2 用冷却 + 用户自选便宜模型兜底）。

## 证据锚点

- 调研来源：Claude Code prompt suggestions（ghost text + Tab 预填/Enter 发送/按键清除）、oh-my-pi advisor（reviewer 模型读 turn 内联注入便签）。
- 参考实现：`~/github/pi-usage-hud`（widget 生命周期、provider 注册表模式、发布约定）。
