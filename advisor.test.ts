import { describe, expect, test } from "bun:test";
import { ADVISOR_MARKER, AdvisorState, formatAdvisorNote, isAdvisorNote } from "./advisor.js";

describe("isAdvisorNote / formatAdvisorNote", () => {
	test("标记前缀识别", () => {
		expect(isAdvisorNote(`${ADVISOR_MARKER} · 旁注] concern: 改错了`)).toBe(true);
		expect(isAdvisorNote("用户的正常 prompt")).toBe(false);
	});

	test("注入格式:标记 + 级别 + 一句话", () => {
		const note = formatAdvisorNote({ level: "concern", summary: "改错了文件" });
		expect(isAdvisorNote(note)).toBe(true);
		expect(note).toContain("concern: 改错了文件");
	});
});

describe("AdvisorState 防循环", () => {
	test("正常 prompt 更新目标", () => {
		const state = new AdvisorState();
		state.onBeforeAgentStart("把 M2 做完");
		expect(state.goal).toBe("把 M2 做完");
	});

	test("顾问旁注不更新目标,保持原目标", () => {
		const state = new AdvisorState();
		state.onBeforeAgentStart("把 M2 做完");
		state.onBeforeAgentStart(`${ADVISOR_MARKER} · 旁注] note: 顺手改名`);
		expect(state.goal).toBe("把 M2 做完");
	});

	test("注入后下一个 turn 跳过审计,之后恢复", () => {
		const state = new AdvisorState();
		expect(state.shouldAuditTurn()).toBe(true);
		state.markInjected();
		expect(state.shouldAuditTurn()).toBe(false);
		expect(state.shouldAuditTurn()).toBe(true);
	});

	test("steer 被中断时,真实 prompt 到达即重置跳过量", () => {
		const state = new AdvisorState();
		state.markInjected();
		// steer 没产生 turn,用户发来真实 prompt:跳过量应被重置而不是消费在下个 turn
		state.onBeforeAgentStart("新任务");
		expect(state.shouldAuditTurn()).toBe(true);
	});

	test("旁注 run 不重置跳过量:turn_end 仍跳过这一次", () => {
		const state = new AdvisorState();
		state.onBeforeAgentStart("把 M2 做完");
		state.markInjected();
		// steer 触发的 run:before_agent_start 带标记 prompt
		state.onBeforeAgentStart(`${ADVISOR_MARKER} · 旁注] note: x`);
		expect(state.shouldAuditTurn()).toBe(false);
		expect(state.shouldAuditTurn()).toBe(true);
	});
});
