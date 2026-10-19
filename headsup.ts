/**
 * headsup.ts — 主 agent 工作时后台去抖审计,提前发现潜在问题
 * (交互对齐 Claude Code heads-up 真实样例)。
 *
 * 触发:tool_execution_end 聚合,去抖 ~8s 或攒够 batchSize 次 → 复用
 * audit.ts 的 Auditor;只有 concern/blocker 上屏,ok/note 静默;失败
 * 静默降级(保留 last-good,即不清已显示的 finding)。
 *
 * widget 三态(挂载于 belowEditor,出现时挂载、dismiss 即卸载):
 *   折叠:`✦ Heads up · <一句话>` + `1: 展开  2: 已知悉  0: 忽略`
 *   展开:标题 + 要点列表 + `1: 知道了  2: 带到主会话  0: 忽略`
 *   带到主会话:setEditorText 填入引用块,用户自己编辑/发送(不自动注入)
 * 数字键仅编辑器为空时被 WingmanEditor 捕获,其余按键照常输入。
 * 忽略/已知悉/知道了都把发现记入本会话抑制集,同一发现不再弹(v1 同义)。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { appendFileSync } from "node:fs";
import { Auditor, type VerdictLevel } from "./audit.js";
import type { WingmanConfig } from "./config.js";
import type { EditorManager } from "./editor.js";
import { resolveModel } from "./llm.js";

export interface HeadsUpFinding {
	level: VerdictLevel;
	summary: string;
	details: string[];
}

export type HeadsUpAction = "none" | "expanded" | "dismissed" | "copied";

const WIDGET_KEY = "wingman-headsup";
const LEVEL_COLOR: Record<string, string> = { concern: "\x1b[33m", blocker: "\x1b[31m" };

/** WINGMAN_DEBUG=1 时把管线决策追加到 /tmp/wingman-debug.log;旁路默认静默,这是唯一的观测口。 */
function debug(message: string): void {
	if (!process.env.WINGMAN_DEBUG) return;
	try {
		appendFileSync("/tmp/wingman-debug.log", `${new Date().toISOString()} ${message}\n`);
	} catch {
		// 调试通道自身永不抛错
	}
}

export class HeadsUpView {
	private finding: HeadsUpFinding | undefined;
	private expanded = false;
	private lastCopyText = "";
	private readonly suppressed = new Set<string>();

	private key(finding: HeadsUpFinding): string {
		return `${finding.level}:${finding.summary}`;
	}

	/** 上屏新发现;同一发现(level+summary)已被抑制时返回 false。 */
	show(finding: HeadsUpFinding): boolean {
		if (this.suppressed.has(this.key(finding))) return false;
		this.finding = finding;
		this.expanded = false;
		return true;
	}

	hasPending(): boolean {
		return this.finding !== undefined;
	}

	/**
	 * 三态按键:折叠时 1 展开、0/2 忽略/已知悉(v1 同义,都抑制);
	 * 展开时 1 知道了、0 忽略(都 dismiss)、2 拷贝引用块后 dismiss
	 * (文本经 takeCopyText 取走)。
	 */
	handleKey(key: "0" | "1" | "2"): HeadsUpAction {
		if (!this.finding) return "none";
		if (!this.expanded && key === "1") {
			this.expanded = true;
			return "expanded";
		}
		if (this.expanded && key === "2") {
			this.lastCopyText = this.copyText();
			this.dismiss();
			return "copied";
		}
		this.dismiss();
		return "dismissed";
	}

	private dismiss(): void {
		if (this.finding) this.suppressed.add(this.key(this.finding));
		this.finding = undefined;
		this.expanded = false;
	}

	/** 取走上次「带到主会话」生成的引用块,取走即清。 */
	takeCopyText(): string {
		const text = this.lastCopyText;
		this.lastCopyText = "";
		return text;
	}

	/** 当前状态的渲染行;无 finding 时为空数组。每行已按宽度截断。 */
	lines(width: number): string[] {
		if (!this.finding) return [];
		const color = LEVEL_COLOR[this.finding.level] ?? "";
		const title = `✦ Heads up · ${color}${this.finding.summary}\x1b[0m`;
		const options = this.expanded
			? "\x1b[2m  1: 知道了  2: 带到主会话  0: 忽略\x1b[0m"
			: "\x1b[2m  1: 展开  2: 已知悉  0: 忽略\x1b[0m";
		const lines = this.expanded
			? [title, "", ...this.finding.details.map((d) => `- ${d}`), "", options]
			: [title, options];
		return lines.map((line) => truncateToWidth(line, width));
	}

	/** 当前 finding 的引用块格式(「带到主会话」内容)。 */
	private copyText(): string {
		if (!this.finding) return "";
		const quoted = [`> Heads up · ${this.finding.summary}`];
		if (this.finding.details.length > 0) {
			quoted.push(">");
			for (const detail of this.finding.details) quoted.push(`> - ${detail}`);
		}
		return `Here is a note offered by a side agent:\n\n${quoted.join("\n")}`;
	}

