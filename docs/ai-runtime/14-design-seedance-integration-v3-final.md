# Seedance 创作方法论整合设计文档（waoo-native）

## 文档信息

- 版本：v3.0-final（经两轮 Codex 对抗评审）
- 日期：2026-03-03
- 状态：**评审通过**，可进入开发
- 评审记录：
  - R1：Codex 提出 5 致命 + 5 严重问题 → 作者修订
  - R2：Codex 给出有条件通过 → 本版修复全部条件项

---

## 1. 目标与范围

### 1.1 核心目标

在 waoo 现有架构上整合 Seedance 提示词方法论，解决四个核心创作痛点：

1. **一致性不足**：同场景多分镜的角色外貌漂移、色调跳变
2. **绑定不强**：角色手动选择与生成结果脱钩
3. **拼接感强**：成片合并像硬拼接，缺少剪辑节奏感
4. **编排同质化**：LLM 对所有场景类型输出近似密度的镜头，缺少叙事节奏引导

### 1.2 设计原则

- **约束坏习惯，而非规定好习惯**：用反面约束引导 LLM，不硬编码创作规则
- **向后兼容**：默认工作流不受影响，seedance 作为独立档位启用
- **后置校验优于前置控制**：LLM 自由输出 → 规则引擎校验 → 不合格标记 warning → 不阻塞
- **静默降级**：seedance 特有功能任何环节失败都降级到默认路径，稳定性底线不低于默认模式

### 1.3 不做

