/**
 * audit.ts — heads-up 与 advisor 共享的审计管线（M2/M3 实现）。
 *
 * 输入：用户目标（before_agent_start 的 prompt）+ 近期工具调用 digest；
 * 输出：Verdict。heads-up 与 advisor 只差输出通道，审计逻辑复用同一份。
 */

export type VerdictLevel = "ok" | "note" | "concern" | "blocker";

export interface Verdict {
	level: VerdictLevel;
	/** 一句话说明，给用户或主 agent 看 */
	summary: string;
}

// TODO(M2): buildDigest(messages) 摘要近期动作；runAudit(model, goal, digest)
// 经 llm.ts 调用，带冷却与互斥。
