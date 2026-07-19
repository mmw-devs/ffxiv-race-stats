# 运营 Skill 评审报告

> Issue: [#42](https://github.com/mmw-devs/ffxiv-race-stats/issues/42) — 运营 Skill 评审：消除过度工程化
>
> 日期: 2026-07-15
>
> 原则: YAGNI（You Aren't Gonna Need It）— 每个 Skill 必须证明其独立存在的必要性

---

## 1. 评审概述

### 背景

当前 `.pi/skills/` 下存在 6 个 Skill 文件。每次 data.json 修改都需触发多条 Skill 链，Skill 数量增加可能提高 Agent 选择和上下文管理复杂度。本报告按 YAGNI 原则逐项审查，识别可精简的部分，为后续 #43（All-in-One 运营 Skill）设计提供决策依据。

### 审查范围

`.pi/skills/` 下全部 6 个 Skill 文件。

### 判断标准

| # | 标准 | 说明 |
|---|------|------|
| 1 | 可规则替代 | 该 Skill 做的事能否用一句规则描述替代？ |
| 2 | 需多步骤 SOP | 操作是否确实需要多步骤流程，还是只需一个工具 + 一个映射表？ |
| 3 | 删后可用性 | 如果删除它，运营是否还能正常工作？ |

---

## 2. Skill 清单与分类

| Skill | 类型 | 使用频率 | 行数 | 修改 data.json? |
|-------|------|:---:|:---:|:---:|
| `update-team` | 运营 | 🔴 高频（分钟级） | 57 | ✅ |
| `add-news` | 运营 | 🟡 低频（仅通关/重大节点） | 47 | ✅ |
| `add-broadcaster` | 运营 | 🟢 极低频（赛前配置一次） | 50 | ✅ |
| `content-pr` | 流程 | — | 76 | ❌（仅 git/PR） |
| `lark-bot` | 基础设施 | — | 55 | ❌ |
| `lark-cli-capabilities` | 领域索引 | — | 49 | ❌ |

### 使用频率说明

- **🔴 update-team：** 赛事直播期间分钟级触发，是核心高频路径。每次队伍进度变更（phase / bossHP / isLive）都经过此 Skill。
- **🟡 add-news：** 仅在首杀通关、重大事件节点触发。
- **🟢 add-broadcaster：** 赛前配置一次后几乎不再变动。仅在转播方增减时使用。
- **content-pr / lark-bot / lark-cli-capabilities：** 不直接参与数据修改，频率取决于各自触发场景。

---

## 3. 运营 Skill 同构分析

### 3.1 SOP 骨架对比

`update-team`、`add-news`、`add-broadcaster` 三者工作流骨架完全一致：

```
Step 1: 读取 data.json → 定位当前数据
Step 2: 向运营确认操作意图
Step 3: 执行领域校验
Step 4: 修改 data.json 对应字段
Step 5: 调用 content-pr 提交
```

三个文件合计 154 行，**差异仅在于：**

| 差异点 | update-team | add-news | add-broadcaster |
|--------|:-----------:|:--------:|:---------------:|
| 目标字段 | `teams[]` | `news[]` | `broadcasters[]` |
| 校验规则 | phase 不倒退、HP 不增加、通关自动标记 | 标题 ≤50 字、紧急标记 | 平台枚举、URL 格式、名称去重 |
| 操作类型 | 更新已有条目 | 头部插入新条目 | 增/删/改 |

其余——读取确认、调用 content-pr、前置条件检查（/dev 阻断）——完全相同。

### 3.2 频率失衡问题

`update-team` 是高频核心路径，而 `add-news` 和 `add-broadcaster` 是低频甚至一次性操作。当前架构下，三个 Skill 被平等对待：

- 低频 Skill 占用独立文件，可能导致不必要的上下文切换开销
- 高频路径的优化无法自动惠及低频路径

### 3.3 建议评估：合并为声明式映射表

> ⚠️ 以下为建议方向，非执行方案。最终形态需由 #43 设计和运营侧验证。

**方向：** 将三个运营 Skill 的差异（校验规则 + 目标字段）抽取为声明式配置，共用一套执行器。每个操作条目大致包含：目标数据路径、允许修改的字段列表、校验规则。具体 schema 设计由 #43 负责，此处仅提出方向。

**收益：**
- 高频路径获得统一优化（一次加载替代三次 Skill 切换）
- 低频路径零额外维护成本（新增操作仅加一条映射条目）
- 为未来工具检索和能力索引设计提供参考

**风险：**
- 运营工作流变更，需验证 Agent 能否正确按映射表执行
- 校验规则集中后需确保各操作间无冲突

---

## 4. content-pr 分析

### 定位

所有运营侧 data.json 变更的统一提交管道。负责分支创建、push、PR、CI 等待、合并。

### 评估：建议保留

**理由：** `content-pr` 是将 Git 操作从业务 Skill 中抽离的合理抽象。如果不集中管理：

- 每个运营 Skill 需各自实现 PR 流程 → 代码重复
- Git 操作边界模糊 → 安全风险

**关于硬停止机制：** 步骤 2 要求 PR 创建后 Agent 必须停止并等待人工确认"合并"——这是 PR → CI → 生产站链路中唯一的人控闸门。赛事高频场景下的效率问题，建议由 #51（动态合并策略）在数据修改入口侧解决（如批量提交），而非削弱此处的安全确认。

---

## 5. lark-bot 分析

### 定位

飞书消息 ↔ PI Agent 的 RPC 代理。职责：

1. 接收飞书事件 → 清洗为 Agent 可读格式
2. 通过 pi RPC 协议发送 prompt
3. 提取 Agent 回复 → 发回飞书

代码实体在 `.pi/scripts/lark-bot.ts` 和 `.pi/extensions/lark-bot/index.ts`，Skill 文件仅存储操作说明。与 data.json 运营操作无直接关联。

### 评估

在本次审查中，`lark-bot` 更接近飞书基础设施组件，与运营 Skill（直接修改 data.json）的职责边界不同。

### 建议评估：考虑迁移到 extension/tool 目录

- **理由：** 代码已在 `extensions/lark-bot/`，Skill 文件留在 skills 目录下会造成分类混淆（基础设施和运营 Skill 平级）。
- **目标路径：** 待负责人确认。可选 `extension/tool/` 或保留在 `scripts/` 后删除 Skill 包装。
- **注意：** 迁移前需确认 Agent 加载路径和触发逻辑不受影响。

---

## 6. lark-cli-capabilities 分析

### 定位

飞书 CLI 的 12 个操作领域速查表。49 行，无 SOP 流程，纯映射表：

```
| 领域       | 用途           | 查询命令                |
|------------|----------------|------------------------|
| docs       | 云文档创建/搜索 | lark-cli docs --help   |
| sheets     | 电子表格读写   | lark-cli sheets --help |
| ...        | ...            | ...                    |
```

### 评估

从文件内容看，当前形态更接近声明式配置——无流程、无步骤、纯索引。这与三个运营 Skill 形成对比：后者需要合并才能达到这种简洁度，而它无需改动已具备类似形态。

### 建议评估：考虑从 Skill 调整为 Capability Reference

- **理由：** 它不是 SOP（无 Step 1/2/3 流程），而是能力目录。调整定位可避免与运营 Skill 混淆，同时保留其作为"声明式配置参考蓝本"的价值。
- **命名：** 待负责人确认。可选保留原名或改为 `feishu-capabilities`。

---

## 7. 待确认事项

| # | 问题 | 影响范围 |
|---|------|---------|
| 1 | 三合一声明式映射表方向是否认可？ | #43 设计走向，运营工作流 |
| 2 | `lark-bot` 目标路径（`extension/tool/` vs 保留 `scripts/`）？ | 目录结构，Agent 加载路径 |
| 3 | `lark-cli-capabilities` 是否重命名？ | Agent 检索触发 |
| 4 | 合并后校验规则集中化是否有未预见的冲突？ | 运营侧验证 |

---

## 8. 下一步行动

### 立即（本次 PR）

- [x] 产出本评审报告

### 后续（需联动）

| 优先级 | 行动 | 依赖 |
|:---:|------|------|
| P0 | 三合一声明式映射方案评估与设计 | #43 设计完成 + 负责人确认方向 |
| P1 | `lark-bot` 目录迁移 | 确认目标路径 |
| P2 | `lark-cli-capabilities` 定位调整 | 确认命名和加载方式 |
| P3 | 运营侧验证合并方案 | P0 产出原型后 |

---

> 📎 相关 Issue
> - [#43](https://github.com/mmw-devs/ffxiv-race-stats/issues/43) — 设计 All-in-One 运营 Skill
> - [#49](https://github.com/mmw-devs/ffxiv-race-stats/issues/49) — Agentic RAG 工具检索
> - [#51](https://github.com/mmw-devs/ffxiv-race-stats/issues/51) — PR 动态合并策略
