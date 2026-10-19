/**
 * index.ts — pi-wingman 入口。
 *
 * M1 hint.ts(下一步 prompt 建议)、M2 advisor.ts(turn 审计 + steer 注入)、
 * M3 headsup.ts(去抖审计 + widget 三态交互)已接入。
 * editor.ts 的 EditorManager 统一管理共享 WingmanEditor 的安装(hint 或
 * headsup 任一开启即装);llm.ts 是共享旁路调用层,audit.ts 是 M2/M3
 * 共享的审计管线。
 *
 * 配置集中在 /wingman：无参看总览；/wingman <feature> 接 <provider/model>
 * [effort] 开启并设模型（须能在 modelRegistry 解析，effort 须是该模型支持
 * 的档位）、on/off 开关（保留模型）；不带值时 TUI 里弹 pi 的模型与思考
 * 强度选择器，其他模式只看该功能状态。用户目标在此统一捕获，跳过 advisor 注入的旁注，供三个
 * 功能共用。
 */

import { getSupportedThinkingLevels, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAdvisor, isAdvisorNote } from "./advisor.js";
import { applyFeatureArg, featureLine, isEffort, loadConfig, saveConfig, type WingmanConfig } from "./config.js";
import { EditorManager } from "./editor.js";
import { installHeadsUp } from "./headsup.js";
import { installHint } from "./hint.js";
import { resolveModel, type ModelRegistry } from "./llm.js";
import { pickModel, type Picked } from "./picker.js";

export default function (pi: ExtensionAPI) {
	let config: WingmanConfig = loadConfig();
	let goal = "";
	/** 参数补全拿不到 ctx,在 session_start 记下 registry。 */
	let registry: ModelRegistry | undefined;
	const editors = new EditorManager();
	const getConfig = () => config;
	const getGoal = () => goal;

	const features = ["advisor", "hint", "headsup"] as const;
	type Feature = (typeof features)[number];
	const isFeature = (name: string | undefined): name is Feature => features.includes(name as Feature);

	const usage = "/wingman <advisor|hint|headsup> [<provider/model> [effort] | on | off]";

	pi.registerCommand("wingman", {
		description: `Wingman status, or configure: ${usage}`,
		getArgumentCompletions: (prefix) => {
			const [feature, value, effort, ...rest] = prefix.trimStart().split(/\s+/);
			if (rest.length > 0) return null;
			if (value === undefined) {
				const items = features
					.filter((name) => name.startsWith(feature ?? ""))
					.map((name) => ({ value: `${name} `, label: name }));
				return items.length > 0 ? items : null;
			}
			if (!isFeature(feature)) return null;
			if (effort !== undefined) {
				const model = registry && resolveModel(registry, value, undefined);
				if (!model) return null;
				const items = getSupportedThinkingLevels(model)
					.filter((level) => level.startsWith(effort))
					.map((level) => ({ value: `${feature} ${value} ${level}`, label: level }));
				return items.length > 0 ? items : null;
			}
			const models = registry?.getAvailable().map((m) => `${m.provider}/${m.id}`) ?? [];
			const items = ["on", "off", ...models]
				.filter((option) => option.startsWith(value))
				.map((option) => ({ value: `${feature} ${option}`, label: option }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const [feature, arg = "", effortArg, ...extra] = args.trim().split(/\s+/).filter(Boolean);
			if (feature === undefined) {
				ctx.ui.notify(
					["wingman", ...features.map((name) => featureLine(name, config[name]))].join(" · "),
					"info",
				);
				return;
			}
			const isSwitch = arg === "on" || arg === "off";
			if (!isFeature(feature) || extra.length > 0 || (effortArg !== undefined && isSwitch)) {
				ctx.ui.notify(`wingman · 用法 ${usage}`, "error");
				return;
			}
			let value = arg;
			let effort: ModelThinkingLevel | undefined;
			if (!value && ctx.mode === "tui") {
				let picked: Picked | undefined;
				try {
					picked = await pickModel(ctx, config[feature]);
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`wingman · 选择器不可用(${reason}),改用 /wingman ${feature} <provider/model> [effort]`, "error");
					return;
				}
				if (!picked) return;
				value = `${picked.model.provider}/${picked.model.id}`;
				effort = picked.effort;
			} else if (value && !isSwitch) {
				const model = resolveModel(ctx.modelRegistry, value, undefined);
				if (!model) {
					ctx.ui.notify(`wingman · 找不到模型 ${value}(格式 provider/model-id)`, "error");
					return;
				}
				if (effortArg !== undefined) {
					const levels = getSupportedThinkingLevels(model);
					if (!isEffort(effortArg) || !levels.includes(effortArg)) {
						ctx.ui.notify(`wingman · ${value} 支持的 effort:${levels.join(" / ")}`, "error");
						return;
					}
					effort = effortArg;
				}
			}
			if (value === "on" && feature !== "hint" && !config[feature].model) {
				ctx.ui.notify(`wingman · ${feature} 需要模型,先 /wingman ${feature} <provider/model>`, "error");
				return;
			}
			const line = applyFeatureArg(config, feature, value, effort);
			if (value) {
				saveConfig(config);
				editors.sync(ctx, config);
			}
			ctx.ui.notify(`wingman · ${line}`, "info");
		},
	});

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
