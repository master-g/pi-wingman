import { describe, expect, test } from "bun:test";
import type { WingmanConfig } from "./config.js";
import { EditorManager } from "./editor.js";

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
