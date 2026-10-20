import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WingmanConfig } from "./config.js";
import { EditorManager } from "./editor.js";
import { formatToolEvents, HeadsUpView, installHeadsUp } from "./headsup.js";
import type { ModelRegistry } from "./llm.js";

/** 透传主题:测试只关心文本,不关心颜色。 */
const theme = { fg: (_color: string, text: string) => text };
/** 让后台 flush(void,不 await)跑完。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const finding = {
	level: "concern" as const,
	summary: "在错误的文件里改",
	details: ["改的是 a.ts,需求说的是 b.ts", "建议先停下来核对"],
};

describe("HeadsUpView 三态", () => {
	test("折叠态:一句话 + 选项行", () => {
		const view = new HeadsUpView(() => "zh" as const);
		expect(view.show(finding)).toBe(true);
		expect(view.hasPending()).toBe(true);
		const lines = view.lines(80, theme);
		expect(lines[0]).toContain("✦ Heads up");
		expect(lines[0]).toContain("在错误的文件里改");
		expect(lines[1]).toContain("1: 展开");
		expect(lines[1]).toContain("2: 已知悉");
		expect(lines[1]).toContain("0: 忽略");
	});

	test("折叠按 1 展开:显示要点与展开态选项", () => {
		const view = new HeadsUpView(() => "zh" as const);
		view.show(finding);
		expect(view.handleKey("1").action).toBe("expanded");
		const text = view.lines(80, theme).join("\n");
		expect(text).toContain("改的是 a.ts");
		expect(text).toContain("1: 知道了");
		expect(text).toContain("2: 带到主会话");
	});

	test("折叠按 0/2 忽略或已知悉:dismiss 且抑制同一发现", () => {
		for (const key of ["0", "2"] as const) {
			const view = new HeadsUpView(() => "zh" as const);
			view.show(finding);
			expect(view.handleKey(key).action).toBe("dismissed");
			expect(view.hasPending()).toBe(false);
			expect(view.show(finding)).toBe(false); // 抑制
			expect(view.hasPending()).toBe(false);
		}
	});

	test("展开按 2 带到主会话:action copied,携带引用块", () => {
		const view = new HeadsUpView(() => "zh" as const);
		view.show(finding);
		view.handleKey("1");
		const result = view.handleKey("2");
		expect(view.hasPending()).toBe(false);
		if (result.action !== "copied") throw new Error(`expected copied, got ${result.action}`);
		expect(result.text).toContain("这是旁路 agent 提供的一条提示:");
		expect(result.text).toContain("> Heads up · 在错误的文件里改");
		expect(result.text).toContain("> - 改的是 a.ts");
	});

	test("展开按 1 知道了:dismiss", () => {
		const view = new HeadsUpView(() => "zh" as const);
		view.show(finding);
		view.handleKey("1");
		expect(view.handleKey("1").action).toBe("dismissed");
		expect(view.hasPending()).toBe(false);
	});

	test("无 finding 时按键为 none,lines 为空", () => {
		const view = new HeadsUpView(() => "zh" as const);
		expect(view.handleKey("1").action).toBe("none");
		expect(view.lines(80, theme)).toEqual([]);
	});

	test("每行可见宽度不超过渲染宽度", () => {
		const view = new HeadsUpView(() => "zh" as const);
		view.show({ level: "blocker", summary: "很长".repeat(40), details: ["也很长".repeat(40)] });
		view.handleKey("1");
		for (const line of view.lines(24, theme)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(24);
		}
	});
});

describe("formatToolEvents", () => {
	test("工具名 + ok/ERROR + 结果片段", () => {
		const digest = formatToolEvents([
			{ toolName: "bash", isError: false, snippet: "total 5" },
			{ toolName: "read", isError: true, snippet: "file not found" },
		]);
		expect(digest).toContain("bash → ok");
		expect(digest).toContain("total 5");
		expect(digest).toContain("read → ERROR");
		expect(digest).toContain("file not found");
	});
});

/** 捕获事件 handler 与 UI 调用,驱动控制器集成测试。 */
function makeHarness(verdictText: string, headsupConfig: WingmanConfig["headsup"]) {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const widgetCalls: unknown[] = [];
	const editorTexts: string[] = [];
	let completeCalls = 0;
	const registry = {
		find: () => ({ id: "p/m" }),
		streamSimple: () => ({ result: async () => {
			completeCalls++;
			return { stopReason: "stop", content: [{ type: "text", text: verdictText }] };
		} }),
	} as unknown as ModelRegistry;
	const ctx = {
		mode: "tui",
		modelRegistry: registry,
		model: { id: "current" },
		ui: {
			setWidget: (_key: string, factory: unknown) => widgetCalls.push(factory),
			setEditorText: (text: string) => editorTexts.push(text),
			notify: () => {},
			setStatus: () => {},
		},
	};
	const pi = {
		on: (event: string, handler: never) => {
			handlers.set(event, handler);
			return () => {};
		},
		registerCommand: () => {},
		sendUserMessage: () => {},
	} as unknown as ExtensionAPI;
	const config: WingmanConfig = { headsup: headsupConfig, advisor: { enabled: false }, hint: { enabled: false } };
	const editors = new EditorManager();
	return { handlers, widgetCalls, editorTexts, pi, ctx, editors, config, getCompleteCalls: () => completeCalls };
}

