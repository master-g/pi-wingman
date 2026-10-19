/**
 * audit.ts — heads-up 与 advisor 共享的审计管线。
 *
 * 输入:用户目标(before_agent_start 的 prompt)+ 近期动作 digest;
 * 输出:Verdict(ok/note/concern/blocker + 一句话)。heads-up 与 advisor
 * 只差输出通道,审计逻辑复用同一份。
 *
 * Auditor 带冷却与互斥:并发只放行一个,冷却期内直接跳过(返回
 * undefined);失败一律静默(返回 undefined),不抛进 pi 事件循环。
 */

import { completeText, messageText, type AnyModel, type CallOptions, type Message, type ModelRegistry } from "./llm.js";

export type VerdictLevel = "ok" | "note" | "concern" | "blocker";

export interface Verdict {
	level: VerdictLevel;
	/** 一句话说明,给用户或主 agent 看 */
	summary: string;
	/** 展开要点(heads-up 展开态用;仅 concern/blocker 时审计模型才会给) */
	details: string[];
}

export type DigestMessage = Message;

export interface DigestOptions {
	maxMessages?: number;
	perMessageChars?: number;
}

const AUDIT_SYSTEM_PROMPT = `你是编程 agent 的旁路审计员。给你用户的目标和 agent 近期动作摘要,判断 agent 是否走在正确的路上。

只输出如下格式,不要任何其他内容:
VERDICT: <ok|note|concern|blocker>
SUMMARY: <一句话,≤120 字符,用中文>
DETAILS:(仅 concern/blocker 时输出此块,最多 4 条要点,每条一行以 "- " 开头,各 ≤100 字符,说明判断依据与建议;ok/note 时不要输出此块)

级别含义:
- blocker:正在犯错且会造成实质损失(破坏数据、违背用户目标、在错误的方向上大量返工),必须立即纠偏
- concern:方向可疑或明显浪费(改错文件、绕过而非修复、重复无效尝试),值得提醒
- note:方向正确,但有一个可选的改进建议
- ok:一切正常,无话可说

宁缺毋滥:不确定时选 ok。带 [wingman advisor 标记的消息是顾问自己之前的旁注,不要评论它。`;

/** 把近期消息压成审计用摘要:role 前缀 + 截断正文 + 工具调用/结果行。 */
export function buildDigest(messages: DigestMessage[], options: DigestOptions = {}): string {
	const { maxMessages = 12, perMessageChars = 300 } = options;
	const lines: string[] = [];
	for (const message of messages.slice(-maxMessages)) {
		const text = messageText(message).slice(0, perMessageChars);
		if (message.role === "toolResult") {
			const error = message.isError ? " ERROR" : "";
			lines.push(`[toolResult ${message.toolName}]${error} ${text}`.trimEnd());
			continue;
		}
		const calls =
			message.role === "assistant"
				? message.content
						.filter((c) => c.type === "toolCall")
						.map((c) => `→ ${c.name}(${JSON.stringify(c.arguments ?? {}).slice(0, 120)})`)
						.join(" ")
				: "";
		lines.push(`[${message.role}] ${text}${text && calls ? " " : ""}${calls}`.trimEnd());
	}
	return lines.join("\n");
}

/** 解析审计模型的输出;没有 VERDICT 行视为无效。 */
export function parseVerdict(text: string): Verdict | undefined {
	const verdict = text.match(/verdict:\s*(ok|note|concern|blocker)/i);
	if (!verdict) return undefined;
	const summary = text.match(/summary:\s*(.+)/i);
	const detailsMatch = text.match(/details:\s*\n((?:^[ \t]*-[ \t].*\n?)+)/im);
	const details = detailsMatch
		? detailsMatch[1]
				.split("\n")
				.map((line) => line.replace(/^[ \t]*-[ \t]*/, "").trim())
				.filter((line) => line.length > 0)
				.slice(0, 4)
				.map((line) => line.slice(0, 200))
		: [];
	return {
		level: verdict[1].toLowerCase() as VerdictLevel,
		summary: (summary?.[1] ?? "").trim().slice(0, 200),
		details,
	};
}

/** 无守卫的单次审计;冷却互斥由 Auditor 负责。 */
export async function runAudit(
	registry: ModelRegistry,
	model: AnyModel,
	input: { goal: string; digest: string },
	options: CallOptions = {},
): Promise<Verdict | undefined> {
	const goal = input.goal ? `用户目标:${input.goal}\n\n` : "";
	const result = await completeText(
		registry,
		model,
		{
			systemPrompt: AUDIT_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: `${goal}近期动作:\n${input.digest}` }],
					timestamp: Date.now(),
				},
			],
		},
		options,
	);
	if (!result.ok) return undefined;
	return parseVerdict(result.text);
}

/** 冷却 + 互斥的审计器:advisor(turn_end)与 heads-up(去抖)共用一个实例各管各的。 */
export class Auditor {
	private inFlight = false;
	private lastRunAt = Number.NEGATIVE_INFINITY;
	private readonly minIntervalMs: number;
	private readonly now: () => number;

	constructor(options: { minIntervalMs?: number; now?: () => number } = {}) {
		this.minIntervalMs = options.minIntervalMs ?? 60_000;
		this.now = options.now ?? Date.now;
	}

	/** 此刻 run 会放行:不在途且已过冷却。调用方据此决定是否先消费累积的输入。 */
	get ready(): boolean {
		return !this.inFlight && this.now() - this.lastRunAt >= this.minIntervalMs;
	}

	async run(
		registry: ModelRegistry,
		model: AnyModel,
		input: { goal: string; digest: string },
		options: CallOptions = {},
	): Promise<Verdict | undefined> {
		if (!this.ready) return undefined;
		this.inFlight = true;
		this.lastRunAt = this.now();
		try {
			return await runAudit(registry, model, input, options);
		} catch {
			return undefined; // 静默降级
		} finally {
			this.inFlight = false;
		}
	}
}
