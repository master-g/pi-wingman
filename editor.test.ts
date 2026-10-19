import { describe, expect, test } from "bun:test";
import type { WingmanConfig } from "./config.js";
import { EditorManager, WingmanEditor } from "./editor.js";

function makeCtx(mode: "tui" | "print" = "tui") {
	const calls: unknown[] = [];
	const ctx = {
		mode,
		ui: { setEditorComponent: (factory: unknown) => calls.push(factory) },
	};
	return { ctx: ctx as never, calls };
}

const configWith = (hint: boolean, headsup: boolean): WingmanConfig => ({
	headsup: { enabled: headsup },
	advisor: { enabled: false },
	hint: { enabled: hint },
});

describe("EditorManager.sync", () => {
	test("hint 或 headsup 任一开启时安装编辑器工厂", () => {
		const manager = new EditorManager();
		const { ctx, calls } = makeCtx();
		manager.sync(ctx, configWith(true, false));
		expect(calls.length).toBe(1);
		expect(typeof calls[0]).toBe("function");
	});

	test("两者都关时不安装;已安装则卸载(恢复默认编辑器)", () => {
		const manager = new EditorManager();
		const { ctx, calls } = makeCtx();
		manager.sync(ctx, configWith(true, false));
		manager.sync(ctx, configWith(false, false));
		expect(calls.length).toBe(2);
		expect(calls[1]).toBeUndefined();
	});

	test("条件不变时重复 sync 不重装(避免丢 pendingHint)", () => {
		const manager = new EditorManager();
		const { ctx, calls } = makeCtx();
		manager.sync(ctx, configWith(true, false));
		manager.sync(ctx, configWith(true, true));
		expect(calls.length).toBe(1);
	});

	test("非 tui 模式不安装", () => {
		const manager = new EditorManager();
		const { ctx, calls } = makeCtx("print");
		manager.sync(ctx, configWith(true, false));
		expect(calls.length).toBe(0);
	});

	test("teardown 卸载,之后可重新 sync 安装", () => {
		const manager = new EditorManager();
		const { ctx, calls } = makeCtx();
		manager.sync(ctx, configWith(true, false));
		manager.teardown(ctx);
		expect(calls.length).toBe(2);
		expect(calls[1]).toBeUndefined();
		manager.sync(ctx, configWith(true, false));
		expect(calls.length).toBe(3);
	});
});

describe("WingmanEditor 数字键捕获(heads-up)", () => {
	function makeEditor(onHeadsUpKey?: (key: "0" | "1" | "2") => boolean) {
		const tui = { requestRender() {}, terminal: { rows: 24, cols: 80 } };
		const theme = { borderColor: (s: string) => s } as never;
		const keybindings = { matches: () => false } as never;
		const editor = new WingmanEditor(tui as never, theme, keybindings, { current: tui } as never);
		editor.onHeadsUpKey = onHeadsUpKey;
		return editor;
	}

	test("编辑器为空且有 handler 时 0/1/2 被消费", () => {
		const seen: string[] = [];
		const editor = makeEditor((key) => {
			seen.push(key);
			return true;
		});
		editor.handleInput("1");
		expect(seen).toEqual(["1"]);
		expect(editor.getText()).toBe(""); // 未进编辑器
	});

	test("handler 返回 false 时数字照常输入", () => {
		const editor = makeEditor(() => false);
		editor.handleInput("1");
		expect(editor.getText()).toBe("1");
	});

	test("编辑器有文本时数字不拦截", () => {
		let called = false;
		const editor = makeEditor(() => {
			called = true;
			return true;
		});
		editor.handleInput("x");
		editor.handleInput("1");
		expect(called).toBe(false);
		expect(editor.getText()).toBe("x1");
	});

	test("无 handler 时数字照常输入", () => {
		const editor = makeEditor(undefined);
		editor.handleInput("0");
		expect(editor.getText()).toBe("0");
	});
});
