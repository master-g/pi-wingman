/**
 * index.ts — pi-wingman 入口。
 *
 * 当前为骨架：注册命令与配置。三个功能控制器在后续里程碑接入：
 *   M1 hint.ts（下一步 prompt 建议，CustomEditor ghost text）
 *   M2 advisor.ts（指定模型顾问，turn 审计 + steer 注入）
 *   M3 headsup.ts（工作中自动审计，notify + widget 告警）
 * llm.ts / audit.ts 是三者共享的旁路调用与审计管线。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig, type WingmanConfig } from "./config.js";

function featureLine(name: string, f: { enabled: boolean; model?: string }): string {
	const state = f.enabled ? `on (${f.model ?? "current model"})` : "off";
	return `${name}: ${state}`;
}

export default function (pi: ExtensionAPI) {
	let config: WingmanConfig = loadConfig();

	pi.registerCommand("wingman", {
		description: "Show wingman status (headsup / advisor / hint)",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				[
					"wingman",
					featureLine("headsup", config.headsup),
					featureLine("advisor", config.advisor),
					featureLine("hint", config.hint),
				].join(" · "),
				"info",
			);
		},
	});

	pi.registerCommand("advisor", {
		description: "Set the advisor model: /advisor <provider/model> | off",
		handler: async (args, ctx) => {
			const model = args.trim();
			if (!model) {
				ctx.ui.notify(`advisor — ${featureLine("advisor", config.advisor)}`, "info");
				return;
			}
			config.advisor = model === "off" ? { enabled: false } : { enabled: true, model };
			saveConfig(config);
			ctx.ui.notify(`advisor — ${featureLine("advisor", config.advisor)}`, "info");
		},
	});

	pi.on("session_start", async () => {
		config = loadConfig();
	});
}
