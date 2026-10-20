/**
 * advisor.ts — 用户指定模型的顾问(参照 oh-my-pi advisor)。
 *
 * 每个 turn_end 把该 turn 摘要交给后台审计(不 await,不拖住主 agent);
 * 冷却或在途时摘要先累积,下一个 turn 一起审。返回 note/concern/blocker
 * 时 notify 用户;agent 仍在运行才以 pi.sendUserMessage(note, { deliverAs:
 * "steer" }) 注入纠偏,已 idle 则只提示(顾问不自行唤醒 agent)。注入消息
 * 以 ADVISOR_MARKER 打标:响应旁注的 turn 不再审计(防循环),index.ts
 * 记录用户目标时也跳过带标记的 prompt(防污染)。
 *
 * 另提供 /ask-advisor <问题> 手动咨询当前上下文:答案同样以 steer 注入
 * 主会话。手动咨询失败时向用户报错;自动审计走静默降级。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { auditStatus, Auditor, buildDigest, type DigestMessage, type VerdictLevel } from "./audit.js";
import type { WingmanConfig } from "./config.js";
import { strings, type Lang } from "./i18n.js";
import { completeText, messageText, resolveModel, type AnyModel, type ModelRegistry } from "./llm.js";

/** 注入消息的打标前缀;审计 prompt 也告诉审计员忽略带此标记的内容。 */
export const ADVISOR_MARKER = "[wingman advisor · FYI]";

export function isAdvisorNote(text: string): boolean {
	return text.startsWith(ADVISOR_MARKER);
}

export function formatAdvisorNote(verdict: { level: VerdictLevel; summary: string }): string {
	return `${ADVISOR_MARKER} ${verdict.level}: ${verdict.summary}`;
}

/**
 * 防循环:注入的旁注以 user 消息进入 transcript。message_end 见到带标记的
 * user 消息就记下,随后那个 turn_end(响应旁注的 turn)跳过审计。按注入
 * 文本识别,不依赖后台审计与 turn 的时序。
 */
export class AdvisorState {
	private skipNextTurnAudit = false;

	onUserMessage(text: string): void {
		if (isAdvisorNote(text)) this.skipNextTurnAudit = true;
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

const ASK_SYSTEM_PROMPT: Record<Lang, string> = {
	zh: `你是资深编程顾问,在旁观察一个编程 agent 的工作。给你用户的目标和 agent 近期动作摘要,以及用户现在问你的问题。直接回答问题本身,简洁具体,≤300 字,用中文。`,
	en: `You are a senior programming advisor observing a coding agent at work. Given the user's goal, a digest of the agent's recent actions, and the user's question, answer the question directly, concretely and concisely, in English, ≤200 words.`,
};

const STATUS_KEY = "wingman-advisor";

const NOTIFY_TYPE: Record<Exclude<VerdictLevel, "ok">, "info" | "warning" | "error"> = {
	note: "info",
	concern: "warning",
	blocker: "error",
};

/** 冷却期内最多累积几个 turn 的摘要,超出丢最旧的。 */
const MAX_PENDING_TURNS = 3;

export function installAdvisor(
	pi: ExtensionAPI,
	getConfig: () => WingmanConfig,
	getGoal: () => string,
	getLang: () => Lang,
): void {
	const auditor = new Auditor({ minIntervalMs: 60_000 });
	const shutdown = new AbortController();
	const state = new AdvisorState();
	let pendingDigests: string[] = [];

	const audit = async (ctx: ExtensionContext, registry: ModelRegistry, model: AnyModel, digest: string) => {
		ctx.ui.setStatus(STATUS_KEY, auditStatus("advisor"));
		const result = await auditor.run(
			registry,
			model,
			{ goal: getGoal(), digest, lang: getLang() },
			// 后台审计不卡主流程,超时放宽给高 effort 留余地
			{ timeoutMs: 60_000, signal: shutdown.signal, effort: getConfig().advisor.effort },
		);
		if (!result) return;
		ctx.ui.setStatus(STATUS_KEY, auditStatus("advisor", result));
		if (!result.ok) return;
		const { verdict } = result;
		if (verdict.level === "ok") return;
		ctx.ui.notify(`advisor [${verdict.level}] ${verdict.summary}`, NOTIFY_TYPE[verdict.level]);
		if (ctx.isIdle()) return; // 裁决迟到:agent 已停,只提示用户,不注入
		pi.sendUserMessage(formatAdvisorNote(verdict), { deliverAs: "steer" });
	};

	pi.on("message_end", (event) => {
		if (event.message.role === "user") state.onUserMessage(messageText(event.message));
	});

	pi.on("turn_end", (event, ctx) => {
		const config = getConfig().advisor;
		// advisor 必须显式配置模型才激活(开启必经 /wingman advisor <model>);
		// 未设或拼错模型都不回退当前模型,避免双份成本。
		if (!config.enabled || !config.model) return;
		if (!state.shouldAuditTurn()) return;
		const model = resolveModel(ctx.modelRegistry, config.model, undefined);
		if (!model) return;

		const digest = buildDigest([event.message, ...event.toolResults] as DigestMessage[]);
		if (!digest.trim()) return;
		pendingDigests = [...pendingDigests, digest].slice(-MAX_PENDING_TURNS);
		if (!auditor.ready) return; // 冷却或在途:摘要留到下一个 turn 一起审
		const batch = pendingDigests.join("\n");
		pendingDigests = [];
		// 后台执行已在 runner 的 try/catch 之外,自己兜底(会话替换后 UI 调用可能抛)
		audit(ctx, ctx.modelRegistry, model, batch).catch(() => {});
	});

	pi.registerCommand("ask-advisor", {
		description: "Ask the advisor model about current context: /ask-advisor <question>",
		handler: async (args, ctx) => {
			const s = strings(getLang());
			const config = getConfig().advisor;
			if (!config.enabled || !config.model) {
				ctx.ui.notify(s.advisorOff, "error");
				return;
			}
			const question = args.trim();
			if (!question) {
				ctx.ui.notify(s.askUsage, "info");
				return;
			}
			const model = resolveModel(ctx.modelRegistry, config.model, undefined);
			if (!model) {
				ctx.ui.notify(s.advisorModelUnresolvable(config.model), "error");
				return;
			}

			const recent = ctx.sessionManager
				.getBranch()
				.filter((entry) => entry.type === "message")
				.slice(-10)
				.map((entry) => (entry as { message: unknown }).message as DigestMessage);
			const digest = buildDigest(recent);
			const goal = getGoal() ? `${s.labels.goal}:${getGoal()}\n\n` : "";
			const result = await completeText(
				ctx.modelRegistry,
				model,
				{
					systemPrompt: ASK_SYSTEM_PROMPT[getLang()],
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: `${goal}${s.labels.recentActions}:\n${digest || s.labels.none}\n\n${s.labels.advisorQuestion}:${question}`,
								},
							],
							timestamp: Date.now(),
						},
					],
				},
				{ timeoutMs: 60_000, signal: shutdown.signal, effort: config.effort },
			);
			if (!result.ok) {
				ctx.ui.notify(s.advisorCallFailed(result.reason), "error");
				return;
			}
			pi.sendUserMessage(`${ADVISOR_MARKER} ${s.qaQuestion}:${question}\n${s.qaAnswer}:${result.text}`, {
				deliverAs: "steer",
			});
			ctx.ui.notify(s.advisorInjected, "info");
		},
	});

	pi.on("session_shutdown", () => {
		shutdown.abort();
	});
}
