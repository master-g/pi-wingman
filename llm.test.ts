import { describe, expect, test } from "bun:test";
import { completeText, resolveModel, type AnyModel, type ModelRegistry } from "./llm.js";

const fakeModel = (id: string) => ({ id }) as unknown as AnyModel;

function fakeRegistry(overrides: {
	find?: (provider: string, modelId: string) => AnyModel | undefined;
	complete?: (...args: unknown[]) => Promise<unknown>;
}): ModelRegistry {
	return {
		find: overrides.find ?? (() => undefined),
		complete: overrides.complete ?? (async () => ({ stopReason: "stop", content: [] })),
	} as unknown as ModelRegistry;
}

describe("resolveModel", () => {
	const fallback = fakeModel("current");
	const found = fakeModel("anthropic/claude-haiku");

	test("未配置 spec 时回退当前模型", () => {
		expect(resolveModel(fakeRegistry({}), undefined, fallback)).toBe(fallback);
	});

	test("provider/model-id 命中时用找到的模型", () => {
		const registry = fakeRegistry({ find: () => found });
		expect(resolveModel(registry, "anthropic/claude-haiku", fallback)).toBe(found);
	});

	test("找不到或格式非法时回退", () => {
		const registry = fakeRegistry({ find: () => undefined });
		expect(resolveModel(registry, "anthropic/missing", fallback)).toBe(fallback);
		expect(resolveModel(registry, "noid", fallback)).toBe(fallback);
		expect(resolveModel(registry, "/id", fallback)).toBe(fallback);
		expect(resolveModel(registry, "provider/", fallback)).toBe(fallback);
	});
});

describe("completeText", () => {
	const registry = (complete: (...args: unknown[]) => Promise<unknown>) =>
		fakeRegistry({ complete });

	test("stop + 文本块拼接为 ok", async () => {
		const r = await completeText(
			registry(async () => ({
				stopReason: "stop",
				content: [
					{ type: "text", text: "第一行" },
					{ type: "thinking", thinking: "忽略" },
					{ type: "text", text: "第二行" },
				],
			})),
			fakeModel("m"),
			{ messages: [] },
		);
		expect(r).toEqual({ ok: true, text: "第一行\n第二行" });
	});

	test("stopReason 非 stop 为失败", async () => {
		const r = await completeText(
			registry(async () => ({ stopReason: "error", content: [] })),
			fakeModel("m"),
			{ messages: [] },
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toContain("error");
	});

	test("空文本为失败", async () => {
		const r = await completeText(
			registry(async () => ({ stopReason: "stop", content: [{ type: "text", text: "  " }] })),
			fakeModel("m"),
			{ messages: [] },
		);
		expect(r).toEqual({ ok: false, reason: "empty response" });
	});

	test("抛异常不穿透,转为 ok:false", async () => {
		const r = await completeText(
			registry(async () => {
				throw new Error("network down");
			}),
			fakeModel("m"),
			{ messages: [] },
		);
		expect(r).toEqual({ ok: false, reason: "network down" });
	});
});
