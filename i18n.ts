/**
 * i18n.ts — wingman 界面与旁路输出的语言解析。
 *
 * pi 本身没有语言设置(settings.json 与运行时都没有 locale 概念),所以语言
 * 解析顺序:wingman.json 的 language 字段("en" / "zh" / "auto") >
 * 环境变量 LC_ALL / LANG(zh 开头判中文) > 兜底英语。UI 文案与
 * hint/advisor/heads-up 提示词的输出语言共用 resolveLang 这一个结果,
 * 各处经 getLang 回调按次取,运行中 /wingman language 改完立即生效。
 */

export type Lang = "en" | "zh";

export function resolveLang(configured?: string, env: NodeJS.ProcessEnv = process.env): Lang {
	const pick = (value?: string): Lang | undefined => {
		const v = value?.trim().toLowerCase();
		if (!v || v === "auto") return undefined;
		if (v.startsWith("zh")) return "zh";
		if (v.startsWith("en")) return "en";
		return undefined;
	};
	return pick(configured) ?? pick(env.LC_ALL) ?? pick(env.LANG) ?? "en";
}

/** 用户可见文案与提示词内标签;两语言键必须一致。 */
export interface WingmanStrings {
	/** featureLine 未配模型时的占位 */
	currentModel: string;
	usageError: (usage: string) => string;
	pickerUnavailable: (reason: string, feature: string) => string;
	modelNotFound: (spec: string) => string;
	supportedEfforts: (spec: string, levels: string) => string;
	needsModel: (feature: string) => string;
	languageValueError: string;
	advisorOff: string;
	askUsage: string;
	advisorModelUnresolvable: (model: string) => string;
	advisorCallFailed: (reason: string) => string;
	advisorInjected: string;
	/** /ask-advisor 注入消息的问答前缀 */
	qaQuestion: string;
	qaAnswer: string;
	unparseableVerdict: (head: string) => string;
	headsupCollapsedOptions: string;
	headsupExpandedOptions: string;
	headsupCopyHeader: string;
	/** 旁路 prompt 里的结构化标签 */
	labels: {
		goal: string;
		recentActions: string;
		none: string;
		advisorQuestion: string;
		latestTranscript: string;
	};
}

const zh: WingmanStrings = {
	currentModel: "当前模型",
	usageError: (usage) => `wingman · 用法 ${usage}`,
	pickerUnavailable: (reason, feature) =>
		`wingman · 选择器不可用(${reason}),改用 /wingman ${feature} <provider/model> [effort]`,
	modelNotFound: (spec) => `wingman · 找不到模型 ${spec}(格式 provider/model-id)`,
	supportedEfforts: (spec, levels) => `wingman · ${spec} 支持的 effort:${levels}`,
	needsModel: (feature) => `wingman · ${feature} 需要模型,先 /wingman ${feature} <provider/model>`,
	languageValueError: "wingman · language 只支持 en / zh / auto",
	advisorOff: "advisor 未启用,先 /wingman advisor <provider/model> 配置",
	askUsage: "用法:/ask-advisor <问题>",
	advisorModelUnresolvable: (model) => `advisor 模型无法解析:${model}`,
	advisorCallFailed: (reason) => `advisor 调用失败:${reason}`,
	advisorInjected: "顾问回答已注入对话",
	qaQuestion: "问",
	qaAnswer: "答",
	unparseableVerdict: (head) => `无法解析裁决:${head}`,
	headsupCollapsedOptions: "  1: 展开  2: 已知悉  0: 忽略",
	headsupExpandedOptions: "  1: 知道了  2: 带到主会话  0: 忽略",
	headsupCopyHeader: "这是旁路 agent 提供的一条提示:",
	labels: {
		goal: "用户目标",
		recentActions: "近期动作",
		none: "(暂无)",
		advisorQuestion: "顾问问题",
		latestTranscript: "近期记录",
	},
};

const en: WingmanStrings = {
	currentModel: "current model",
	usageError: (usage) => `wingman · usage: ${usage}`,
	pickerUnavailable: (reason, feature) =>
		`wingman · picker unavailable (${reason}); use /wingman ${feature} <provider/model> [effort]`,
	modelNotFound: (spec) => `wingman · model not found: ${spec} (expected provider/model-id)`,
	supportedEfforts: (spec, levels) => `wingman · ${spec} supports effort: ${levels}`,
	needsModel: (feature) => `wingman · ${feature} needs a model; run /wingman ${feature} <provider/model> first`,
	languageValueError: "wingman · language must be en, zh, or auto",
	advisorOff: "advisor is off; configure it with /wingman advisor <provider/model>",
	askUsage: "usage: /ask-advisor <question>",
	advisorModelUnresolvable: (model) => `advisor model not resolvable: ${model}`,
	advisorCallFailed: (reason) => `advisor call failed: ${reason}`,
	advisorInjected: "advisor answer injected into the conversation",
	qaQuestion: "Q",
	qaAnswer: "A",
	unparseableVerdict: (head) => `unparseable verdict: ${head}`,
	headsupCollapsedOptions: "  1: expand  2: noted  0: dismiss",
	headsupExpandedOptions: "  1: got it  2: bring to session  0: dismiss",
	headsupCopyHeader: "Here is a note offered by a side agent:",
	labels: {
		goal: "User's goal",
		recentActions: "Recent actions",
		none: "(none)",
		advisorQuestion: "Advisor question",
		latestTranscript: "Latest transcript",
	},
};

const STRINGS: Record<Lang, WingmanStrings> = { en, zh };

export function strings(lang: Lang): WingmanStrings {
	return STRINGS[lang];
}
