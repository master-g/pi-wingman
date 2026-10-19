/**
 * index.ts — pi-wingman 入口。
 *
 * M1 hint.ts(下一步 prompt 建议)、M2 advisor.ts(turn 审计 + steer 注入)、
 * M3 headsup.ts(去抖审计 + widget 三态交互)已接入。
 * editor.ts 的 EditorManager 统一管理共享 WingmanEditor 的安装(hint 或
 * headsup 任一开启即装);llm.ts 是共享旁路调用层,audit.ts 是 M2/M3
 * 共享的审计管线。
 *
 * 配置入口对称：/advisor、/hint、/headsup 各接 <provider/model> 开启并设
 * 模型、off 关闭、无参看状态；/wingman 总览。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAdvisor } from "./advisor.js";
import { applyFeatureArg, featureLine, loadConfig, saveConfig, type WingmanConfig } from "./config.js";
import { EditorManager } from "./editor.js";
import { installHeadsUp } from "./headsup.js";
import { installHint } from "./hint.js";

export default function (pi: ExtensionAPI) {
	let config: WingmanConfig = loadConfig();
	const editors = new EditorManager();

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

	for (const feature of ["advisor", "hint", "headsup"] as const) {
		pi.registerCommand(feature, {
			description: `Configure wingman ${feature}: /${feature} <provider/model> | off`,
			handler: async (args, ctx) => {
				const line = applyFeatureArg(config, feature, args);
				if (args.trim()) {
					saveConfig(config);
					editors.sync(ctx, config);
				}
				ctx.ui.notify(`wingman · ${line}`, "info");
			},
		});
	}

	pi.on("session_start", (_event, ctx) => {
		config = loadConfig();
		editors.sync(ctx, config);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		editors.teardown(ctx);
	});

	installHint(pi, () => config, editors);
	installAdvisor(pi, () => config);
	installHeadsUp(pi, () => config, editors);
}
