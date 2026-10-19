/**
 * hint.ts — 任务结束后的下一步 prompt 建议（M1 实现，参照 Claude Code
 * prompt suggestions）。
 *
 * agent_end 后用便宜模型生成 1 条 ≤120 字符的下一步 prompt。
 * HintEditor extends CustomEditor：编辑器为空且有 pending hint 时渲染暗色
 * ghost text；Tab → 填入（可编辑）；Enter → 填入并提交；其他按键清除。
 * 不拥有的按键全部转发基类。session_start / before_agent_start 清除 hint。
 */

// TODO(M1): HintController（agent_end 订阅、hint 状态机）+ HintEditor。
export {};
