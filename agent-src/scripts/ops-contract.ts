#!/usr/bin/env node

/**
 * ops-contract.ts — 运营指令契约（contract/operations.json）的加载、校验与渲染
 *
 * 职责：
 *   1. 读取契约与 JSON Schema，做结构校验（Ajv draft-07）
 *   2. 校验 schema 表达不了的语义不变量（唯一 ID、L3 集合、前置条件完整性等）
 *   3. 把契约渲染成 COMMANDS.md / .pi/commands.md 两份人读文档
 *
 * 契约是唯一来源；两份 markdown 都是生成物，CI 用 `--check` 保证不漂移。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** agent-src/ 根目录（在 ops 仓库中即仓库根目录） */
export const PROJECT_ROOT = path.resolve(HERE, "..");

export const CONTRACT_PATH = path.join(PROJECT_ROOT, "contract", "operations.json");
export const SCHEMA_PATH = path.join(PROJECT_ROOT, "contract", "operations.schema.json");
export const COMMANDS_PATH = path.join(PROJECT_ROOT, "COMMANDS.md");
export const PI_COMMANDS_PATH = path.join(PROJECT_ROOT, ".pi", "commands.md");

// ══════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════

export type LevelId = "L1" | "L2" | "L3";

export interface LevelDef {
  name: string;
  merge: "none" | "after-confirm" | "human-only";
  mergeText: string;
}

export interface DocDef {
  title: string;
  paragraphs: string[];
  bullets: string[];
}

export interface ConfirmationDef {
  id: string;
  label: string;
  text: string;
}

export interface ImpactDef {
  id: string;
  label: string;
  mode: "dynamic" | "fixed";
  calc: string;
}

export interface RuntimeBullet {
  text: string;
  children?: string[];
}

export interface RuntimeDef {
  intro: string;
  bullets: RuntimeBullet[];
}

export interface CommandDef {
  id: string;
  title: string;
  level: LevelId;
  confirmation?: string;
  impacts?: string[];
  preconditions?: string[];
  onReject?: string;
  description?: string;
}

export interface DomainDef {
  id: string;
  title: string;
  level: LevelId;
  summary?: string;
  notes?: string[];
  commands: CommandDef[];
}

export interface HandoffDef {
  scenario: string;
  owner: string;
  note: string;
}

export interface ResetRow {
  block: string;
  default: string;
  note: string;
}

export interface RejectRow {
  reject: string;
  next: string;
}

export interface OperationsContract {
  version: number;
  doc: DocDef;
  levels: Record<LevelId, LevelDef>;
  levelPolicy: {
    defaultWrite: LevelId;
    l3Commands: string[];
  };
  confirmations: ConfirmationDef[];
  impacts: ImpactDef[];
  rules: string[];
  runtime: RuntimeDef;
  domains: DomainDef[];
  handoffs: HandoffDef[];
  resetMatrix: ResetRow[];
  archiveBranchFormat: string;
  rejects: RejectRow[];
  prohibitions: string[];
}

// ══════════════════════════════════════════════════════════════
// 加载
// ══════════════════════════════════════════════════════════════

