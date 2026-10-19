# pi-wingman

[pi](https://github.com/earendil-works/pi) 的僚机扩展：主 agent 干活时替你把关、参谋、想下一步。

三个功能（均可独立开关，模型各自可配）：

| 功能 | 参照 | 说明 |
|---|---|---|
| **heads-up** | — | 主 agent 工作时后台自动审计，提前发现潜在问题，notify + widget 告警给用户（只读旁路，不阻塞、不注入） |
| **advisor** | oh-my-pi advisor | 指定一个模型当顾问，读主 agent 的每个 turn，以 steer 消息内联注入便签（aside / concern / blocker）让主 agent 纠偏 |
| **hint** | Claude Code prompt suggestions | 任务结束后按上下文与目标生成下一步 prompt，输入框 ghost text 呈现：Tab 填入、Enter 直接发送 |

> 状态：早期版本（v0.0.4）。hint、advisor、heads-up 三个功能均已实现，默认关闭，尚在试用打磨中。

## 安装

```bash
pi install npm:@master.g/pi-wingman
```

开发中本地加载：

```bash
pi --extension ~/github/pi-wingman/index.ts
```

## 命令

- `/wingman` — 查看三个功能的状态与模型
- `/wingman advisor|hint|headsup` — 不带值时弹出 pi 的模型选择器（同 `/model`，可搜索），选完模型再选思考强度（同 `/thinking`，Esc 跳过）；也可直接写 `<provider/model> [effort]`（模型须存在，effort 须是该模型支持的档位）、`on` / `off`（开关，保留已设模型与 effort）；参数支持补全
- `/ask-advisor <问题>` — 就当前上下文咨询顾问模型，回答注入对话

advisor 与 heads-up 审计通过（ok）时不打扰，只在底栏状态显示 `advisor ⋯`（审计中）、`advisor ✓ ok`（结果级别）或 `advisor ✗ 原因`（调用失败）；hint 生成中显示 `hint ⋯`，失败显示 `hint ✗ 原因`，成功后 hint 直接出现在输入行；自定义 footer 扩展需要自己渲染扩展状态才看得到。

## 配置

`<agentDir>/wingman.json`（默认 `~/.pi/agent/wingman.json`），由命令自动写入，也可手改：

```json
{
	"headsup": { "enabled": false },
	"advisor": { "enabled": true, "model": "openai-codex/gpt-5.5", "effort": "low" },
	"hint": { "enabled": false }
}
```

三个功能默认都关闭：每个功能都会额外调用模型，需要用户自己开启。模型形如 `provider/model-id`；hint 没配模型时用当前模型（`/wingman hint on`），advisor/heads-up 必须配模型才会激活。`effort` 可选（off / minimal / low / medium / high / xhigh / max，按模型支持的档位校正），不设则不开推理。advisor/heads-up 在后台跑，单次调用超时 60 秒；hint 超时 30 秒；hint 越快越有用，建议不设或用低 effort（实测 glm-5.3-flash 不设约 2 秒，max 要 6–14 秒）。

## License

MIT