- 不重写任务队列、存储系统、provider 适配器
- 不迁移历史项目数据
- 不涉及容器编排
- 不做密度系数的精确量化控制（R1 否决）
- 不做 180 度规则自动校验（R1 否决：LLM 无法维护可靠空间模型）
- 不做基于图像分析的色调提取（R1 否决：P1/P2 用文本级色调描述）
- 不做呼吸镜头后置自动注入（R1 否决：改为 prompt 层引导）

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────┐
│                  工作流档位层                      │
│  workflowMode: 'default' | 'seedance'           │
│  项目级开关，决定下游行为                           │
├─────────────────────────────────────────────────┤
│              Prompt Profile 层（新增）             │
│  Seedance 专用 prompt 模板（3套）                 │
│  时间轴编排 / 反面约束 / 节奏引导                  │
├─────────────────────────────────────────────────┤
│              分镜编排层（增强）                     │
│  Phase1: 规划 + 反面约束注入                      │
│  Phase2: 摄影 + 同场景色调一致性(文本级)           │
│  Phase3: 细化 + 角色标签 + 镜头关系              │
├─────────────────────────────────────────────────┤
│              后置校验层（新增）                     │
│  密度合理性检查 / 节奏跳变检测 / 时长总和校验      │
│  结果为 warning 日志，不阻塞生成                   │
├─────────────────────────────────────────────────┤
│              视频适配层（增强）                     │
│  seedance prompt 编译器                          │
│  时间轴式提示词输出                                │
├─────────────────────────────────────────────────┤
│              成片策略层（增强）                     │
│  镜头关系 → 转场映射                              │
│  时间轴合并 + linked panels 去重                  │
└─────────────────────────────────────────────────┘
```

---

## 3. 详细设计

### 3.1 工作流档位层

**改动范围**：`prisma/schema.prisma`、`src/types/project.ts`

```typescript
type WorkflowMode = 'default' | 'seedance'
```

**数据模型**：

```prisma
model NovelPromotionProject {
  // ... 现有字段
  workflowMode  String  @default("default")  // 独立列，非 Json
}
```

**档位粒度**：项目级。同一项目所有剧集使用相同档位。理由：混用导致视觉风格不统一，且增加编排层复杂度。

**回滚方案（三层防线）**：

| 层级 | 操作 | 效果 |
|------|------|------|
| L1 紧急 | `SEEDANCE_ENABLED=false` 环境变量 | 全局禁用，前端隐藏入口 |
| L2 项目 | `workflowMode` 改回 `default` | 该项目新生成走默认路径 |
| L3 数据 | nullable 字段防御 | 已生成数据保留，不影响默认模式读取 |

### 3.2 Prompt Profile 层

**改动范围**：`src/lib/prompt-i18n/prompt-ids.ts`、`lib/prompts/novel-promotion/`

**新增 3 套 Prompt 模板**：

| Prompt ID | 文件 | 用途 |
|-----------|------|------|
| `NP_SEEDANCE_STORYBOARD_PLAN` | `seedance_storyboard_plan.{zh,en}.txt` | seedance 分镜规划 |
| `NP_SEEDANCE_CINEMATOGRAPHER` | `seedance_cinematographer.{zh,en}.txt` | seedance 摄影指导 |
| `NP_SEEDANCE_DETAIL` | `seedance_storyboard_detail.{zh,en}.txt` | seedance 细化 |

```typescript
export const PROMPT_IDS = {
  // ... 现有 IDs 不变
  NP_SEEDANCE_STORYBOARD_PLAN: 'np_seedance_storyboard_plan',
  NP_SEEDANCE_CINEMATOGRAPHER: 'np_seedance_cinematographer',
  NP_SEEDANCE_DETAIL: 'np_seedance_storyboard_detail',
} as const
```

**P1 不做模板版本化。** 所有项目使用最新模板。模板稳定后（P3）再引入版本快照。

**Seedance 分镜规划 prompt 核心差异**（对比默认模板）：

**（A）新增输出字段要求**：
- `expected_duration`：期望时长（秒），范围 2-15
- `shot_relation`：与下一镜头的关系（最后一镜头此字段为 null）
- `pace`：镜头节奏
- `character_labels`：角色区分标签 + 情绪

**（B）反面约束注入**（核心方法论差异）：
```
【节奏与多样性约束】
⚠️ 不要每个场景都用空镜开场——动作场景优先从核心动作切入，悬疑场景优先从特写切入
⚠️ 连续两个场景不要使用相同的入场方式
⚠️ 动作场景应密集拆分，每个核心动作独立成镜；日常对话场景可适度合并
⚠️ 不允许连续 5 个以上镜头使用相同景别
⚠️ 节奏不允许从 slow 直接跳变到 intense（中间至少经过 normal 或 fast）
⚠️ 高密度镜头段落后应适当安排节奏缓冲
```

**（C）同场景色调一致性规则**（注入 cinematographer prompt）：
```
【同场景色调锚定规则】
当多个镜头属于同一 location 时：
1. 所有镜头必须使用一致的主色调描述
2. 第一个镜头确定色调基准，后续镜头延续
3. 只有场景发生剧烈变化（白天→黑夜）时才允许色调改变
```

### 3.3 分镜编排层增强

**改动范围**：`src/lib/novel-promotion/script-to-storyboard/orchestrator.ts`

#### 3.3.1 模板分流逻辑

```typescript
// orchestrator.ts 或 script-to-storyboard.ts 中
function resolvePromptTemplates(
  workflowMode: WorkflowMode,
  locale: string,
): ScriptToStoryboardPromptTemplates {
  if (workflowMode === 'seedance') {
    return {
      phase1PlanTemplate: getPromptTemplate(PROMPT_IDS.NP_SEEDANCE_STORYBOARD_PLAN, locale),
      phase2CinematographyTemplate: getPromptTemplate(PROMPT_IDS.NP_SEEDANCE_CINEMATOGRAPHER, locale),
      phase2ActingTemplate: getPromptTemplate(PROMPT_IDS.NP_AGENT_ACTING_DIRECTION, locale), // 复用
      phase3DetailTemplate: getPromptTemplate(PROMPT_IDS.NP_SEEDANCE_DETAIL, locale),
    }
  }
  return {
    phase1PlanTemplate: getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_PLAN, locale),
    phase2CinematographyTemplate: getPromptTemplate(PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER, locale),
    phase2ActingTemplate: getPromptTemplate(PROMPT_IDS.NP_AGENT_ACTING_DIRECTION, locale),
    phase3DetailTemplate: getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL, locale),
  }
}
```

#### 3.3.2 类型设计（组合式）

```typescript
// ── 基础类型（默认模式，不变） ──
interface BasePanelData {
  panel_number: number
  description: string
  characters: Array<{ name: string; appearance: string }>
  location: string
  scene_type: string
  source_text: string
  shot_type?: string
  camera_move?: string
  video_prompt?: string
}

// ── Seedance 扩展字段 ──
type Pace = 'slow' | 'normal' | 'fast' | 'intense'
type ShotRelation = 'continuity' | 'jump' | 'contrast' | 'cause'
type Emotion = 'calm' | 'tense' | 'angry' | 'sad' | 'joyful'

