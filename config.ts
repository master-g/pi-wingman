/**
 * config.ts — wingman 配置：读写 <agentDir>/wingman.json（默认 ~/.pi/agent）。
 *
 * 三个功能各自独立开关，默认全关（旁路调用都有成本，须用户显式开启）；
 * 模型形如 "provider/model-id"。未配置模型时各模块自行回退：hint 用当前
 * 模型，advisor/heads-up 保持关闭。
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface FeatureConfig {
	enabled: boolean;
	model?: string;
}

export interface WingmanConfig {
	headsup: FeatureConfig;
	advisor: FeatureConfig;
	hint: FeatureConfig;
}

export const DEFAULT_CONFIG: WingmanConfig = {
	headsup: { enabled: false },
	advisor: { enabled: false },
	hint: { enabled: false },
};

export function configPath(): string {
	return join(getAgentDir(), "wingman.json");
}

function mergeFeature(base: FeatureConfig, override: unknown): FeatureConfig {
	if (typeof override !== "object" || override === null) return { ...base };
	const o = override as Partial<FeatureConfig>;
	return {
		enabled: typeof o.enabled === "boolean" ? o.enabled : base.enabled,
		model: typeof o.model === "string" ? o.model : base.model,
	};
}

export function loadConfig(path: string = configPath()): WingmanConfig {
	let raw: Partial<Record<keyof WingmanConfig, unknown>> = {};
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
	};
}

export function saveConfig(config: WingmanConfig, path: string = configPath()): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(config, null, "\t") + "\n");
}

/** 状态行:"hint: on (provider/model)" / "hint: on (current model)" / "hint: off"。 */
export function featureLine(name: string, feature: FeatureConfig): string {
	const state = feature.enabled ? `on (${feature.model ?? "current model"})` : "off";
	return `${name}: ${state}`;
}

/**
 * 应用配置命令参数:"off" 关闭、"on" 重新开启(都保留已设模型),
 * "provider/model" 开启并设模型,空参只读。返回状态行;模型校验、
 * saveConfig 与后续副作用(如编辑器同步)由调用方负责。
 */
export function applyFeatureArg(
	config: WingmanConfig,
	feature: keyof WingmanConfig,
	arg: string,
): string {
	const value = arg.trim();
	if (value === "off" || value === "on") {
		config[feature] = { ...config[feature], enabled: value === "on" };
	} else if (value) {
		config[feature] = { enabled: true, model: value };
	}
	return featureLine(feature, config[feature]);
}
