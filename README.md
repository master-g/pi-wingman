# pi-wingman

[pi](https://github.com/earendil-works/pi) 的僚机扩展：主 agent 干活时替你把关、参谋、想下一步。

三个功能（均可独立开关，模型各自可配）：

| 功能 | 参照 | 说明 |
|---|---|---|
| **heads-up** | — | 主 agent 工作时后台自动审计，提前发现潜在问题，notify + widget 告警给用户（只读旁路，不阻塞、不注入） |
| **advisor** | oh-my-pi advisor | 指定一个模型当顾问，读主 agent 的每个 turn，以 steer 消息内联注入便签（aside / concern / blocker）让主 agent 纠偏 |
| **hint** | Claude Code prompt suggestions | 任务结束后按上下文与目标生成下一步 prompt，输入框 ghost text 呈现：Tab 填入、Enter 直接发送 |

> 状态：骨架（v0.0.1）。命令与配置已可用；三个控制器按 M1 hint → M2 advisor → M3 heads-up 接入。

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
- `/advisor`、`/hint`、`/headsup` — 各接 `<provider/model>`（开启并设模型，模型须存在）、`on` / `off`（开关，保留已设模型）、无参（看状态）；参数支持补全
- `/ask-advisor <问题>` — 就当前上下文咨询顾问模型，回答注入对话

## 配置

`<agentDir>/wingman.json`（默认 `~/.pi/agent/wingman.json`），由命令自动写入，也可手改：

```json
{
	"headsup": { "enabled": false },
	"advisor": { "enabled": true, "model": "openai-codex/gpt-5.5" },
	"hint": { "enabled": false }
}
```

三个功能默认都关闭：每个功能都会额外调用模型，需要用户自己开启。模型形如 `provider/model-id`；hint 没配模型时用当前模型（`/hint on`），advisor/heads-up 必须配模型才会激活。

## License

MIT