interface CharacterLabel {
  name: string
  distinctive_tag: string   // 区分性外貌标签："黑发长辫女性"
  emotion: Emotion
}

interface SeedancePanelExtension {
  expected_duration?: number           // 期望时长（秒），2-15
  shot_relation?: ShotRelation | null  // 与下一镜头的关系（最后一镜为 null）
  pace?: Pace                          // 镜头节奏
  character_labels?: CharacterLabel[]  // 角色标签
}

// ── 组合类型 ──
type StoryboardPanel = BasePanelData                               // 默认模式
type SeedanceStoryboardPanel = BasePanelData & SeedancePanelExtension  // seedance
```

> **R2 修复**：`Emotion` 现在是字面量联合类型，与 `Pace`、`ShotRelation` 设计风格一致。

#### 3.3.3 LLM 输出 JSON Schema（seedance 模式）

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["panel_number", "description", "characters", "location",
                 "scene_type", "source_text"],
    "properties": {
      "panel_number": { "type": "integer", "minimum": 1 },
      "description": { "type": "string", "minLength": 10 },
      "characters": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["name", "appearance"],
          "properties": {
            "name": { "type": "string" },
            "appearance": { "type": "string" }
          }
        }
      },
      "location": { "type": "string" },
      "scene_type": {
        "type": "string",
        "enum": ["daily", "emotion", "action", "epic", "suspense"]
      },
      "source_text": { "type": "string", "minLength": 1 },
      "expected_duration": { "type": "number", "minimum": 2, "maximum": 15 },
      "shot_relation": {
        "type": ["string", "null"],
        "enum": ["continuity", "jump", "contrast", "cause", null]
      },
      "pace": {
        "type": "string",
        "enum": ["slow", "normal", "fast", "intense"]
      },
      "character_labels": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["name", "distinctive_tag", "emotion"],
          "properties": {
            "name": { "type": "string" },
            "distinctive_tag": { "type": "string" },
            "emotion": {
              "type": "string",
              "enum": ["calm", "tense", "angry", "sad", "joyful"]
            }
          }
        }
      }
    }
  }
}
```

> **R2 修复**：`emotion` 字段增加了 `enum` 约束，与 `pace` / `shot_relation` 保持一致。

#### 3.3.4 解析容错策略

```typescript
const VALID_PACE: Pace[] = ['slow', 'normal', 'fast', 'intense']
const VALID_RELATION: ShotRelation[] = ['continuity', 'jump', 'contrast', 'cause']
const VALID_EMOTION: Emotion[] = ['calm', 'tense', 'angry', 'sad', 'joyful']

function clampDuration(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(15, Math.max(2, value))  // 截断到 [2, 15] 范围
}

function parseEnum<T extends string>(value: unknown, valid: T[]): T | undefined {
  return typeof value === 'string' && valid.includes(value as T)
    ? value as T
    : undefined
}

function isValidCharacterLabel(item: unknown): item is CharacterLabel {
  if (!item || typeof item !== 'object') return false
  const obj = item as Record<string, unknown>
  return typeof obj.name === 'string' && obj.name.trim().length > 0
    && typeof obj.distinctive_tag === 'string' && obj.distinctive_tag.trim().length > 0
    && typeof obj.emotion === 'string' && VALID_EMOTION.includes(obj.emotion as Emotion)
}

function parseSeedanceExtension(
  raw: Record<string, unknown>,
  isLastPanel: boolean,
): SeedancePanelExtension {
  return {
    expected_duration: clampDuration(raw.expected_duration),

    shot_relation: isLastPanel
      ? null  // 最后一个镜头的关系强制为 null
      : parseEnum(raw.shot_relation, VALID_RELATION) ?? undefined,

    pace: parseEnum(raw.pace, VALID_PACE),

    character_labels: Array.isArray(raw.character_labels)
      ? raw.character_labels.filter(isValidCharacterLabel)
      : undefined,
  }
}
```

> **R2 修复**：
> - `expected_duration` 统一为**截断**策略（`clampDuration`），消除了 v2 中截断 vs 丢弃的矛盾
> - `emotion` 在 `isValidCharacterLabel` 中明确校验枚举值
> - `shot_relation` 对最后一个 panel 强制返回 `null`

#### 3.3.5 Phase2 摄影指导增强

Seedance cinematographer prompt 新增同场景色调一致性规则（纯文本级，不涉及图像分析）。

### 3.4 后置校验层（新增）

