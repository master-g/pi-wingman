import { describe, expect, test } from "bun:test";
import { resolveLang, strings } from "./i18n.js";

describe("resolveLang", () => {
	test("配置优先,zh 开头判中文,en 开头判英文", () => {
		expect(resolveLang("zh-CN", {})).toBe("zh");
		expect(resolveLang("en", {})).toBe("en");
		expect(resolveLang("EN_us", {})).toBe("en");
	});

	test("auto 或缺省时回落环境变量 LC_ALL > LANG", () => {
		expect(resolveLang("auto", { LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" })).toBe("zh");
		expect(resolveLang(undefined, { LANG: "zh_TW.UTF-8" })).toBe("zh");
		expect(resolveLang(undefined, { LC_ALL: "C", LANG: "zh_CN.UTF-8" })).toBe("zh"); // 不识别的值继续下落
	});

	test("pi 无语言设置,无任何线索时兜底英语", () => {
		expect(resolveLang(undefined, {})).toBe("en");
		expect(resolveLang("fr", {})).toBe("en");
	});
});

describe("strings", () => {
	test("两种语言键一致", () => {
		const shape = (o: unknown): unknown =>
			Object.fromEntries(
				Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, typeof v === "object" ? shape(v) : typeof v]),
			);
		expect(shape(strings("en"))).toEqual(shape(strings("zh")));
	});
});
