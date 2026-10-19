/**
 * index.ts — pi-wingman 入口。
 *
 * M1 hint.ts（下一步 prompt 建议，WingmanEditor ghost text）已接入。
 * 后续里程碑：M2 advisor.ts（turn 审计 + steer 注入）、M3 headsup.ts
 * （去抖审计 + widget 三态交互）。llm.ts 是共享旁路调用层，audit.ts
 * 是 M2/M3 共享的审计管线。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig, type WingmanConfig } from "./config.js";
import { installHint } from "./hint.js";

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

	installHint(pi, () => config);
}