**位置**：`src/lib/seedance/validators.ts`

**设计哲学**：LLM 自由输出 → 校验器检查 → 输出 warning 日志 → **不阻塞**

```typescript
interface ValidationWarning {
  panelNumber: number
  type: 'density' | 'pace_jump' | 'duration_sum' | 'missing_field'
  message: string
  severity: 'info' | 'warning'
}

function validateSeedanceOutput(
  panels: SeedanceStoryboardPanel[],
  clipContentLength: number,
): ValidationWarning[] {
  return [
    ...validateDensity(panels, clipContentLength),
    ...validatePaceTransitions(panels),
    ...validateDurationSum(panels),
    ...validateFieldPopulation(panels),
  ]
}
```

**校验规则**：

| 校验 | 条件 | 级别 |
|------|------|------|
| 密度过高 | 字/镜头 < 5 | warning |
| 密度过低 | 字/镜头 > 50 | warning |
| 节奏跳变 | pace 跨越 2 级以上（如 slow→intense） | warning |
| 时长总和异常 | expected_duration 总和 > 300秒 | warning |
| 字段缺失率高 | seedance 扩展字段填充率 < 50% | info |

### 3.5 视频适配层增强

**新增**：`src/lib/generators/video/seedance-prompt-compiler.ts`

```typescript
interface TimelineSegment {
  startTime: number
  endTime: number
  prompt: string
}

function compileSeedanceTimeline(panels: SeedanceStoryboardPanel[]): TimelineSegment[] {
  let currentTime = 0

  return panels.map(panel => {
    const duration = panel.expected_duration || 4  // 默认4秒
    const segment: TimelineSegment = {
      startTime: currentTime,
      endTime: currentTime + duration,
      prompt: buildTimelinePromptText(panel),
    }
    currentTime += duration
    return segment
  })
}

function buildTimelinePromptText(panel: SeedanceStoryboardPanel): string {
  const parts: string[] = []
  parts.push(panel.description)

  if (panel.character_labels?.length) {
    const labels = panel.character_labels
      .map(c => `${c.distinctive_tag}(${c.emotion})`)
      .join(', ')
    parts.push(`Characters: ${labels}`)
  }

  return parts.join('. ')
}
```

> **R2 修复**：删除了 `camera_move` 的无效引用。运镜信息由 `BasePanelData.camera_move`（已有字段）承载，在时间轴编译阶段暂不处理（P2 再对接）。

**不改 provider 抽象**：编译结果适配现有 `VideoGenerateParams.prompt` 字符串输入。

### 3.6 成片策略层增强

#### 3.6.1 镜头关系 → 转场映射

```typescript
const RELATION_TO_TRANSITION: Record<ShotRelation, string> = {
  continuity: 'cut',         // 时间连续 → 硬切
  jump:       'dissolve',    // 空间跳转 → 溶解
  contrast:   'fade',        // 情绪对比 → 淡入淡出
  cause:      'cut',         // 因果关系 → 硬切
}

// P1 只做映射逻辑和数据存储
// P2 对接 Remotion 后实现实际转场渲染
```

#### 3.6.2 Tail Frame Hint（P2 范围）

**存储**：`NovelPromotionPanel.tailFrameHint Json?`

```typescript
interface TailFrameHint {
  lastFrameDescription: string  // 最后画面描述
  motionDirection: string       // 运动方向（文本描述）
  dominantMood: string          // 主导情绪
}
```

**生成时机**：视频生成完成后，由 LLM 基于 panel description + video prompt 推断生成。不依赖视频帧分析。

---

## 4. 数据模型变更

### 4.1 Prisma Schema

```prisma
model NovelPromotionProject {
  // ... 现有字段
  workflowMode      String    @default("default")
}

model NovelPromotionPanel {
  // ... 现有字段
  expectedDuration    Float?      // seedance: 期望时长（秒）
  shotRelation        String?     // seedance: 镜头关系
  pace                String?     // seedance: 节奏
  characterLabels     Json?       // seedance: CharacterLabel[]
  tailFrameHint       Json?       // P2: TailFrameHint
}
```

### 4.2 向后兼容性

- 所有新字段 nullable，默认值 null
- 默认模式代码路径不读取任何新字段
- `workflowMode` 默认 `"default"`，无需数据迁移

---

## 5. 错误处理策略

