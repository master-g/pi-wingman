import { describe, expect, test } from "bun:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WingmanConfig } from "./config.js";
// WingmanEditor 已移至 editor.ts(与 M3 heads-up 共享)。
import { WingmanEditor, type EditorManager } from "./editor.js";
import { installHint } from "./hint.js";

function makeEditor() {
	const tui = { requestRender() {}, terminal: { rows: 24, cols: 80 } };
	const theme = { borderColor: (s: string) => s } as never;
	const keybindings = { matches: () => false } as never;
	const activeTui = { current: tui };
	const editor = new WingmanEditor(tui as never, theme, keybindings, activeTui as never);
	let submitted: string | undefined;
	editor.onSubmit = (text: string) => {
		submitted = text;
	};
	return {
		editor,
		getSubmitted: () => submitted,
		ghostVisible: () => {
			try {
				return editor.render(80).some((line) => line.includes("\x1b[2m"));
			} catch (error) {
				throw new Error(`render 在 mock 下不可用,检查 mock 是否缺字段: ${error}`);
			}
		},
	};
}

describe("WingmanEditor ghost text 状态机", () => {
	test("编辑器为空时渲染 ghost 行", () => {
		const { editor, ghostVisible } = makeEditor();
		editor.setHint("继续实现 M2");
		expect(ghostVisible()).not.toBe(false);
	});

	test("ghost 内联在输入行,不额外占一行", () => {
		const { editor } = makeEditor();
		const before = editor.render(80);
		editor.setHint("继续实现 M2");
		const after = editor.render(80);
		expect(after.length).toBe(before.length);
		expect(after[1]).toContain("继续实现 M2");
	});

	test("Tab 填入可编辑文本,ghost 清除,不触发提交", () => {
		const { editor, getSubmitted, ghostVisible } = makeEditor();
		editor.setHint("继续实现 M2");
		editor.handleInput("\t");
		expect(editor.getText()).toBe("继续实现 M2");
		expect(getSubmitted()).toBeUndefined();
		expect(ghostVisible()).toBe(false);
	});

	test("Enter 填入并提交", () => {
		const { editor, getSubmitted } = makeEditor();
		editor.setHint("跑一遍测试");
		editor.handleInput("\r");
		expect(getSubmitted()).toBe("跑一遍测试");
	});

	test("其他按键清除 hint 且按键照常进入编辑器", () => {
		const { editor, ghostVisible } = makeEditor();
		editor.setHint("继续实现 M2");
		editor.handleInput("x");
		expect(editor.getText()).toBe("x");
		expect(ghostVisible()).toBe(false);
	});

	test("无 hint 时按键行为不变", () => {
		const { editor, getSubmitted } = makeEditor();
		editor.handleInput("h");
		editor.handleInput("i");
		expect(editor.getText()).toBe("hi");
		editor.handleInput("\r");
		expect(getSubmitted()).toBe("hi");
	});
});

describe("installHint 后台生成与底栏状态", () => {
	function harness(response: unknown) {
		const handlers = new Map<string, (event: never, ctx: never) => unknown>();
		const statuses: (string | undefined)[] = [];
		const hints: (string | undefined)[] = [];
		const pi = { on: (event: string, handler: never) => handlers.set(event, handler) } as unknown as ExtensionAPI;
		const ctx = {
			mode: "tui",
			model: { id: "current" },
			modelRegistry: { find: () => undefined, streamSimple: () => ({ result: async () => response }) },
			ui: { setStatus: (_key: string, text?: string) => statuses.push(text) },
		};
		const config: WingmanConfig = { headsup: { enabled: false }, advisor: { enabled: false }, hint: { enabled: true } };
		const editors = { current: { setHint: (hint?: string) => hints.push(hint) } } as unknown as EditorManager;
		installHint(pi, () => config, () => "目标", editors, () => "zh" as const);
		const agentEnd = { messages: [{ role: "assistant", content: [{ type: "text", text: "改好了" }] }] } as never;
		return {
			onAgentEnd: () => handlers.get("agent_end")!(agentEnd, ctx as never),
			onAgentStart: () => handlers.get("before_agent_start")!({} as never, ctx as never),
			statuses,
			hints,
		};
	}
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	test("生成中显示 ⋯,成功后清掉状态并设 hint", async () => {
		const h = harness({ stopReason: "stop", content: [{ type: "text", text: "跑测试" }] });
		h.onAgentEnd();
		await settle();
		expect(h.statuses).toEqual(["hint ⋯", undefined]);
		expect(h.hints.at(-1)).toBe("跑测试");
	});

	test("失败在底栏显示原因", async () => {
		const h = harness({ stopReason: "error", errorMessage: "boom", content: [] });
		h.onAgentEnd();
		await settle();
		expect(h.statuses.at(-1)).toBe("hint ✗ stopReason=error: boom");
	});

	test("新 run 开始后迟到的结果丢弃,状态清空", async () => {
		const h = harness({ stopReason: "stop", content: [{ type: "text", text: "跑测试" }] });
		h.onAgentEnd();
		h.onAgentStart();
		await settle();
		expect(h.hints).not.toContain("跑测试");
		expect(h.statuses.at(-1)).toBeUndefined();
	});
});