function readJson(file: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`无法读取 ${file}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`${file} 不是合法 JSON：${(err as Error).message}`);
  }
}

export function loadContract(): OperationsContract {
  return readJson(CONTRACT_PATH) as OperationsContract;
}

// ══════════════════════════════════════════════════════════════
// 校验
// ══════════════════════════════════════════════════════════════

/**
 * 结构校验 + 语义不变量校验。
 * 返回人类可读的错误列表；空数组表示契约合法。
 */
export function validateContract(contract: unknown): string[] {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = readJson(SCHEMA_PATH);
  const validate = ajv.compile(schema as boolean | object);
  const pass = validate(contract);

  const errors: string[] = [];
  if (!pass) {
    for (const err of validate.errors ?? []) {
      const at = err.instancePath.length > 0 ? err.instancePath : "/";
      errors.push(`schema ${at}: ${err.message ?? "不合法"}`);
    }
    return errors;
  }

  errors.push(...checkInvariants(contract as OperationsContract));
  return errors;
}

/** schema 无法表达的语义不变量。 */
export function checkInvariants(contract: OperationsContract): string[] {
  const errors: string[] = [];

  // 0. 引用表自身唯一
  const confirmationIds = new Set<string>();
  for (const item of contract.confirmations) {
    if (confirmationIds.has(item.id)) errors.push(`确认强度 id 重复：${item.id}`);
    confirmationIds.add(item.id);
  }
  const impactIds = new Set<string>();
  for (const item of contract.impacts) {
    if (impactIds.has(item.id)) errors.push(`影响标记 id 重复：${item.id}`);
    impactIds.add(item.id);
  }

  const domainIds = new Set<string>();
  const commandIds = new Set<string>();
  const l3Declared = new Set(contract.levelPolicy.l3Commands);
  const commands: Array<{ domain: DomainDef; command: CommandDef }> = [];

  for (const domain of contract.domains) {
    if (domainIds.has(domain.id)) errors.push(`业务域 id 重复：${domain.id}`);
    domainIds.add(domain.id);

    for (const command of domain.commands) {
      if (commandIds.has(command.id)) {
        errors.push(`重复指令 id：${command.id}`);
      }
      commandIds.add(command.id);

      const prefix = command.id.split(".")[0];
      if (prefix !== domain.id) {
        errors.push(`指令 ${command.id} 的前缀与所在域 ${domain.id} 不一致`);
      }

      if (command.level === "L1") {
        if (domain.level !== "L1") errors.push(`只读指令 ${command.id} 不得出现在非 L1 域 ${domain.id}`);
        if (command.confirmation) errors.push(`只读指令 ${command.id} 不得声明 confirmation`);
        if (command.impacts && command.impacts.length > 0) errors.push(`只读指令 ${command.id} 不得声明 impacts`);
        if (command.preconditions) errors.push(`只读指令 ${command.id} 不得声明 preconditions`);
        if (command.onReject) errors.push(`只读指令 ${command.id} 不得声明 onReject`);
        if (!command.description) errors.push(`只读指令 ${command.id} 缺少 description`);
      } else {
        if (domain.level === "L1") errors.push(`L1 域 ${domain.id} 中出现了写指令 ${command.id}`);

        if (!command.confirmation) {
          errors.push(`写指令 ${command.id} 缺少 confirmation`);
        } else if (!confirmationIds.has(command.confirmation)) {
          errors.push(`写指令 ${command.id} 引用了未定义的确认强度：${command.confirmation}`);
        }

        if (!command.preconditions || command.preconditions.length === 0) {
          errors.push(`写指令 ${command.id} 缺少 preconditions`);
        }
        if (!command.onReject) errors.push(`写指令 ${command.id} 缺少 onReject`);

        for (const impact of command.impacts ?? []) {
          if (!impactIds.has(impact)) errors.push(`写指令 ${command.id} 引用了未定义的影响标记：${impact}`);
        }
      }

      commands.push({ domain, command });
    }
  }

  // L3 集合严格相等：声明 = 实际，不多不少
  for (const id of l3Declared) {
    const entry = commands.find((x) => x.command.id === id);
    if (!entry) {
      errors.push(`levelPolicy.l3Commands 引用了不存在的指令：${id}`);
    } else if (entry.command.level !== "L3") {
      errors.push(`levelPolicy.l3Commands 中的 ${id} 实际级别是 ${entry.command.level}，不是 L3`);
    }
  }
  for (const { command } of commands) {
    if (command.level === "L3" && !l3Declared.has(command.id)) {
      errors.push(`L3 指令 ${command.id} 未列入 levelPolicy.l3Commands`);
    }
  }

  // 确认强度与级别一致：L3 ⇔ 短语 + 人工合并
  for (const { command } of commands) {
    if (command.level === "L3" && command.confirmation !== "phrase-human-merge") {
      errors.push(`L3 指令 ${command.id} 的 confirmation 必须是 phrase-human-merge`);
    }
    if (command.level !== "L3" && command.confirmation === "phrase-human-merge") {
      errors.push(`非 L3 指令 ${command.id} 不得使用 phrase-human-merge`);
    }
  }

  return errors;
}

// ══════════════════════════════════════════════════════════════
// 渲染
// ══════════════════════════════════════════════════════════════

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [head, sep, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function confirmationLabel(contract: OperationsContract, id: string | undefined): string {
  if (!id) return "";
  return contract.confirmations.find((x) => x.id === id)?.label ?? id;
}

function impactsText(contract: OperationsContract, ids: string[] | undefined): string {
  if (!ids || ids.length === 0) return "—";
  const dynamic = ids.map((id) => contract.impacts.find((x) => x.id === id)?.mode === "dynamic");
  if (dynamic.every(Boolean)) {
    return `动态 ${ids.map((id) => `\`${id}\``).join(" / ")}`;
  }
  return ids
    .map((id, index) => (dynamic[index] ? `动态 \`${id}\`` : `\`${id}\``))
    .join(" / ");
}

