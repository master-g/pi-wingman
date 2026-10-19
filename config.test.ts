import { describe, expect, test } from "bun:test";
import { applyFeatureArg, DEFAULT_CONFIG, type WingmanConfig } from "./config.js";

const fresh = (): WingmanConfig => JSON.parse(JSON.stringify(DEFAULT_CONFIG));

describe("applyFeatureArg", () => {
	test("无参只读状态,不改配置", () => {
		const config = fresh();
		const line = applyFeatureArg(config, "hint", "");
		expect(config.hint).toEqual({ enabled: true });
		expect(line).toContain("hint");
	});

	test("空白参数视为无参", () => {
		const config = fresh();
		applyFeatureArg(config, "advisor", "   ");
		expect(config.advisor).toEqual({ enabled: false });
	});

	test("off 关闭并清掉模型", () => {
		const config = fresh();
		applyFeatureArg(config, "headsup", "anthropic/claude-haiku");
		applyFeatureArg(config, "headsup", "off");
		expect(config.headsup).toEqual({ enabled: false });
	});

	test("provider/model 开启并设模型", () => {
		const config = fresh();
		const line = applyFeatureArg(config, "headsup", "anthropic/claude-haiku");
		expect(config.headsup).toEqual({ enabled: true, model: "anthropic/claude-haiku" });
		expect(line).toContain("anthropic/claude-haiku");
	});
});