| 场景 | 策略 | 理由 |
|------|------|------|
| LLM 未输出 seedance 扩展字段 | fallback null，不重试 | 不阻塞核心生成 |
| `expected_duration` 超出 [2,15] | **截断到边界**（如 1→2, 20→15） | LLM 偏差值仍有参考意义 |
| `pace` 不在枚举内 | 设为 undefined | 无效值无参考意义 |
| `shot_relation` 不在枚举内 | 设为 undefined | 同上 |
| `emotion` 不在枚举内 | 整个 character_label 丢弃 | 保证标签数据完整性 |
| 最后一个镜头的 `shot_relation` | 强制设为 null | 无下一镜头可关联 |
| 校验器报 warning | 写入日志，不阻塞 | warning-only |
| seedance prompt 模板加载失败 | 降级到默认模板，记录 error 日志 | 保证可用性 |

---

## 6. 性能预算

| 指标 | 默认模式 | Seedance 模式 | 增量 |
|------|----------|--------------|------|
| Phase1 prompt token | ~2000 | ~2800 | +40% |
| Phase2 prompt token | ~1500 | ~1800 | +20% |
| Phase3 prompt token | ~2000 | ~2500 | +25% |
| **LLM 调用次数/clip** | **4** | **4** | **+0** |
| 后置校验耗时 | 0 | <50ms | 可忽略 |
| 总体生成时间（10 clip） | ~8min | ~10min | **+25%** |
| 额外 Prisma 写入 | 0 | 5 个字段/panel | 可忽略 |

**约束**：不新增 LLM 调用次数。seedance 增强全部通过扩展现有 prompt 实现。

---

## 7. 分阶段实施计划

### P1（5天）Prompt 增强 + 基础字段

| 序号 | 任务 | 改动范围 | 估时 |
|------|------|----------|------|
| 1 | Prisma schema: `workflowMode` + panel 扩展字段 + migrate | `prisma/schema.prisma` | 0.5天 |
| 2 | 类型定义 + 解析器 + 枚举校验 | `src/types/`, `src/lib/seedance/` | 0.5天 |
| 3 | 三套 seedance prompt 模板编写 + LLM 验证迭代 | `lib/prompts/novel-promotion/` | **2天** |
| 4 | orchestrator 模板分流逻辑 | `orchestrator.ts` | 0.5天 |
| 5 | 后置校验器 | `src/lib/seedance/validators.ts` | 0.5天 |
| 6 | 前端档位开关（项目设置页） | workspace components | 0.5天 |
| 7 | 单元测试 + 默认模式回归 | `tests/` | 0.5天 |

> **R2 调整**：prompt 模板编写从 1.5 天调为 2 天，单元测试中 prompt 相关部分并入模板编写。

**P1 验收标准**：
1. 新建项目可选 seedance 模式
2. seedance 模式分镜输出包含 expected_duration、pace、shot_relation（填充率 >70%）
3. 后置校验器输出 warning 日志
4. 默认模式全量回归通过
5. LLM 调用次数不增加
6. 人工对比 seedance vs default 输出的分镜多样性有明显差异

### P2（4-5天）一致性与成片

| 序号 | 任务 | 估时 |
|------|------|------|
| 1 | 角色 ref-image 强提醒 + seed 管理策略 | 1天 |
| 2 | Tail frame hint 生成 + 存储 | 1天 |
| 3 | seedance prompt 编译器（时间轴式输出） | 1天 |
| 4 | Remotion 转场能力调研 + 关系→转场映射实现 | 1天 |
| 5 | 根据 P1 实际输出调整 prompt / 校验规则 + 集成测试 | 0.5-1天 |

**P2 验收标准**：
1. 同场景色调一致性提升（人工对比）
2. 成片中出现非硬切转场
3. tail frame hint 可在日志中追踪
4. 人工对比 seedance 成片 vs default 成片的观感差异

### P3（3-4天）自动化与扩展

| 序号 | 任务 | 估时 |
|------|------|------|
| 1 | Prompt 模板版本化机制 | 1天 |
| 2 | 角色漂移检测（基于 prompt 描述一致性） | 1天 |
| 3 | A/B 对比工具（手动触发） | 0.5天 |
| 4 | 模板族扩展（product/tvc） | 0.5天 |
| 5 | 线上监控 + 性能优化 | 0.5天 |

---

## 8. 可观测性

### 8.1 日志

