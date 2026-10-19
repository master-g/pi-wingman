/**
 * hint.ts — 任务结束后的下一步 prompt 建议（参照 Claude Code prompt suggestions）。
 *
 * agent_end 后用便宜模型生成 1 条 ≤120 字符的下一步 prompt。编辑器为空且有
 * pending hint 时在输入行下方渲染暗色 ghost 行；Tab → 填入（可编辑）；
 * Enter → 填入并提交；其他任意按键清除。不拥有的按键全部转发基类。
 * session_start / before_agent_start 清除 hint。
 *
 * WingmanEditor 是全扩展唯一的 CustomEditor（setEditorComponent 全局只能装
 * 一个），M3 heads-up 的数字键捕获也挂在这里。
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { WingmanConfig } from "./config.js";
import { completeText, resolveModel } from "./llm.js";

const HINT_SYSTEM_PROMPT = `The user is driving an AI coding agent. Given the user's goal and the latest transcript, suggest the single next prompt the user is most likely to send.

Rules:
- Output only the prompt text, no quotes, no explanation.
- At most 120 characters, one line.
- Continue the work naturally (next step, fix, verify, or commit); do not repeat what was just done.
- If the work looks finished, suggest a sensible follow-up or say "继续".`;

const MAX_HINT_CHARS = 120;
const TRANSCRIPT_TAIL = 6;
const PER_MESSAGE_CHARS = 500;

type Message = ExtensionContext["modelRegistry"] extends never
	? never
	: Parameters<ExtensionContext["modelRegistry"]["complete"]>[1]["messages"][number];

function messageText(message: Message): string {
	if (!("content" in message)) return "";
	const content = (message as { content: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

/** 把最近消息压成简短转录：role + 截断正文。 */
function buildTranscript(messages: Message[]): string {
	return messages
		.slice(-TRANSCRIPT_TAIL)
		.map((m) => {
			const role = "role" in m ? String(m.role) : "unknown";
			const text = messageText(m).slice(0, PER_MESSAGE_CHARS);
			return text ? `[${role}] ${text}` : `[${role}]`;
		})
		.join("\n\n");
}

export class WingmanEditor extends CustomEditor {
	private pendingHint: string | undefined;

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
		if (!this.pendingHint || this.getText().length > 0 || lines.length < 2) return lines;
		// shortcut: ghost 渲染为输入行下方新增一行；如需与输入行内联覆盖再升级。
		const ghost = truncateToWidth(`\x1b[2m  💡 ${this.pendingHint}\x1b[0m`, width);
		lines.splice(lines.length - 1, 0, ghost);
		return lines;
	}

	handleInput(data: string): void {
		if (this.pendingHint) {
			if (data === "\t") {
				// Tab：填入可编辑，吞掉 Tab 防触发补全
				const hint = this.pendingHint;
				this.pendingHint = undefined;
				this.setText(hint);
				return;
			}
			if (data === "\r" || data === "\n") {
				// Enter：填入后走基类提交路径
				const hint = this.pendingHint;
				this.pendingHint = undefined;
				this.setText(hint);
				super.handleInput("\r");
				return;
			}
			// 其他任意按键：清除 hint，按键照常转发
			this.pendingHint = undefined;
		}
		super.handleInput(data);
	}
}

export function installHint(pi: ExtensionAPI, getConfig: () => WingmanConfig): void {
	const activeTui: { current: TUI | undefined } = { current: undefined };
	let editor: WingmanEditor | undefined;
	let lastGoal = "";
	const shutdown = new AbortController();

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (!getConfig().hint.enabled) return;
		editor = undefined;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			activeTui.current = tui;
			editor = new WingmanEditor(tui, theme, keybindings, activeTui);
			return editor;
		});
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType === "user") lastGoal = event.prompt;
		editor?.setHint(undefined);
	});

	pi.on("agent_end", async (event, ctx) => {
		const config = getConfig().hint;
		if (!config.enabled || ctx.mode !== "tui" || !editor) return;
		const model = resolveModel(ctx.modelRegistry, config.model, ctx.model);
		if (!model) return;

		const transcript = buildTranscript(event.messages as Message[]);
		if (!transcript) return;
		const goal = lastGoal ? `User's goal: ${lastGoal}\n\n` : "";
		const result = await completeText(
			ctx.modelRegistry,
			model,
			{
				systemPrompt: HINT_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: `${goal}Latest transcript:\n${transcript}` }],
						timestamp: Date.now(),
					},
				],
			},
			{ timeoutMs: 10_000, signal: shutdown.signal },
		);
		if (!result.ok) return; // 静默降级
		editor.setHint(result.text.replace(/\s+/g, " ").trim().slice(0, MAX_HINT_CHARS));
	});

	pi.on("session_shutdown", (_event, ctx) => {
		shutdown.abort();
		editor = undefined;
		activeTui.current = undefined;
		ctx.ui.setEditorComponent(undefined);
	});
}
