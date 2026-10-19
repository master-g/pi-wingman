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
 * 模型（须能在 modelRegistry 解析）、on/off 开关（保留模型）、无参看状态；
 * /wingman 总览。用户目标在此统一捕获，跳过 advisor 注入的旁注，供三个
 * 功能共用。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAdvisor, isAdvisorNote } from "./advisor.js";
import { applyFeatureArg, featureLine, loadConfig, saveConfig, type WingmanConfig } from "./config.js";
import { EditorManager } from "./editor.js";
import { installHeadsUp } from "./headsup.js";
import { installHint } from "./hint.js";
import { resolveModel, type ModelRegistry } from "./llm.js";

export default function (pi: ExtensionAPI) {
	let config: WingmanConfig = loadConfig();
	let goal = "";
	/** 参数补全拿不到 ctx,在 session_start 记下 registry。 */
	let registry: ModelRegistry | undefined;
	const editors = new EditorManager();
	const getConfig = () => config;
	const getGoal = () => goal;

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
			description: `Configure wingman ${feature}: /${feature} <provider/model> | on | off`,
			getArgumentCompletions: (prefix) => {
				const models = registry?.getAvailable().map((m) => `${m.provider}/${m.id}`) ?? [];
				const items = ["on", "off", ...models]
					.filter((value) => value.startsWith(prefix))
					.map((value) => ({ value, label: value }));
				return items.length > 0 ? items : null;
			},
			handler: async (args, ctx) => {
				const value = args.trim();
				if (value && value !== "on" && value !== "off" && !resolveModel(ctx.modelRegistry, value, undefined)) {
					ctx.ui.notify(`wingman · 找不到模型 ${value}(格式 provider/model-id)`, "error");
					return;
				}
				if (value === "on" && feature !== "hint" && !config[feature].model) {
					ctx.ui.notify(`wingman · ${feature} 需要模型,先 /${feature} <provider/model>`, "error");
					return;
				}
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
		registry = ctx.modelRegistry;
		editors.sync(ctx, config);
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType === "user" && !isAdvisorNote(event.prompt)) goal = event.prompt;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		editors.teardown(ctx);
	});

	installHint(pi, getConfig, getGoal, editors);
	installAdvisor(pi, getConfig, getGoal);
	installHeadsUp(pi, getConfig, getGoal, editors);
}
