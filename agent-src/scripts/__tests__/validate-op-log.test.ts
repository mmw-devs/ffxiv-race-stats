// validate-op-log.test.ts — validate-op-log 模块单元测试
// 覆盖：deepDiff、isAncestorField
// 阶段 1/2/3 的端到端通过 validate-data.test.ts 的 fixtures 路径覆盖（CI 集成测试）
import { describe, expect, it } from "vitest";

import { deepDiff, isAncestorField } from "../validate-op-log.js";

// ══════════════════════════════════════════════════════════════
// deepDiff
// ══════════════════════════════════════════════════════════════

describe("deepDiff — 原始值", () => {
  it("相同原始值无变更", () => {
    expect(deepDiff(1, 1)).toEqual([]);
    expect(deepDiff("a", "a")).toEqual([]);
    expect(deepDiff(true, true)).toEqual([]);
    expect(deepDiff(null, null)).toEqual([]);
  });

  it("不同原始值产出单条变更", () => {
    const changes = deepDiff(1, 2);
    expect(changes).toEqual([{ field: "(root)", from: 1, to: 2 }]);
  });

  it("null → 非 null", () => {
    expect(deepDiff(null, 5)).toEqual([{ field: "(root)", from: null, to: 5 }]);
  });

  it("非 null → null", () => {
    expect(deepDiff(5, null)).toEqual([{ field: "(root)", from: 5, to: null }]);
  });
});

describe("deepDiff — 对象", () => {
  it("对象无变更", () => {
    expect(deepDiff({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
  });

  it("对象字段值变化产出 path 路径", () => {
    const changes = deepDiff({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(changes).toEqual([{ field: "b", from: 2, to: 3 }]);
  });

  it("嵌套对象路径用点号分隔", () => {
    const changes = deepDiff({ meta: { status: "live" } }, { meta: { status: "ended" } });
    expect(changes).toEqual([{ field: "meta.status", from: "live", to: "ended" }]);
  });

  it("新增字段产出 from=undefined", () => {
    const changes = deepDiff({ a: 1 }, { a: 1, b: 2 });
    expect(changes).toEqual([{ field: "b", from: undefined, to: 2 }]);
  });

  it("删除字段产出 to=undefined", () => {
    const changes = deepDiff({ a: 1, b: 2 }, { a: 1 });
    expect(changes).toEqual([{ field: "b", from: 2, to: undefined }]);
  });
});

describe("deepDiff — 数组", () => {
  it("相同数组无变更", () => {
    expect(deepDiff([1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it("数组元素变化产出 [i] 路径", () => {
    const changes = deepDiff([1, 2, 3], [1, 9, 3]);
    expect(changes).toEqual([{ field: "[1]", from: 2, to: 9 }]);
  });

  it("数组新增元素", () => {
    const changes = deepDiff([1, 2], [1, 2, 3]);
    expect(changes).toEqual([{ field: "[2]", from: undefined, to: 3 }]);
  });

  it("数组减少元素", () => {
    const changes = deepDiff([1, 2, 3], [1, 2]);
    expect(changes).toEqual([{ field: "[2]", from: 3, to: undefined }]);
  });

  it("数组内嵌套对象", () => {
    const changes = deepDiff([{ id: "a", hp: 10 }], [{ id: "a", hp: 5 }]);
    expect(changes).toEqual([{ field: "[0].hp", from: 10, to: 5 }]);
  });

  it("空数组 → 非空数组", () => {
    // 原 .js 行为：数组元素是对象时作为整体产出，不递归展开子字段
    const changes = deepDiff([], [{ a: 1 }]);
    expect(changes).toEqual([{ field: "[0]", from: undefined, to: { a: 1 } }]);
  });
});

describe("deepDiff — 复杂嵌套", () => {
  it("对象含数组的多层变更", () => {
    const before = { teams: [{ bossHP: 50 }, { bossHP: 30 }] };
    const after = { teams: [{ bossHP: 40 }, { bossHP: 30 }] };
    const changes = deepDiff(before, after);
    expect(changes).toEqual([{ field: "teams[0].bossHP", from: 50, to: 40 }]);
  });

  it("根层对象 → 不同类型（数组）", () => {
    // 原 .js 行为：递归到对象分支，对象 key 与数组 key 取并集遍历
    // 产出 a 删除 + 0/1 新增（与 .js 等价）
    const changes = deepDiff({ a: 1 }, [1, 2]);
    expect(changes).toEqual([
      { field: "a", from: 1, to: undefined },
      { field: "0", from: undefined, to: 1 },
      { field: "1", from: undefined, to: 2 },
    ]);
  });
});

// ══════════════════════════════════════════════════════════════
// isAncestorField
// ══════════════════════════════════════════════════════════════

describe("isAncestorField", () => {
  it("同名字段返回 true", () => {
    expect(isAncestorField("news", "news")).toBe(true);
  });

  it("'.' 边界返回 true", () => {
    expect(isAncestorField("news", "news[2].text")).toBe(true);
    expect(isAncestorField("teams", "teams[0].bossHP")).toBe(true);
  });

  it("'[' 边界返回 true", () => {
    expect(isAncestorField("news[2]", "news[2].text")).toBe(true);
  });

  it("无祖先关系返回 false", () => {
    expect(isAncestorField("news", "teams[0].bossHP")).toBe(false);
    expect(isAncestorField("teams[0]", "teams[1].bossHP")).toBe(false);
  });

  it("前缀相同但非路径分隔的合法前缀也算祖先", () => {
    // "newspaper" 是 "news" 的字面字符串前缀，但不是祖先
    // 此例确认 startsWith 的语义：需要带 "." 或 "[" 才算祖先
    expect(isAncestorField("news", "newspaper")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// 阶段 1/2/3 端到端集成测试通过 validate-data.test.ts 路径覆盖
// 完整提交流程由 ops 仓库 CI 在真实 PR 上验证（GitHub Actions）
// ══════════════════════════════════════════════════════════════

describe("validate-op-log 模块导出完整性", () => {
  it("deepDiff 是函数", () => {
    expect(typeof deepDiff).toBe("function");
  });

  it("isAncestorField 是函数", () => {
    expect(typeof isAncestorField).toBe("function");
  });
});