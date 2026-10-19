/**
 * llm.ts — 旁路模型调用封装（M1 实现）。
 *
 * 经 ctx.modelRegistry.complete() / streamSimple() 调 provider 模型：
 * - resolveModel(registry, "provider/model-id") 解析配置串；
 * - complete() 包装统一超时与 AbortController（idle 时 ctx.signal 不存在，
 *   旁路调用用自有 controller，session_shutdown 统一 abort）。
 *
 * 三个功能（headsup / advisor / hint）共用这一层，不直接碰 modelRegistry。
 */

// TODO(M1): resolveModel + complete 包装。
export {};