const toolEnd = (toolName: string) =>
	({ type: "tool_execution_end", toolCallId: "1", toolName, result: "ok", isError: false }) as never;

describe("installHeadsUp 集成", () => {
	test("攒够批量阈值触发审计,concern 上屏 widget,数字键走完展开→拷贝流程", async () => {
		const h = makeHarness("VERDICT: concern\nSUMMARY: 在错误的文件里改\nDETAILS:\n- 证据一", {
			enabled: true,
			model: "p/m",
		});
		installHeadsUp(h.pi, () => h.config, () => "", h.editors, () => "zh" as const, { batchSize: 2, debounceMs: 60_000 });
		const onToolEnd = h.handlers.get("tool_execution_end")!;
		await onToolEnd(toolEnd("bash"), h.ctx as never);
		expect(h.getCompleteCalls()).toBe(0); // 未到阈值
		await onToolEnd(toolEnd("read"), h.ctx as never);
		await settle();
		expect(h.getCompleteCalls()).toBe(1);
		expect(h.widgetCalls.length).toBe(1);
		expect(typeof h.widgetCalls[0]).toBe("function");

		// 折叠 → 展开 → 带到主会话
		expect(h.editors.headsUpHandler?.("1")).toBe(true);
		expect(h.editors.headsUpHandler?.("2")).toBe(true);
		expect(h.editorTexts[0]).toContain("这是旁路 agent 提供的一条提示:");
		// 拷贝即 dismiss:widget 卸载
		expect(h.widgetCalls.length).toBe(2);
		expect(h.widgetCalls[1]).toBeUndefined();
	});

	test("ok 不上屏", async () => {
		const h = makeHarness("VERDICT: ok\nSUMMARY: 正常", { enabled: true, model: "p/m" });
		installHeadsUp(h.pi, () => h.config, () => "", h.editors, () => "zh" as const, { batchSize: 1, debounceMs: 60_000 });
		await h.handlers.get("tool_execution_end")!(toolEnd("bash"), h.ctx as never);
		await settle();
		expect(h.getCompleteCalls()).toBe(1);
		expect(h.widgetCalls.length).toBe(0);
	});

	test("同一发现被抑制:第二次审计到相同结论不再上屏", async () => {
		const h = makeHarness("VERDICT: concern\nSUMMARY: 在错误的文件里改", { enabled: true, model: "p/m" });
		// minIntervalMs: 0 关掉冷却,否则第二次审计会被冷却拦下,测不到抑制
		installHeadsUp(h.pi, () => h.config, () => "", h.editors, () => "zh" as const, { batchSize: 1, debounceMs: 60_000, minIntervalMs: 0 });
		const onToolEnd = h.handlers.get("tool_execution_end")!;
		await onToolEnd(toolEnd("bash"), h.ctx as never);
		await settle();
		expect(h.widgetCalls.length).toBe(1);
		h.editors.headsUpHandler?.("0"); // 忽略 → 抑制
		await onToolEnd(toolEnd("bash"), h.ctx as never);
		await settle();
		expect(h.getCompleteCalls()).toBe(2);
		expect(h.widgetCalls.length).toBe(2); // 第一次卸载 + 不再重新挂载
		expect(h.widgetCalls[1]).toBeUndefined();
	});

	test("未配置模型时不激活(守卫 enabled && model)", async () => {
		const h = makeHarness("VERDICT: blocker\nSUMMARY: x", { enabled: true });
		installHeadsUp(h.pi, () => h.config, () => "", h.editors, () => "zh" as const, { batchSize: 1, debounceMs: 60_000 });
		await h.handlers.get("tool_execution_end")!(toolEnd("bash"), h.ctx as never);
		await settle();
		expect(h.getCompleteCalls()).toBe(0);
	});
});
