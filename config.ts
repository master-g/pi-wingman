/**
 * config.ts — wingman 配置：读写 ~/.pi/agent/wingman.json。
 *
 * 三个功能各自独立开关；模型形如 "provider/model-id"。未配置模型时
 * 各模块自行回退：hint 用当前模型，advisor/heads-up 保持关闭。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

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
	hint: { enabled: true },
};

export function configPath(): string {
	return join(homedir(), ".pi", "agent", "wingman.json");
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
	let raw: Partial<WingmanConfig> = {};
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
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
