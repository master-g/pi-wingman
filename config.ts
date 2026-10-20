/**
 * config.ts — wingman 配置：读写 <agentDir>/wingman.json（默认 ~/.pi/agent）。
 *
 * 三个功能各自独立开关，默认全关（旁路调用都有成本，须用户显式开启）；
 * 模型形如 "provider/model-id"，effort 是可选思考强度。未配置模型时各模块
 * 自行回退：hint 用当前模型，advisor/heads-up 保持关闭。
 */

import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { strings, type Lang } from "./i18n.js";

export interface FeatureConfig {
	enabled: boolean;
	model?: string;
	effort?: ModelThinkingLevel;
}

export const EFFORTS: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export const isEffort = (value: unknown): value is ModelThinkingLevel =>
	EFFORTS.includes(value as ModelThinkingLevel);

export interface WingmanConfig {
	headsup: FeatureConfig;
	advisor: FeatureConfig;
	hint: FeatureConfig;
	/** 界面与旁路输出语言:"en" / "zh";省略或 "auto" 时按环境变量,兜底英语。 */
	language?: string;
}

export const DEFAULT_CONFIG: WingmanConfig = {
	headsup: { enabled: false },
	advisor: { enabled: false },
	hint: { enabled: false },
};

/** 三个功能键;language 是全局设置,不在其列。 */
export type FeatureName = "headsup" | "advisor" | "hint";

export function configPath(): string {
	return join(getAgentDir(), "wingman.json");
}

function mergeFeature(base: FeatureConfig, override: unknown): FeatureConfig {
	if (typeof override !== "object" || override === null) return { ...base };
	const o = override as Partial<FeatureConfig>;
	return {
		enabled: typeof o.enabled === "boolean" ? o.enabled : base.enabled,
		model: typeof o.model === "string" ? o.model : base.model,
		effort: isEffort(o.effort) ? o.effort : base.effort,
	};
}

export function loadConfig(path: string = configPath()): WingmanConfig {
	let raw: Partial<Record<FeatureName | "language", unknown>> = {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed === "object" && parsed !== null) raw = parsed;
	} catch {
		// 文件不存在或损坏时回退默认配置
	}
	return {
		headsup: mergeFeature(DEFAULT_CONFIG.headsup, raw.headsup),
		advisor: mergeFeature(DEFAULT_CONFIG.advisor, raw.advisor),
		hint: mergeFeature(DEFAULT_CONFIG.hint, raw.hint),
		...(typeof raw.language === "string" ? { language: raw.language } : {}),
	};
}

export function saveConfig(config: WingmanConfig, path: string = configPath()): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`);
}

/** 状态行:"hint: on (provider/model · high)" / "hint: on (current model)" / "hint: off"。 */
export function featureLine(name: string, feature: FeatureConfig, lang: Lang = "en"): string {
	const model = feature.model ?? strings(lang).currentModel;
	const state = feature.enabled ? `on (${feature.effort ? `${model} · ${feature.effort}` : model})` : "off";
	return `${name}: ${state}`;
}

/**
 * 应用配置命令参数:"off" 关闭、"on" 重新开启(都保留已设模型与 effort),
 * "provider/model" 开启并设模型与 effort(档位随模型变,不带即清空),空参只读。返回状态行;模型校验、
 * saveConfig 与后续副作用(如编辑器同步)由调用方负责。
 */
export function applyFeatureArg(
	config: WingmanConfig,
	feature: FeatureName,
	arg: string,
	effort?: ModelThinkingLevel,
	lang: Lang = "en",
): string {
	const value = arg.trim();
	if (value === "off" || value === "on") {
		config[feature] = { ...config[feature], enabled: value === "on" };
	} else if (value) {
		config[feature] = { enabled: true, model: value, effort };
	}
	return featureLine(feature, config[feature], lang);
}
