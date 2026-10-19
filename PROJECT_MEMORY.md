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
- 激活语义:三功能默认全关(旁路有成本,用户定);advisor/heads-up 必须 enabled && model 且模型可解析才激活,拼错也不回退当前模型;hint 无 model 时回退当前模型(`/hint on`)——2026-10-19 审计修复。
- 配置入口对称:/advisor /hint /headsup 各接 `<model>`(先 registry 校验)/`on`/`off`(保留模型)/无参,共用 applyFeatureArg;编辑器安装归 EditorManager,条件 `hint.enabled || headsup.enabled`——2026-10-19。
- heads-up 旁路管线的唯一观测口是 `WINGMAN_DEBUG=1`(追加写 /tmp/wingman-debug.log):pty 烟测靠它确认了聚合/去抖两路 flush 与 ok/note 门控静默;真实 concern 上屏未实测(审计总能正确判 ok/note,难以稳定诱发)——2026-10-19。
- /new、/resume、/fork、reload 都重建 runtime 并重新执行扩展工厂(loader.js initializeExtension),工厂内状态天然按会话隔离,session_start 里重置状态是多余的——2026-10-19 读 SDK dist 核实。
- advisor 防循环按注入文本识别:message_end 见带 ADVISOR_MARKER 的 user 消息→下一 turn_end 跳过;审计后台跑,裁决回来时 `ctx.isIdle()` 则只 notify 不 steer(顾问不自行唤醒 agent)——2026-10-19 用户决定。
- CustomEditor 构造参数里的 keybindings 是 app 键位;输入键位(tui.input.tab/submit)要用 pi-tui 的 `getKeybindings()`,与基类编辑器一致——2026-10-19 读 editor.js 核实。

## 失败尝试

<!-- 追加：走不通的路径及原因，每条一行。 -->

- 不用 `pi.registerShortcut` 绑 Tab 做 hint 接受：会与编辑器补全/默认行为冲突且无法条件触发——否决于 2026-10-19 方案调研，改走 CustomEditor。

## 上次会话

<!-- 整块改写：分支、验证命令及实际结果、停在何处；接下来做什么。 -->

- [2026-10-19] main:按 pi 扩展规范 + TS 写法审计全仓,修复 13 项(旁路不再阻塞事件循环、拼错模型不回退、tarball 加 files、getAgentDir、冷却期不丢事件、目标统一捕获、keybindings/theme、role 收窄去重等)。验证:`bun test` 58 过、`npm run typecheck` 干净、`npm pack --dry-run` 仅源码+README+LICENSE、print 模式加载无报错。未推送未发布。

## 下次运行

<!-- 整块改写：接下来的任务和优先级，含仍受阻的项。 -->

- [2026-10-19] 1) 推送(需用户确认);2) 可选 `npm publish`(需确认,先 `npm pack --dry-run`);3) 真实 pi 里试用:后台 advisor 的 steer 时机与 idle 只提示体感、hint 过期丢弃、heads-up widget 主题色与数字键手感;WINGMAN_DEBUG=1 日志现在在 os.tmpdir()。
