/**
 * hint.ts — 任务结束后的下一步 prompt 建议(参照 Claude Code prompt suggestions)。
 *
 * agent_end 后在后台用便宜模型生成 1 条 ≤120 字符的下一步 prompt(不 await,
 * 不拖住 agent_end 派发),经 EditorManager 拿到共享 WingmanEditor 设置
 * pending hint(ghost 渲染与 Tab/Enter/清除状态机在 editor.ts)。
 * before_agent_start 清除 hint 并使在途生成作废。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildDigest, type DigestMessage } from "./audit.js";
import type { WingmanConfig } from "./config.js";
import type { EditorManager } from "./editor.js";
import { completeText, resolveModel, type AnyModel, type ModelRegistry } from "./llm.js";

const HINT_SYSTEM_PROMPT = `The user is driving an AI coding agent. Given the user's goal and the latest transcript, suggest the single next prompt the user is most likely to send.

Rules:
- Output only the prompt text, no quotes, no explanation.
- At most 120 characters, one line.
- Continue the work naturally (next step, fix, verify, or commit); do not repeat what was just done.
- If the work looks finished, suggest a sensible follow-up or say "继续".`;

const MAX_HINT_CHARS = 120;

export function installHint(
	pi: ExtensionAPI,
	getConfig: () => WingmanConfig,
	getGoal: () => string,
	editors: EditorManager,
): void {
	const shutdown = new AbortController();
	/** 每个新 run 自增;生成回来时代际已变说明 hint 过期,丢弃。 */
	let generation = 0;

	const generate = async (registry: ModelRegistry, model: AnyModel, transcript: string, gen: number) => {
		const goal = getGoal() ? `User's goal: ${getGoal()}\n\n` : "";
		const result = await completeText(
			registry,
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
		if (!result.ok || gen !== generation) return; // 静默降级 / 已过期
		editors.current?.setHint(result.text.replace(/\s+/g, " ").trim().slice(0, MAX_HINT_CHARS));
	};

	pi.on("before_agent_start", () => {
		generation++;
		editors.current?.setHint(undefined);
	});

	pi.on("agent_end", (event, ctx) => {
		const config = getConfig().hint;
		if (!config.enabled || ctx.mode !== "tui" || !editors.current) return;
		const model = resolveModel(ctx.modelRegistry, config.model, ctx.model);
		if (!model) return;
		const transcript = buildDigest(event.messages as DigestMessage[], { maxMessages: 6, perMessageChars: 500 });
		if (!transcript) return;
		// 后台执行已在 runner 的 try/catch 之外,自己兜底(会话替换后 UI 调用可能抛)
		generate(ctx.modelRegistry, model, transcript, generation).catch(() => {});
	});

	pi.on("session_shutdown", () => {
		shutdown.abort();
	});
}
