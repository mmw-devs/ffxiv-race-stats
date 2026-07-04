# 中转站（xivstrat-relay）实现方案

> 为 xivstrat 攻略站服务的本地预览 + 内容编辑中转项目。
> 编辑 JSON 数据 → Astro 模板实时预览 → 编译导出 .astro 源文件 → 复制到 xivstrat。

## 一、三项目关系

```
PI Agent（统一运营）
  ├── FFXIVRanking     — 修改 public/data.json → content PR → CF Pages
  └── 中转站（新建）    — 修改 src/data/*.json → 预览 → 导出 .astro → 复制到 xivstrat
                                      │
                                      ▼ 导出
                                 xivstrat（不改动）
                                 接收 .astro → pnpm build → EdgeOne Pages
```

## 二、技术栈

| | 中转站 | xivstrat |
|---|---|---|
| 框架 | Astro + Vue 3 | Astro + Vue 3 |
| 样式 | Tailwind v4 | Tailwind v4 |
| 包管理 | pnpm | pnpm |
| 构建 | `pnpm build` | `pnpm build` |
| 部署 | 本地预览 | EdgeOne Pages |

> **对齐原因**：中转站复用 xivstrat 的 Astro/Vue/Tailwind，预览效果和最终部署完全一致。

## 三、目录结构

```
xivstrat-relay/
├── astro.config.mjs              # 对齐 xivstrat 配置
├── package.json
├── src/
│   ├── data/                     # 运营编辑区（PI Agent 操作）
│   │   └── duties/
│   │       └── 07/
│   │           ├── m5s.json      # 一个 JSON = 一个副本全部内容
│   │           ├── m6s.json
│   │           └── ...
│   ├── templates/                # 编译模板（开发者维护）
│   │   ├── DutyIndex.astro       # 副本首页模板
│   │   └── DutyPhase.astro       # 阶段页模板
│   ├── layouts/
│   │   └── RelayLayout.astro     # 预览用布局
│   ├── pages/
│   │   └── preview/
│   │       └── [duty]/
│   │           ├── index.astro   # 首页预览路由
│   │           └── [phase].astro # 阶段页预览路由
│   └── scripts/
│       └── export.mjs            # JSON → .astro 编译导出
└── .pi/                          # PI Agent 配置
```

## 四、数据文件结构（`m5s.json`）

```json
{
  "dutyId": "07/m5s",
  "meta": {
    "cnName": "阿卡狄亚零式登天斗技场 重量级3",
    "enName": "AAC Cruiserweight M3 (Savage)",
    "videoLink": "https://www.bilibili.com/video/BVxxx"
  },
  "cheatsheet": "cheatsheets/07/m5s.webp",
  "waymark": {
    "href": "waymarks/07/AacCruiserweight/UISAVE.DAT",
    "img": "waymarks/07/m5s.webp"
  },
  "macro": "【M5S站位】\n/p ...",
  "timeline": "timelines/07/m5s.webp",
  "references": [
    { "label": "MMW攻略组", "url": "https://..." }
  ],
  "thanks": {
    "devList": [{ "name": "作者A", "role": "机制拆解" }],
    "groupList": [{ "name": "MMW攻略组" }]
  },
  "phases": [
    {
      "id": "p1",
      "title": "P1 — Disco Infernal",
      "events": [
        { "type": "event", "time": "00:00.0", "text": "开怪，将Boss固定在场中偏南" },
        { "type": "attack", "time": "00:03.0", "damage": 55000, "damageType": "physical" },
        { "type": "separator", "id": "deep-cut", "title": "Deep Cut" },
        { "type": "mechanic", "id": "deep-cut", "start": "00:09.173" },
        { "type": "note", "text": "必定和前一次不同" }
      ]
    }
  ]
}
```

### 事件类型说明

| type | 对应 xivstrat 组件 | 关键字段 |
|------|-------------------|---------|
| `event` | `<EventSection>` | `time`, `text` |
| `attack` | `<AttackSection>` | `time`, `damage`, `damageType` |
| `separator` | `<SeparatorSection>` | `id`, `title` |
| `mechanic` | 对应 `_mechanics/` 下的 `.astro` 文件 | `id`, `start` |
| `note` | `<NoteSection>` | `text` |

