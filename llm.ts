/**
 * llm.ts — 旁路模型调用封装。
 *
 * 经 ctx.modelRegistry.streamSimple() 调 provider 模型（provider 中立的选项里
 * 才有 reasoning，complete() 没有）：
 * - resolveModel(registry, "provider/model-id") 解析配置串，未配置/找不到时
 *   回退当前模型；
 * - completeText() 统一超时与 AbortController（idle 时 ctx.signal 不存在，
 *   旁路调用用自有 controller，session_shutdown 统一 abort）。
 *
 * 三个功能（headsup / advisor / hint）共用这一层，不直接碰 modelRegistry。
 * 失败一律返回 { ok: false, reason }，不抛异常进 pi 事件循环。
 */

import { clampThinkingLevel, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ModelRegistry = ExtensionContext["modelRegistry"];
export type AnyModel = NonNullable<ExtensionContext["model"]>;
export type LlmContext = Parameters<ModelRegistry["streamSimple"]>[1];
/** pi-ai 的 Message:按 role 可辨识的联合(system/user/assistant/toolResult)。 */
export type Message = LlmContext["messages"][number];

/** effort 是思考强度,按模型支持的档位校正;未设或 "off" 不开推理。 */
export type CallOptions = { timeoutMs?: number; signal?: AbortSignal; effort?: ModelThinkingLevel };

export type CompleteResult = { ok: true; text: string } | { ok: false; reason: string };

/** 拼接内容块里的文本块。 */
function textOf(content: readonly { type: string }[]): string {
	return content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

/** 提取消息正文的文本块;事件里的 AgentMessage 可能混入无 content 的自定义消息,故守卫数组。 */
export function messageText(message: Message): string {
	const { content } = message;
	if (typeof content === "string") return content;
	return Array.isArray(content) ? textOf(content) : "";
}

/**
 * 解析 "provider/model-id"；缺参或找不到时回退 fallback（hint 传当前模型；
 * advisor/heads-up 传 undefined，拼错模型时不激活而非悄悄用主模型）。
 */
export function resolveModel(
	registry: ModelRegistry,
	spec: string | undefined,
	fallback: AnyModel | undefined,
): AnyModel | undefined {
	if (!spec) return fallback;
	const slash = spec.indexOf("/");
	if (slash <= 0 || slash === spec.length - 1) return fallback;
	return registry.find(spec.slice(0, slash), spec.slice(slash + 1)) ?? fallback;
}

/**
 * 非流式补全，统一超时与中断。外部 signal（如 session_shutdown）触发时
 * 一并 abort；超时、stopReason 非 stop、空文本都算失败，原因写进 reason。
 */
export async function completeText(
	registry: ModelRegistry,
	model: AnyModel,
	context: LlmContext,
	options: CallOptions = {},
): Promise<CompleteResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
	const onOuterAbort = () => controller.abort();
	options.signal?.addEventListener("abort", onOuterAbort, { once: true });
	try {
		const effort = options.effort && clampThinkingLevel(model, options.effort);
		const response = await registry
			.streamSimple(model, context, { signal: controller.signal, reasoning: effort === "off" ? undefined : effort })
			.result();
		if (response.stopReason !== "stop") {
			const detail = response.errorMessage ? `: ${response.errorMessage}` : "";
			return { ok: false, reason: `stopReason=${response.stopReason}${detail}` };
		}
		const text = textOf(response.content).trim();
		if (!text) return { ok: false, reason: "empty response" };
		return { ok: true, text };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", onOuterAbort);
	}
}
