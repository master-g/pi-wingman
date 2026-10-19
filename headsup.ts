/**
 * headsup.ts — 主 agent 工作时的自动审计告警（M3 实现）。
 *
 * 监听 tool_execution_end 聚合动作，去抖（~8s 或每 6 次调用）后走
 * audit.ts 管线；结果非 ok 时 ctx.ui.notify() + widget 行提示用户。
 *
 * 只读旁路：永不阻塞 tool_call，错误静默降级（保留 last-good）。
 * 与 advisor 的区别：只告警给用户，不注入主 agent 上下文。
 */

// TODO(M3): HeadsupController（事件订阅、去抖、notify、widget 更新）。
export {};
