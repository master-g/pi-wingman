/**
 * picker.ts — `/wingman <feature>` 不带值时的交互选择：依次复用 pi 的
 * /model 与 /thinking 选择器选模型和 effort。仅 TUI 可用。
 */

import { clampThinkingLevel, getSupportedThinkingLevels, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
	ModelSelectorComponent,
	ThinkingSelectorComponent,
	type ExtensionContext,
	type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { FeatureConfig } from "./config.js";
import { resolveModel, type AnyModel, type ModelRegistry } from "./llm.js";

export type Picked = { model: AnyModel; effort?: ModelThinkingLevel };

/** 选模型再选 effort;选模型时取消返回 undefined,选 effort 时取消则不设 effort。 */
export async function pickModel(ctx: ExtensionContext, current: FeatureConfig): Promise<Picked | undefined> {
	const registry = ctx.modelRegistry;
	// ponytail: 组件要 ModelRuntime,扩展只拿得到 ModelRegistry;组件只调这 4 个方法,
	// registry 内部也是原样转发。pi 让组件多调方法时会抛错,调用方兜底回退手输。
	const runtime = {
		getAvailableSnapshot: () => registry.getAvailable(),
		getModel: (provider: string, id: string) => registry.find(provider, id),
		getError: () => registry.getError(),
		refresh: (options: Parameters<ModelRegistry["refresh"]>[0]) => registry.refresh(options),
	} as unknown as ModelRuntime;
	const currentModel = resolveModel(registry, current.model, undefined);
	const model = await ctx.ui.custom<AnyModel | undefined>(
		(tui, _theme, _kb, done) => new ModelSelectorComponent(tui, currentModel, runtime, [], done, () => done(undefined)),
	);
	if (!model) return undefined;

	const levels = getSupportedThinkingLevels(model);
	if (levels.length <= 1) return { model };
	const effort = await ctx.ui.custom<ModelThinkingLevel | undefined>(
		(_tui, _theme, _kb, done) =>
			new ThinkingSelectorComponent(clampThinkingLevel(model, current.effort ?? "off"), levels, done, () => done(undefined)),
	);
	return { model, effort };
}
