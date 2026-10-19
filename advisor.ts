/**
 * advisor.ts — 用户指定模型的顾问(参照 oh-my-pi advisor)。
 *
 * 每个 turn_end 把该 turn 摘要发给 advisor 模型;返回 note/concern/blocker
 * 时以 pi.sendUserMessage(note, { deliverAs: "steer" }) 注入主 agent 纠偏,
 * 同时 notify 用户。注入消息以 ADVISOR_MARKER 打标:顾问自己的旁注触发
 * 的 turn 不再审计、不更新用户目标(防循环防污染);steer 被中断时跳过
 * 量在下一次真实 before_agent_start 重置。
 *
 * 另提供 /ask-advisor <问题> 手动咨询当前上下文:答案同样以 steer 注入
 * 主会话。手动咨询失败时向用户报错;自动审计走静默降级。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Auditor, buildDigest, type DigestMessage, type VerdictLevel } from "./audit.js";
import type { WingmanConfig } from "./config.js";
import { completeText, resolveModel } from "./llm.js";

/** 注入消息的打标前缀;审计 prompt 也告诉审计员忽略带此标记的内容。 */
export const ADVISOR_MARKER = "[wingman advisor";

export function isAdvisorNote(text: string): boolean {
	return text.startsWith(ADVISOR_MARKER);
}

export function formatAdvisorNote(verdict: { level: VerdictLevel; summary: string }): string {
	return `${ADVISOR_MARKER} · 旁注,非用户消息,仅供参考] ${verdict.level}: ${verdict.summary}`;
}

/**
 * 防循环状态:用户目标捕获 + 跳过一个 turn 的审计。
 * - 顾问旁注触发的 run(before_agent_start prompt 带标记):不更新目标、保持跳过;
 * - 注入后若 steer 被中断没产生 turn:下一次真实 prompt 到达时重置跳过量。
 */
export class AdvisorState {
	goal = "";
	private skipNextTurnAudit = false;

	onBeforeAgentStart(prompt: string): void {
		if (isAdvisorNote(prompt)) return;
		this.goal = prompt;
		this.skipNextTurnAudit = false;
	}

	markInjected(): void {
		this.skipNextTurnAudit = true;
	}

	/** turn_end 到达时调用:true = 本次应审计;false = 跳过并消费跳过量。 */
	shouldAuditTurn(): boolean {
		if (this.skipNextTurnAudit) {
			this.skipNextTurnAudit = false;
			return false;
		}
		return true;
	}
}

const ASK_SYSTEM_PROMPT = `你是资深编程顾问,在旁观察一个编程 agent 的工作。给你用户的目标和 agent 近期动作摘要,以及用户现在问你的问题。直接回答问题本身,简洁具体,≤300 字,用中文。`;

const NOTIFY_TYPE: Record<Exclude<VerdictLevel, "ok">, "info" | "warning" | "error"> = {
	note: "info",
	concern: "warning",
	blocker: "error",
};

export function installAdvisor(pi: ExtensionAPI, getConfig: () => WingmanConfig): void {
	const auditor = new Auditor({ minIntervalMs: 60_000 });
	const shutdown = new AbortController();
	const state = new AdvisorState();

	pi.on("before_agent_start", (event) => {
		if (event.messageType === "user") state.onBeforeAgentStart(event.prompt);
	});

	pi.on("turn_end", async (event, ctx) => {
		const config = getConfig().advisor;
		if (!config.enabled) return;
		if (!state.shouldAuditTurn()) return;
		const model = resolveModel(ctx.modelRegistry, config.model, ctx.model);
		if (!model) return;

		const digest = buildDigest([event.message, ...event.toolResults] as DigestMessage[]);
		if (!digest.trim()) return;
		const verdict = await auditor.run(
			ctx.modelRegistry,
			model,
			{ goal: state.goal, digest },
			{ timeoutMs: 15_000, signal: shutdown.signal },
		);
		if (!verdict || verdict.level === "ok") return;

		state.markInjected();
		pi.sendUserMessage(formatAdvisorNote(verdict), { deliverAs: "steer" });
		ctx.ui.notify(`advisor [${verdict.level}] ${verdict.summary}`, NOTIFY_TYPE[verdict.level]);
	});

	pi.registerCommand("ask-advisor", {
		description: "Ask the advisor model about current context: /ask-advisor <question>",
		handler: async (args, ctx) => {
			const config = getConfig().advisor;
			if (!config.enabled) {
				ctx.ui.notify("advisor 未启用,先 /advisor <provider/model> 配置", "error");
				return;
			}
			const question = args.trim();
			if (!question) {
				ctx.ui.notify("用法:/ask-advisor <问题>", "info");
				return;
			}
			const model = resolveModel(ctx.modelRegistry, config.model, ctx.model);
			if (!model) {
				ctx.ui.notify("没有可用模型", "error");
				return;
			}

			const recent = ctx.sessionManager
				.getBranch()
				.filter((entry) => entry.type === "message")
				.slice(-10)
				.map((entry) => (entry as { message: unknown }).message as DigestMessage);
			const digest = buildDigest(recent);
			const goal = state.goal ? `用户目标:${state.goal}\n\n` : "";
			const result = await completeText(
				ctx.modelRegistry,
				model,
				{
					systemPrompt: ASK_SYSTEM_PROMPT,
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: `${goal}近期动作:\n${digest || "(暂无)"}\n\n顾问问题:${question}` },
							],
							timestamp: Date.now(),
						},
					],
				},
				{ timeoutMs: 30_000, signal: shutdown.signal },
			);
			if (!result.ok) {
				ctx.ui.notify(`advisor 调用失败:${result.reason}`, "error");
				return;
			}
			state.markInjected();
			pi.sendUserMessage(`${ADVISOR_MARKER} · 问答] 问:${question}\n答:${result.text}`, { deliverAs: "steer" });
			ctx.ui.notify("顾问回答已注入对话", "info");
		},
	});

	pi.on("session_shutdown", () => {
		shutdown.abort();
	});
}
