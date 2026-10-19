import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFeatureArg, DEFAULT_CONFIG, loadConfig, type WingmanConfig } from "./config.js";

const fresh = (): WingmanConfig => JSON.parse(JSON.stringify(DEFAULT_CONFIG));

describe("applyFeatureArg", () => {
	test("无参只读状态,不改配置", () => {
		const config = fresh();
		const line = applyFeatureArg(config, "hint", "");
		expect(config.hint).toEqual({ enabled: false });
		expect(line).toContain("hint");
	});

	test("空白参数视为无参", () => {
		const config = fresh();
		applyFeatureArg(config, "advisor", "   ");
		expect(config.advisor).toEqual({ enabled: false });
	});

	test("off 关闭但保留模型,on 用原模型重新开启", () => {
		const config = fresh();
		applyFeatureArg(config, "headsup", "anthropic/claude-haiku");
		expect(applyFeatureArg(config, "headsup", "off")).toBe("headsup: off");
		expect(config.headsup).toEqual({ enabled: false, model: "anthropic/claude-haiku" });
		applyFeatureArg(config, "headsup", "on");
		expect(config.headsup).toEqual({ enabled: true, model: "anthropic/claude-haiku" });
	});

	test("provider/model 开启并设模型", () => {
		const config = fresh();
		const line = applyFeatureArg(config, "headsup", "anthropic/claude-haiku");
		expect(config.headsup).toEqual({ enabled: true, model: "anthropic/claude-haiku" });
		expect(line).toContain("anthropic/claude-haiku");
	});

	test("effort 随模型设置,on/off 保留,换模型不带 effort 即清空", () => {
		const config = fresh();
		expect(applyFeatureArg(config, "advisor", "openai/gpt-5", "high")).toBe("advisor: on (openai/gpt-5 · high)");
		applyFeatureArg(config, "advisor", "off");
		applyFeatureArg(config, "advisor", "on");
		expect(config.advisor).toEqual({ enabled: true, model: "openai/gpt-5", effort: "high" });
		applyFeatureArg(config, "advisor", "openai/gpt-5-mini");
		expect(config.advisor.effort).toBeUndefined();
	});
});

describe("loadConfig", () => {
	test("文件内容不是对象(null/数组/损坏)时回退默认配置", () => {
		const dir = mkdtempSync(join(tmpdir(), "wingman-"));
		for (const content of ["null", "[1]", "{oops"]) {
			const path = join(dir, "wingman.json");
			writeFileSync(path, content);
			expect(loadConfig(path)).toEqual(DEFAULT_CONFIG);
		}
	});

	test("合法 effort 读入,非法 effort 丢弃", () => {
		const path = join(mkdtempSync(join(tmpdir(), "wingman-")), "wingman.json");
		writeFileSync(path, JSON.stringify({ advisor: { enabled: true, model: "p/m", effort: "low" }, hint: { effort: "turbo" } }));
		const config = loadConfig(path);
		expect(config.advisor.effort).toBe("low");
		expect(config.hint.effort).toBeUndefined();
	});
});
