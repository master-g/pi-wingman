/**
 * editor.ts — WingmanEditor 与其安装管理(EditorManager)。
 *
 * WingmanEditor 是全扩展唯一的 CustomEditor(setEditorComponent 全局只能装
 * 一个):hint 用输入行内联的暗色 ghost 文本(M1),heads-up 用数字键捕获(M3)。安装条件是
 * hint.enabled || headsup.enabled;session_start 与配置命令变更后各 sync
 * 一次,条件不变不动(避免重建丢掉 pendingHint)。
 */

import { CustomEditor, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { getKeybindings, truncateToWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { WingmanConfig } from "./config.js";

export class WingmanEditor extends CustomEditor {
	private pendingHint: string | undefined;
	/** heads-up 数字键处理器,返回 true 表示消费;仅编辑器为空时被调用。 */
	onHeadsUpKey?: (key: "0" | "1" | "2") => boolean;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly activeTui: { current: TUI | undefined },
	) {
		super(tui, theme, keybindings);
	}

	setHint(hint: string | undefined): void {
		this.pendingHint = hint;
		this.activeTui.current?.requestRender();
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (!this.pendingHint || this.getText().length > 0 || lines.length < 3) return lines;
		// 空编辑器的唯一内容行紧跟上边框:去掉行尾填充,把 hint 以暗色接在光标后
		lines[1] = truncateToWidth(`${lines[1].replace(/ +$/, "")}\x1b[2m${this.pendingHint}\x1b[22m`, width);
		return lines;
	}

	handleInput(data: string): void {
		if (
			this.getText().length === 0 &&
			(data === "0" || data === "1" || data === "2") &&
			this.onHeadsUpKey?.(data)
		) {
			return; // heads-up 消费了数字键
		}
		if (this.pendingHint) {
			// 与基类编辑器同一套键位判断:兼容 kitty 协议与用户自定义键位
			const kb = getKeybindings();
			if (kb.matches(data, "tui.input.tab")) {
				// Tab:填入可编辑,吞掉 Tab 防触发补全
				const hint = this.pendingHint;
				this.pendingHint = undefined;
				this.setText(hint);
				return;
			}
			if (kb.matches(data, "tui.input.submit")) {
				// 提交键:填入后把同一按键交给基类走提交路径
				const hint = this.pendingHint;
				this.pendingHint = undefined;
				this.setText(hint);
				super.handleInput(data);
				return;
			}
			// 其他任意按键:清除 hint,按键照常转发
			this.pendingHint = undefined;
		}
		super.handleInput(data);
	}
}

export class EditorManager {
	private readonly activeTui: { current: TUI | undefined } = { current: undefined };
	private editor: WingmanEditor | undefined;
	private registered = false;
	/** heads-up 数字键处理器槽位;工厂重建编辑器时自动接上。 */
	headsUpHandler?: (key: "0" | "1" | "2") => boolean;

	/** 当前编辑器实例(未安装或 TUI 未构建时为 undefined)。 */
	get current(): WingmanEditor | undefined {
		return this.editor;
	}

	/** 按配置同步安装状态;shortcut: 运行中切换会重建编辑器丢弃未提交文本,配置命令场景可接受。 */
	sync(ctx: ExtensionContext, config: WingmanConfig): void {
		if (ctx.mode !== "tui") return;
		const need = config.hint.enabled || config.headsup.enabled;
		if (need === this.registered) return;
		if (need) {
			this.registered = true;
			ctx.ui.setEditorComponent((tui, theme, keybindings) => {
				this.activeTui.current = tui;
				this.editor = new WingmanEditor(tui, theme, keybindings, this.activeTui);
				this.editor.onHeadsUpKey = (key) => this.headsUpHandler?.(key) ?? false;
				return this.editor;
			});
		} else {
			// teardown 内部才把 registered 置 false,顺序不可颠倒
			this.teardown(ctx);
		}
	}

	teardown(ctx: ExtensionContext): void {
		if (!this.registered) return;
		this.registered = false;
		this.editor = undefined;
		this.activeTui.current = undefined;
		ctx.ui.setEditorComponent(undefined);
	}
}
