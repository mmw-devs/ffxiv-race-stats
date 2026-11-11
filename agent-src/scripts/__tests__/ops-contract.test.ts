// ops-contract.test.ts — 运营指令契约的校验与生成物一致性
// 覆盖：schema 校验、语义不变量、渲染完整性、COMMANDS.md / .pi/commands.md 不漂移
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  COMMANDS_PATH,
  PI_COMMANDS_PATH,
  checkInvariants,
  loadContract,
  renderCommandsDoc,
  validateContract,
} from "../ops-contract.js";
import type { OperationsContract } from "../ops-contract.js";

const contract = loadContract();
const clone = (): OperationsContract => structuredClone(contract);
const doc = (file: string): string => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

describe("contract — 结构校验", () => {
  it("契约本身通过校验", () => {
    expect(validateContract(contract)).toEqual([]);
  });

  it("未知级别被 schema 拒绝", () => {
    const broken = clone();
    Object.assign(broken.domains[1].commands[0] as object, { level: "L4" });
    const errors = validateContract(broken);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("schema");
  });
});

describe("contract — 语义不变量", () => {
  it("重复指令 id 被拒绝", () => {
    const broken = clone();
    broken.domains[1].commands.push({ ...broken.domains[1].commands[0] });
    expect(checkInvariants(broken).join("\n")).toContain("重复指令 id");
  });

  it("L3 指令漏登记被拒绝", () => {
    const broken = clone();
    broken.levelPolicy.l3Commands = broken.levelPolicy.l3Commands.filter(
      (id) => id !== "event.end",
    );
    const errors = checkInvariants(broken).join("\n");
    expect(errors).toContain("event.end");
    expect(errors).toContain("未列入");
  });

  it("L2 指令进 L3 白名单被拒绝", () => {
    const broken = clone();
    broken.levelPolicy.l3Commands.push("progress.update");
    expect(checkInvariants(broken).join("\n")).toContain("progress.update");
  });

  it("L3 缺少前置条件被拒绝", () => {
    const broken = clone();
    delete broken.domains[1].commands[4].preconditions;
    expect(checkInvariants(broken).join("\n")).toContain("preconditions");
  });

  it("L1 指令不得声明确认", () => {
    const broken = clone();
    broken.domains[0].commands[0].confirmation = "plain";
    expect(checkInvariants(broken).join("\n")).toContain("不得声明 confirmation");
  });
});

describe("contract — 生成物", () => {
  it("COMMANDS.md 与渲染一致", () => {
    expect(doc(COMMANDS_PATH)).toBe(renderCommandsDoc(contract));
  });

  it(".pi/commands.md 与渲染一致", () => {
    expect(doc(PI_COMMANDS_PATH)).toBe(renderCommandsDoc(contract));
  });

  it("每条指令都渲染进文档", () => {
    const rendered = renderCommandsDoc(contract);
    for (const domain of contract.domains) {
      for (const command of domain.commands) {
        expect(rendered).toContain(command.title);
      }
    }
  });

  it("L3 清单与契约一致", () => {
    const rendered = renderCommandsDoc(contract);
    const titles = new Map<string, string>();
    for (const domain of contract.domains) {
      for (const command of domain.commands) titles.set(command.id, command.title);
    }
    for (const id of contract.levelPolicy.l3Commands) {
      expect(rendered).toContain(titles.get(id) ?? id);
    }
  });
});
