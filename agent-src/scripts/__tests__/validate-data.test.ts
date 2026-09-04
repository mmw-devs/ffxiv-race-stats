// validate-data.test.ts — data.json 校验脚本单元测试
// 直接调用 main() 而非 spawnSync（vitest 沙箱下 spawnSync 的 result.status 可能返 null）
// 用 vi.spyOn 捕获 console 输出
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../validate-data.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

describe("validate-data.ts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 调用 main(fixturePath)，捕获 console 输出，返回 { status, stdout }。
   */
  function runValidator(fixturePath: string): { status: number | null; output: string } {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let status: number | null = null;
    try {
      status = main(fixturePath);
    } catch (e) {
      errSpy(`uncaught: ${(e as Error).message}`);
    }

    const output = [
      ...logSpy.mock.calls.map((a) => a.join(" ")),
      ...warnSpy.mock.calls.map((a) => a.join(" ")),
      ...errSpy.mock.calls.map((a) => a.join(" ")),
    ].join("\n");

    return { status, output };
  }

  describe("合法 fixtures", () => {
    const validFixtures = [
      "valid/single-dungeon.json",
      "valid/multi-dungeon.json",
      "valid/ended-all-clear.json",
      "valid/upcoming-first-dungeon.json",
    ];

    for (const fixture of validFixtures) {
      it(`${fixture} 应该通过校验`, () => {
        const result = runValidator(join(FIXTURES_DIR, fixture));
        expect(
          result.status,
          `status=${result.status}\noutput:\n${result.output}`,
        ).toBe(0);
      });
    }
  });

  describe("非法 fixtures", () => {
    const cases: Array<{ file: string; desc: string; expectErrorContains: string }> = [
      {
        file: "invalid/phase-unknown-dungeon.json",
        desc: "phase 引用未声明的副本",
        expectErrorContains: "不在 meta.dungeons",
      },
      {
        file: "invalid/phase-format-lowercase.json",
        desc: 'phase 格式小写非法（被分解为副本 id "m1s" 不在 dungeons[] 中）',
        expectErrorContains: '副本 id "m1s" 不在',
      },
      {
        file: "invalid/dungeon-order-violation.json",
        desc: "跨副本顺序违反（M2S 出现但 M1S 还有 P3）",
        expectErrorContains: "副本顺序违反",
      },
      {
        file: "invalid/ended-with-non-clear.json",
        desc: "status=ended 但 phase 非 lastDungeon-CLEAR",
        expectErrorContains: 'status="ended"',
      },
      {
        file: "invalid/duplicate-dungeon-id.json",
        desc: "副本 id 重复",
        expectErrorContains: "重复 id",
      },
    ];

    for (const { file, desc, expectErrorContains } of cases) {
      it(`${file} (${desc}) 应该 fail CI`, () => {
        const result = runValidator(join(FIXTURES_DIR, file));
        expect(result.status).toBe(1);
        expect(result.output).toContain(expectErrorContains);
      });
    }
  });
});