```typescript
logAIAnalysis(userId, 'worker', projectId, projectName, {
  action: 'SEEDANCE_GENERATION_SUMMARY',
  input: { workflowMode: 'seedance', clipCount },
  output: {
    totalPanels,
    fieldsPopulated: {
      expectedDuration: number,  // 有值的 panel 数
      shotRelation: number,
      pace: number,
      characterLabels: number,
    },
    validationWarnings: ValidationWarning[],
  },
})
```

### 8.2 核心指标

| 指标 | 目标 |
|------|------|
| 扩展字段填充率 | >70% |
| JSON 解析成功率 | >95%（不低于默认模式） |
| 生成降级率 | <5% |

---

## 9. 回滚验证 Checklist

- [ ] `SEEDANCE_ENABLED=false` 后 seedance 项目能正常打开
- [ ] `workflowMode` 切回 default 后新生成走默认路径
- [ ] 默认模式代码路径不读取任何 seedance 扩展字段
- [ ] nullable 新字段不影响现有查询和 UI 渲染
- [ ] 前端在 feature flag 关闭时隐藏 seedance 选项

---

## 10. 测试策略

### 10.1 单元测试

| 测试对象 | 覆盖点 |
|----------|--------|
| `parseSeedanceExtension` | 正常值 / 越界截断 / 无效枚举 / 缺失字段 / 最后镜头 |
| `isValidCharacterLabel` | name 空 / distinctive_tag 空 / emotion 非法 |
| `clampDuration` | 边界值 2, 15, 1.5→2, 20→15, NaN→undefined |
| `validateDensity` | 极端密度 / 正常密度 / 空 panels |
| `validatePaceTransitions` | slow→intense 跳变 / 正常过渡 / 无 pace 字段 |
| `validateDurationSum` | 超 300s / 正常 / 无 duration |
| `compileSeedanceTimeline` | 时间累加正确 / 默认 4s / 空数组 |

### 10.2 集成测试

- seedance 模式完整 clip → storyboard → 验证新字段存在
- 默认模式回归：确认新代码不影响原有输出
- 降级场景：seedance prompt 模板缺失时自动降级

### 10.3 手动验收

- P1：人工对比 seedance vs default 分镜的多样性和节奏差异
- P2：人工对比成片连贯性和转场效果

---

## 11. 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| LLM 不输出 seedance 扩展字段 | 中 | 静默降级 |
| 扩展 prompt 导致 token 成本增加 | 确定 | 预算 +25% token，0 额外调用 |
| 实际输出质量提升不明显 | 中 | P2 前人工对比，效果不显著则调整方向 |
| Remotion 不支持所需转场 | 中 | P2 先调研再定义枚举 |
| prompt 模板迭代超出 2 天 | 中 | P1 优先保证 plan 模板质量，其余两套模板可延至 P1 尾声 |

---

## 12. 审核清单

- [ ] 向后兼容：默认模式无影响
- [ ] seedance 功能全部静默降级，不破坏核心流程
- [ ] Prisma 新字段全部 nullable
- [ ] LLM 调用次数不增加
- [ ] `expected_duration` 截断策略一致（代码 = 文档）
- [ ] `emotion` 枚举约束完整（TypeScript + JSON Schema + 解析器）
- [ ] `shot_relation` 最后镜头处理明确（强制 null）
- [ ] 可观测性日志完整
- [ ] 回滚三层防线可执行
- [ ] 性能预算可接受

---

## 附录 A：评审记录摘要

### 第一轮评审（R1）

**评审结论**：不通过，需重大修订

**致命问题（已修复）**：
1. 密度系数伪科学 → 改为语义引导 + 后置校验
2. 四段式弧线误解 → 改为 pace 离散枚举
3. ref-image 硬约束不可实现 → 改为强提醒
4. 色调锚定没闭环 → 改为文本级色调描述
5. 180度规则不可靠 → 删除

**过度设计（已裁剪）**：
- P1 版本化 → 推迟到 P3
- rhythmPreset 枚举 → 删除
- coherenceStrength → 删除
- Guard 脚本 → 推迟

### 第二轮评审（R2）

**评审结论**：有条件通过

**条件（已修复）**：
1. `expected_duration` 截断 vs 丢弃矛盾 → 统一为截断
2. `emotion` 缺少枚举约束 → 补全
3. `camera_move` 无效引用 → 删除
4. `shot_relation` 最后镜头处理 → 明确强制 null
5. prompt 模板排期 → 从 1.5 天调为 2 天
