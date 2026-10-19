/**
 * llm.ts — 旁路模型调用封装。
 *
 * 经 ctx.modelRegistry.complete() 调 provider 模型：
 * - resolveModel(registry, "provider/model-id") 解析配置串，未配置/找不到时
 *   回退当前模型；
 * - completeText() 统一超时与 AbortController（idle 时 ctx.signal 不存在，
 *   旁路调用用自有 controller，session_shutdown 统一 abort）。
 *
 * 三个功能（headsup / advisor / hint）共用这一层，不直接碰 modelRegistry。
 * 失败一律返回 { ok: false, reason }，不抛异常进 pi 事件循环。
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ModelRegistry = ExtensionContext["modelRegistry"];
export type AnyModel = NonNullable<ExtensionContext["model"]>;
export type LlmContext = Parameters<ModelRegistry["complete"]>[1];

export type CompleteResult = { ok: true; text: string } | { ok: false; reason: string };

/** 解析 "provider/model-id"；缺参或找不到时回退 fallback（通常是当前模型）。 */
export function resolveModel(
	registry: ModelRegistry,
	spec: string | undefined,
	fallback: AnyModel | undefined,
): AnyModel | undefined {
	if (!spec) return fallback;
	const slash = spec.indexOf("/");
	if (slash <= 0 || slash === spec.length - 1) return fallback;
	const found = registry.find(spec.slice(0, slash), spec.slice(slash + 1));
	return (found as AnyModel | undefined) ?? fallback;
}

/**
 * 非流式补全，统一超时与中断。外部 signal（如 session_shutdown）触发时
 * 一并 abort；超时、stopReason 非 stop、空文本都算失败，原因写进 reason。
 */
export async function completeText(
	registry: ModelRegistry,
	model: AnyModel,
	context: LlmContext,
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CompleteResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
	const onOuterAbort = () => controller.abort();
	options.signal?.addEventListener("abort", onOuterAbort, { once: true });
	try {
		const response = await registry.complete(model, context, { signal: controller.signal });
		if (response.stopReason !== "stop") {
			return { ok: false, reason: `stopReason=${response.stopReason}` };
		}
		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();
		if (!text) return { ok: false, reason: "empty response" };
		return { ok: true, text };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", onOuterAbort);
	}
}