	/** 会话重置:清 finding、展开态、拷贝缓存与抑制集。 */
	reset(): void {
		this.finding = undefined;
		this.expanded = false;
		this.lastCopyText = "";
		this.suppressed.clear();
	}
}

export interface ToolEventRecord {
	toolName: string;
	isError: boolean;
	snippet: string;
}

export function formatToolEvents(events: ToolEventRecord[]): string {
	return events
		.map((e) => `${e.toolName} → ${e.isError ? "ERROR" : "ok"}${e.snippet ? ` | ${e.snippet}` : ""}`)
		.join("\n");
}

function snippetOf(result: unknown): string {
	const raw = typeof result === "string" ? result : JSON.stringify(result) || "";
	return raw.replace(/\s+/g, " ").slice(0, 100);
}

export interface HeadsUpOptions {
	batchSize?: number;
	debounceMs?: number;
	minIntervalMs?: number;
}

export function installHeadsUp(
	pi: ExtensionAPI,
	getConfig: () => WingmanConfig,
	editors: EditorManager,
	options: HeadsUpOptions = {},
): void {
	const batchSize = options.batchSize ?? 6;
	const debounceMs = options.debounceMs ?? 8_000;
	const auditor = new Auditor({ minIntervalMs: options.minIntervalMs ?? 30_000 });
	const view = new HeadsUpView();
	const shutdown = new AbortController();
	let pending: ToolEventRecord[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastGoal = "";
	let lastCtx: ExtensionContext | undefined;
	let activeTui: { requestRender(): void } | undefined;
	let widgetShown = false;

	const hideWidget = () => {
		if (!widgetShown) return;
		widgetShown = false;
		activeTui = undefined;
		lastCtx?.ui.setWidget(WIDGET_KEY, undefined);
	};

	const showWidget = (ctx: ExtensionContext) => {
		if (widgetShown) return;
		widgetShown = true;
		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui) => {
				activeTui = tui;
				return {
					render: (width: number) => view.lines(width),
					invalidate: () => {},
					dispose: () => {
						activeTui = undefined;
					},
				};
			},
			{ placement: "belowEditor" },
		);
	};

	const flush = async (ctx: ExtensionContext): Promise<void> => {
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
		const events = pending;
		pending = [];
		if (events.length === 0) return;
		const config = getConfig().headsup;
		// heads-up 必须显式配置模型才激活(开启必经 /headsup <model>)
		if (!config.enabled || !config.model) {
			debug(`flush 跳过:enabled=${config.enabled} model=${config.model}`);
			return;
		}
		const model = resolveModel(ctx.modelRegistry, config.model, ctx.model);
		if (!model) {
			debug(`flush 跳过:模型无法解析 ${config.model}`);
			return;
		}
		debug(`flush: ${events.length} 个事件送审计`);
		const verdict = await auditor.run(
			ctx.modelRegistry,
			model,
			{ goal: lastGoal, digest: formatToolEvents(events) },
			{ timeoutMs: 15_000, signal: shutdown.signal },
		);
		debug(`verdict: ${verdict ? `${verdict.level} ${verdict.summary}` : "(调用失败/跳过)"}`);
		if (!verdict || (verdict.level !== "concern" && verdict.level !== "blocker")) return;
		if (!view.show(verdict)) {
			debug("已在抑制集,不上屏");
			return;
		}
		showWidget(ctx);
		debug("上屏");
	};

	// 数字键捕获:仅编辑器为空时由 WingmanEditor 调用;已知限制——
	// 有 pending heads-up 时,空编辑器里输入 0/1/2 开头的文本会被当作命令
	// (对齐 Claude Code 的行为)。
	editors.headsUpHandler = (key) => {
		if (!view.hasPending() || !lastCtx) return false;
		const action = view.handleKey(key);
		if (action === "expanded") {
			activeTui?.requestRender();
			return true;
		}
		if (action === "copied") {
			const text = view.takeCopyText();
			hideWidget();
			lastCtx.ui.setEditorText(text);
			return true;
		}
		if (action === "dismissed") {
			hideWidget();
			return true;
		}
		return false;
	};

	pi.on("before_agent_start", (event) => {
		if (event.messageType === "user") lastGoal = event.prompt;
	});

	pi.on("tool_execution_end", (event, ctx) => {
		lastCtx = ctx;
		const config = getConfig().headsup;
		if (!config.enabled || !config.model || ctx.mode !== "tui") return;
		pending.push({ toolName: event.toolName, isError: event.isError, snippet: snippetOf(event.result) });
		debug(`tool_end ${event.toolName}${event.isError ? " ERROR" : ""} pending=${pending.length}`);
		if (pending.length >= batchSize) return flush(ctx);
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void flush(ctx), debounceMs);
		timer.unref?.();
	});

	pi.on("session_start", (_event, ctx) => {
		lastCtx = ctx;
		view.reset();
		pending = [];
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
	});

	pi.on("session_shutdown", () => {
		shutdown.abort();
		if (timer) clearTimeout(timer);
		hideWidget();
	});
}