/** 把契约渲染成完整的人读文档（COMMANDS.md 与 .pi/commands.md 内容一致）。 */
export function renderCommandsDoc(contract: OperationsContract): string {
  const lines: string[] = [];
  const commandIndex = new Map<string, CommandDef>();
  for (const domain of contract.domains) {
    for (const command of domain.commands) commandIndex.set(command.id, command);
  }

  lines.push(`# ${contract.doc.title}`, "");
  lines.push(
    "> 本文件由 `contract/operations.json` 生成，请勿手改；修改契约后运行 `npm run contract:gen`。",
    "",
  );
  for (const paragraph of contract.doc.paragraphs) lines.push(paragraph, "");
  for (const bullet of contract.doc.bullets) lines.push(`- ${bullet}`);
  lines.push("");

  // ── 1. 三级指令 ────────────────────────────────────────────
  lines.push("## 1. 三级指令", "");
  lines.push(
    table(
      ["级别", "含义", "合并方式"],
      (["L1", "L2", "L3"] as const).map((level) => [
        `**${level}**`,
        contract.levels[level].name,
        contract.levels[level].mergeText,
      ]),
    ),
    "",
  );
  const l3Titles = contract.levelPolicy.l3Commands.map(
    (id) => commandIndex.get(id)?.title ?? id,
  );
  lines.push(`- L3 只有：${l3Titles.join("、")}。`);
  lines.push(`- 其他写操作一律 ${contract.levelPolicy.defaultWrite}。`, "");

  // ── 2. 确认强度 ────────────────────────────────────────────
  lines.push("## 2. 确认强度", "");
  lines.push(
    table(
      ["强度", "操作者确认方式"],
      contract.confirmations.map((item) => [item.label, item.text]),
    ),
    "",
  );

  // ── 3. 影响标记 ────────────────────────────────────────────
  lines.push("## 3. 影响标记", "");
  lines.push(
    table(
      ["标记", "含义", "计算方式"],
      contract.impacts.map((item) => [`\`${item.id}\``, item.label, item.calc]),
    ),
    "",
  );
  lines.push("影响标记只用于预览高亮与合并后提示，**不改变级别**。", "");

  // ── 4. 通用规则 ────────────────────────────────────────────
  lines.push("## 4. 通用规则", "");
  contract.rules.forEach((rule, index) => lines.push(`${index + 1}. ${rule}`));
  lines.push("", "### 4.1 运行环境适配", "", contract.runtime.intro, "");
  for (const bullet of contract.runtime.bullets) {
    lines.push(`- ${bullet.text}`);
    for (const child of bullet.children ?? []) lines.push(`  - ${child}`);
  }
  lines.push("");

  // ── 5. 指令表 ──────────────────────────────────────────────
  lines.push("## 5. 指令表", "");
  for (const domain of contract.domains) {
    const heading = domain.level === "L1" ? `${domain.title}（L1）` : domain.title;
    lines.push(`### ${heading}`, "");

    if (domain.level === "L1") {
      lines.push(
        table(
          ["指令", "说明"],
          domain.commands.map((command) => [command.title, command.description ?? ""]),
        ),
        "",
      );
      if (domain.summary) lines.push(domain.summary, "");
      continue;
    }

    lines.push(
      table(
        ["指令", "级别", "确认", "影响", "前置条件", "拒绝后下一步"],
        domain.commands.map((command) => [
          `**${command.title}**`,
          command.level,
          confirmationLabel(contract, command.confirmation),
          impactsText(contract, command.impacts),
          (command.preconditions ?? []).join("；"),
          command.onReject ?? "",
        ]),
      ),
      "",
    );

    if (domain.notes && domain.notes.length > 0) {
      lines.push("说明：", "");
      for (const note of domain.notes) lines.push(`- ${note}`);
      lines.push("");
    }
  }

  // ── 6. 跨域交接 ────────────────────────────────────────────
  lines.push("## 6. 跨域交接", "");
  lines.push(
    table(
      ["场景", "规则归属", "交接"],
      contract.handoffs.map((item) => [item.scenario, item.owner, item.note]),
    ),
    "",
  );

  // ── 7. 换届继承 / 重置 ─────────────────────────────────────
  lines.push("## 7. 换届继承 / 重置", "");
  lines.push(
    table(
      ["块", "默认", "说明"],
      contract.resetMatrix.map((item) => [item.block, item.default, item.note]),
    ),
    "",
  );
  lines.push(`换届前给旧赛事打归档标记：\`${contract.archiveBranchFormat}\`。`, "");

  // ── 8. 常见拒绝与下一步 ────────────────────────────────────
  lines.push("## 8. 常见拒绝与下一步", "");
  lines.push(
    table(
      ["拒绝", "下一步"],
      contract.rejects.map((item) => [item.reject, item.next]),
    ),
    "",
  );

  // ── 9. 禁止 ────────────────────────────────────────────────
  lines.push("## 9. 禁止", "");
  for (const item of contract.prohibitions) lines.push(`- ${item}`);
  lines.push("");

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
