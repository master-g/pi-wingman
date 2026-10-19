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

import { completeText, messageText, type AnyModel, type LlmContext, type ModelRegistry } from "./llm.js";

export type VerdictLevel = "ok" | "note" | "concern" | "blocker";

export interface Verdict {
	level: VerdictLevel;
	/** 一句话说明,给用户或主 agent 看 */
	summary: string;
}

export type DigestMessage = LlmContext["messages"][number];

export interface DigestOptions {
	maxMessages?: number;
	perMessageChars?: number;
}

const AUDIT_SYSTEM_PROMPT = `你是编程 agent 的旁路审计员。给你用户的目标和 agent 近期动作摘要,判断 agent 是否走在正确的路上。

只输出两行,不要任何其他内容:
VERDICT: <ok|note|concern|blocker>
SUMMARY: <一句话,≤120 字符,用中文>

级别含义:
- blocker:正在犯错且会造成实质损失(破坏数据、违背用户目标、在错误的方向上大量返工),必须立即纠偏
- concern:方向可疑或明显浪费(改错文件、绕过而非修复、重复无效尝试),值得提醒
- note:方向正确,但有一个可选的改进建议
- ok:一切正常,无话可说

宁缺毋滥:不确定时选 ok。带 [wingman advisor 标记的消息是顾问自己之前的旁注,不要评论它。`;

function toolCallsOf(message: DigestMessage): { name: string; snippet: string }[] {
	if (!("content" in message)) return [];
	const content = (message as { content: unknown }).content;
	if (!Array.isArray(content)) return [];
	return content
		.filter((c): c is { type: string; name?: unknown; arguments?: unknown } => c.type === "toolCall")
		.map((c) => ({
			name: typeof c.name === "string" ? c.name : "unknown",
			snippet: JSON.stringify(c.arguments ?? {}).slice(0, 120),
		}));
}

/** 把近期消息压成审计用摘要:role 前缀 + 截断正文 + 工具调用/结果行。 */
export function buildDigest(messages: DigestMessage[], options: DigestOptions = {}): string {
	const { maxMessages = 12, perMessageChars = 300 } = options;
	const lines: string[] = [];
	for (const message of messages.slice(-maxMessages)) {
		const role = "role" in message ? String((message as { role: unknown }).role) : "unknown";
		if (role === "toolResult") {
			const m = message as { toolName?: unknown; isError?: unknown };
			const name = typeof m.toolName === "string" ? m.toolName : "tool";
			const error = m.isError === true ? " ERROR" : "";
			lines.push(`[toolResult ${name}]${error} ${messageText(message).slice(0, perMessageChars)}`.trimEnd());
			continue;
		}
		const text = messageText(message).slice(0, perMessageChars);
		const calls = toolCallsOf(message)
			.map((c) => `→ ${c.name}(${c.snippet})`)
			.join(" ");
		lines.push(`[${role}] ${text}${text && calls ? " " : ""}${calls}`.trimEnd());
	}
	return lines.join("\n");
}

/** 解析审计模型的两行输出;没有 VERDICT 行视为无效。 */
export function parseVerdict(text: string): Verdict | undefined {
	const verdict = text.match(/verdict:\s*(ok|note|concern|blocker)/i);
	if (!verdict) return undefined;
	const summary = text.match(/summary:\s*(.+)/i);
	return {
		level: verdict[1].toLowerCase() as VerdictLevel,
		summary: (summary?.[1] ?? "").trim().slice(0, 200),
	};
}

/** 无守卫的单次审计;冷却互斥由 Auditor 负责。 */
export async function runAudit(
	registry: ModelRegistry,
	model: AnyModel,
	input: { goal: string; digest: string },
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
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
		{ timeoutMs: options.timeoutMs ?? 15_000, signal: options.signal },
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

	async run(
		registry: ModelRegistry,
		model: AnyModel,
		input: { goal: string; digest: string },
		options: { timeoutMs?: number; signal?: AbortSignal } = {},
	): Promise<Verdict | undefined> {
		if (this.inFlight || this.now() - this.lastRunAt < this.minIntervalMs) return undefined;
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
