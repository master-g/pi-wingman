/**
 * hint.ts — 任务结束后的下一步 prompt 建议(参照 Claude Code prompt suggestions)。
 *
 * agent_end 后用便宜模型生成 1 条 ≤120 字符的下一步 prompt,经 EditorManager
 * 拿到共享 WingmanEditor 设置 pending hint(ghost 渲染与 Tab/Enter/清除
 * 状态机在 editor.ts)。session_start / before_agent_start 清除 hint。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WingmanConfig } from "./config.js";
import type { EditorManager } from "./editor.js";
import { completeText, messageText, resolveModel } from "./llm.js";

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

export function installHint(pi: ExtensionAPI, getConfig: () => WingmanConfig, editors: EditorManager): void {
	let lastGoal = "";
	const shutdown = new AbortController();

	pi.on("session_start", () => {
		editors.current?.setHint(undefined);
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType === "user") lastGoal = event.prompt;
		editors.current?.setHint(undefined);
	});

	pi.on("agent_end", async (event, ctx) => {
		const config = getConfig().hint;
		const editor = editors.current;
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

	pi.on("session_shutdown", () => {
		shutdown.abort();
	});
}
