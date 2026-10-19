/**
 * advisor.ts — 用户指定模型的顾问（M2 实现，参照 oh-my-pi advisor）。
 *
 * 每个 turn_end 把该 turn 摘要发给 advisor 模型；返回 aside/concern/blocker
 * 时以 pi.sendUserMessage(note, { deliverAs: "steer" }) 注入主 agent 纠偏，
 * 同时 notify 用户。注入消息打标，防止 advisor 触发的 turn 再触发 advisor。
 *
 * 另提供 /ask-advisor <问题> 手动咨询当前上下文。
 */

// TODO(M2): AdvisorController（turn_end 订阅、steer 注入、防循环标记）。
export {};