## 五、预览机制

预览路由 `[duty]/[phase].astro` 读取对应 JSON，传入模板渲染：

```astro
---
import DutyPhase from '../../templates/DutyPhase.astro'
const { duty, phase } = Astro.params
const data = await import(`../../data/duties/${duty}.json`)
const phaseData = data.phases.find(p => p.id === phase)
---
<DutyPhase duty={data} phase={phaseData} />
```

运营者修改 JSON → `pnpm dev` 实时热更新预览 → 效果与 xivstrat 最终产出一致。

## 六、编译导出（`export.mjs`）

将 JSON 转为 xivstrat 兼容的 `.astro` 源文件：

```
输入: src/data/duties/07/m5s.json

输出: out/07/m5s/
      ├── index.astro          ← 首页（速查表 + 宏 + 标点 + 参考资料）
      ├── p1.astro             ← 阶段页（时间轴事件列表）
      ├── p2.astro
      ├── p3.astro
      ├── _data/
      │   ├── macro.ts         ← 从 JSON macro 字段生成
      │   ├── reference.ts     ← 从 JSON references 生成
      │   └── thanks.ts        ← 从 JSON thanks 生成
      └── _translations/
          └── cn.ts            ← 从 JSON meta 提取
```

### 代码生成示例（阶段页）

```js
function generatePhasePage(duty, phase) {
  const mechanics = collectMechanics(phase.events)
  let output = '---\n'
  // import 语句
  for (const m of mechanics) {
    output += `import ${m.name} from './_mechanics/${m.name}.astro'\n`
  }
  output += '---\n\n'
  output += `<DutyStratLayout dutyId="${duty.dutyId}">\n`
  // 逐事件渲染
  for (const event of phase.events) {
    switch (event.type) {
      case 'attack':
        output += `  <AttackSection time="${event.time}" damage="${event.damage}" damageType="${event.damageType}" />\n`
        break
      case 'separator':
        output += `  <SeparatorSection id="${event.id}" title="${event.title}" />\n`
        break
      case 'mechanic':
        output += `  <${event.id} />\n`
        break
      case 'note':
        output += `  <NoteSection>${event.text}</NoteSection>\n`
        break
    }
  }
  output += '</DutyStratLayout>\n'
  return output
}
```

## 七、PI Agent 运营工作流

```
运营者指令
    │
    ├── FFXIVRanking
    │   └── 修改 public/data.json → content PR → CF Pages
    │
    └── 中转站
        ├── 修改 src/data/duties/<副本>.json
        ├── pnpm dev 预览
        ├── node scripts/export.mjs 导出
        └── 复制 out/ 到 xivstrat（或发 PR 给 xivstrat 开发者）
```

## 八、待确认问题

| 问题 | 状态 |
|------|------|
| 中转站是否需要独立的 git 仓库？ | 待定 |
| `_mechanics/` 中的机制块（.astro 文件）如何处理？ | 需与 xivstrat 开发者协调——机制块是否也数据驱动，还是直接手写 .astro 并引入中转站 |
| 导出后如何"提交到 xivstrat"？ | 手动复制 或 发 PR 到 xivstrat 仓库 |
| 翻译数据（`_translations/`）如何处理？ | 在 JSON 中扩展 `translations` 字段，导出时生成对应 .ts 文件 |

## 九、实施预估

| 阶段 | 内容 | 预估 |
|------|------|------|
| 1. 项目初始化 | Astro + Vue 3 + Tailwind v4，对齐 xivstrat 配置 | 1h |
| 2. 数据模型 | JSON schema 设计 + 首个副本示例数据（基于 m5s） | 1h |
| 3. 预览模板 | DutyIndex.astro + DutyPhase.astro | 3h |
| 4. 编译导出 | export.mjs 代码生成器 | 2h |
| 5. PI Agent 扩展 | 中转站运营 skill（修改 JSON、预览、导出） | 2h |
| **合计** | | **~9h** |

---

> ⚠️ 此方案需在 FFXIVRanking Astro + Vue 3 重构完成并通过测试后，经用户确认再开始实施。
