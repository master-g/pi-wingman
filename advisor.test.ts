import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ADVISOR_MARKER, AdvisorState, formatAdvisorNote, installAdvisor, isAdvisorNote } from "./advisor.js";
import type { WingmanConfig } from "./config.js";

describe("isAdvisorNote / formatAdvisorNote", () => {
	test("标记前缀识别", () => {
		expect(isAdvisorNote(`${ADVISOR_MARKER} · 旁注] concern: 改错了`)).toBe(true);
		expect(isAdvisorNote("用户的正常 prompt")).toBe(false);
	});

	test("注入格式:标记 + 级别 + 一句话", () => {
		const note = formatAdvisorNote({ level: "concern", summary: "改错了文件" });
		expect(isAdvisorNote(note)).toBe(true);
		expect(note).toContain("concern: 改错了文件");
	});
});

describe("AdvisorState 防循环", () => {
	test("普通 user 消息不影响审计", () => {
		const state = new AdvisorState();
		state.onUserMessage("把 M2 做完");
		expect(state.shouldAuditTurn()).toBe(true);
	});

	test("旁注 user 消息进入 transcript 后,响应它的 turn 跳过审计,之后恢复", () => {
		const state = new AdvisorState();
		state.onUserMessage(formatAdvisorNote({ level: "concern", summary: "改错了文件" }));
		expect(state.shouldAuditTurn()).toBe(false);
		expect(state.shouldAuditTurn()).toBe(true);
	});

	test("/ask-advisor 问答注入同样打标跳过", () => {
		const state = new AdvisorState();
		state.onUserMessage(`${ADVISOR_MARKER} · 问答] 问:x\n答:y`);
		expect(state.shouldAuditTurn()).toBe(false);
	});
});

describe("installAdvisor 后台审计", () => {
	function harness(idle: boolean, response: unknown = { stopReason: "stop", content: [{ type: "text", text: "VERDICT: concern\nSUMMARY: 改错了文件" }] }) {
		const handlers = new Map<string, (event: never, ctx: never) => unknown>();
		const steered: string[] = [];
		const notified: string[] = [];
		const statuses: (string | undefined)[] = [];
		const pi = {
			on: (event: string, handler: never) => handlers.set(event, handler),
			registerCommand: () => {},
			sendUserMessage: (text: string) => steered.push(text),
		} as unknown as ExtensionAPI;
		const ctx = {
			modelRegistry: {
				find: () => ({ id: "p/m" }),
				streamSimple: () => ({ result: async () => response }),
			},
			isIdle: () => idle,
			ui: { notify: (text: string) => notified.push(text), setStatus: (_key: string, text?: string) => statuses.push(text) },
		};
		const config: WingmanConfig = {
			headsup: { enabled: false },
			advisor: { enabled: true, model: "p/m" },
			hint: { enabled: false },
		};
		installAdvisor(pi, () => config, () => "目标");
		const turnEnd = {
			message: { role: "assistant", content: [{ type: "text", text: "改 a.ts" }] },
			toolResults: [],
		} as never;
		return { onTurnEnd: () => handlers.get("turn_end")!(turnEnd, ctx as never), steered, notified, statuses };
	}
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	test("turn_end 不等审计;agent 仍在运行时 steer 注入并提示", async () => {
		const h = harness(false);
		expect(h.onTurnEnd()).toBeUndefined(); // 同步返回,不把审计 promise 交给 pi
		await settle();
		expect(h.notified[0]).toContain("改错了文件");
		expect(isAdvisorNote(h.steered[0] ?? "")).toBe(true);
	});

	test("裁决迟到(agent 已 idle):只提示,不注入", async () => {
		const h = harness(true);
		h.onTurnEnd();
		await settle();
		expect(h.notified.length).toBe(1);
		expect(h.steered.length).toBe(0);
	});

	test("审计 ok 不打扰,但底栏状态显示审计中与结果", async () => {
		const h = harness(false, { stopReason: "stop", content: [{ type: "text", text: "VERDICT: ok" }] });
		h.onTurnEnd();
		await settle();
		expect(h.notified.length).toBe(0);
		expect(h.statuses).toEqual(["advisor ⋯", "advisor ✓ ok"]);
	});

	test("调用失败在底栏显示原因", async () => {
		const h = harness(false, { stopReason: "error", errorMessage: "rate limited", content: [] });
		h.onTurnEnd();
		await settle();
		expect(h.statuses.at(-1)).toBe("advisor ✗ stopReason=error: rate limited");
	});
});
