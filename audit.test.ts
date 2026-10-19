import { describe, expect, test } from "bun:test";
import { Auditor, buildDigest, parseVerdict, type DigestMessage } from "./audit.js";
import type { AnyModel, ModelRegistry } from "./llm.js";

/** 测试夹具只填 digest 关心的字段,鸭式转型为完整 Message。 */
const msg = (m: unknown): DigestMessage => m as DigestMessage;

const fakeModel = { id: "audit-model" } as unknown as AnyModel;

function registryReturning(text: string): ModelRegistry {
	return {
		find: () => undefined,
		complete: async () => ({
			stopReason: "stop",
			content: [{ type: "text", text }],
		}),
	} as unknown as ModelRegistry;
}

describe("buildDigest", () => {
	test("用户与助手消息带 role 前缀,截断超长正文", () => {
		const digest = buildDigest([
			msg({ role: "user", content: [{ type: "text", text: "把测试修好" }] }),
			msg({ role: "assistant", content: [{ type: "text", text: "x".repeat(1000) }] }),
		]);
		const lines = digest.split("\n");
		expect(lines[0]).toBe("[user] 把测试修好");
		expect(lines[1].startsWith("[assistant] ")).toBe(true);
		expect(lines[1].length).toBeLessThan(400);
	});

	test("助手的工具调用以 → 摘要,工具结果标注错误", () => {
		const digest = buildDigest([
			msg({
				role: "assistant",
				content: [
					{ type: "text", text: "先看下文件" },
					{ type: "toolCall", name: "read", arguments: { path: "a.ts" } },
				],
			}),
			msg({
				role: "toolResult",
				toolName: "read",
				isError: true,
				content: [{ type: "text", text: "file not found" }],
			}),
		]);
		expect(digest).toContain("→ read(");
		expect(digest).toContain("a.ts");
		expect(digest).toContain("[toolResult read] ERROR");
		expect(digest).toContain("file not found");
	});

	test("只取最近 maxMessages 条", () => {
		const messages = Array.from({ length: 20 }, (_, i) =>
			msg({
				role: "user",
				content: [{ type: "text", text: `msg-${i}` }],
			}),
		);
		const digest = buildDigest(messages, { maxMessages: 3 });
		expect(digest).not.toContain("msg-16");
		expect(digest).toContain("msg-19");
	});
});

describe("parseVerdict", () => {
	test("标准两行输出", () => {
		expect(parseVerdict("VERDICT: concern\nSUMMARY: 改错了文件")).toEqual({
			level: "concern",
			summary: "改错了文件",
			details: [],
		});
	});

	test("大小写与空白宽容", () => {
		const v = parseVerdict("verdict:   BLOCKER\nSummary: 正在删用户数据");
		expect(v?.level).toBe("blocker");
	});

	test("没有 VERDICT 行返回 undefined", () => {
		expect(parseVerdict("我觉得还行")).toBeUndefined();
	});

	test("缺 SUMMARY 时 summary 为空串", () => {
		expect(parseVerdict("VERDICT: ok")).toEqual({ level: "ok", summary: "", details: [] });
	});

	test("DETAILS 块解析为要点列表,最多 4 条", () => {
		const text =
			"VERDICT: blocker\nSUMMARY: 在删用户数据\nDETAILS:\n- 要点一\n- 要点二\n- 三\n- 四\n- 五(超出)\n无关行";
		const v = parseVerdict(text);
		expect(v?.details).toEqual(["要点一", "要点二", "三", "四"]);
	});

	test("没有 DETAILS 块时 details 为空数组", () => {
		expect(parseVerdict("VERDICT: note\nSUMMARY: 顺手改名")?.details).toEqual([]);
	});
});

describe("Auditor 冷却与互斥", () => {
	const input = { goal: "目标", digest: "摘要" };

	test("成功路径返回解析后的 Verdict", async () => {
		const auditor = new Auditor({ minIntervalMs: 1000, now: () => 0 });
		const v = await auditor.run(registryReturning("VERDICT: note\nSUMMARY: 可以顺手改名"), fakeModel, input);
		expect(v).toEqual({ level: "note", summary: "可以顺手改名", details: [] });
	});

	test("冷却期内跳过", async () => {
		let now = 0;
		const auditor = new Auditor({ minIntervalMs: 1000, now: () => now });
		await auditor.run(registryReturning("VERDICT: ok"), fakeModel, input);
		now = 500;
		expect(await auditor.run(registryReturning("VERDICT: ok"), fakeModel, input)).toBeUndefined();
		now = 1001;
		expect(await auditor.run(registryReturning("VERDICT: ok"), fakeModel, input)).toBeDefined();
	});

	test("并发调用只放行一个", async () => {
		let resolveFirst!: (v: unknown) => void;
		let calls = 0;
		const registry = {
			find: () => undefined,
			complete: async () => {
				calls++;
				if (calls === 1) {
					return new Promise((r) => {
						resolveFirst = r;
					});
				}
				return { stopReason: "stop", content: [{ type: "text", text: "VERDICT: ok" }] };
			},
		} as unknown as ModelRegistry;
		const auditor = new Auditor({ minIntervalMs: 0, now: () => 0 });
		const first = auditor.run(registry, fakeModel, input);
		const second = auditor.run(registry, fakeModel, input);
		expect(await second).toBeUndefined();
		resolveFirst({ stopReason: "stop", content: [{ type: "text", text: "VERDICT: ok" }] });
		await first;
		expect(calls).toBe(1);
	});

	test("模型调用失败返回 undefined 且解除互斥", async () => {
		const failing = {
			find: () => undefined,
			complete: async () => {
				throw new Error("boom");
			},
		} as unknown as ModelRegistry;
		const auditor = new Auditor({ minIntervalMs: 0, now: () => 0 });
		expect(await auditor.run(failing, fakeModel, input)).toBeUndefined();
		expect(await auditor.run(registryReturning("VERDICT: ok"), fakeModel, input)).toBeDefined();
	});
});
