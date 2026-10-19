import { describe, expect, test } from "bun:test";

// WingmanEditor 已移至 editor.ts(与 M3 heads-up 共享)。
import { WingmanEditor } from "./editor.js";

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
				return editor.render(80).some((line) => line.includes("💡"));
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
