# 视频帧管理与组装管道设计文档

## 文档信息
- 版本：v1.0-draft
- 日期：2026-03-03
- 状态：待讨论
- 前置：Seedance 集成设计 v3-final

---

## 1. 现状分析

### 1.1 当前架构

```
分镜图(imageUrl) + 单一提示词(prompt)
    ↓
视频生成模型（黑盒）
    ↓
完整视频片段（4-12秒）
    ↓
Remotion 拼接（磁性时间轴 + 转场）
    ↓
成片
```

**核心问题：三个断裂点**

| 断裂点 | 位置 | 现状 | 后果 |
|--------|------|------|------|
| 段内失控 | 单个视频片段内部 | 仅一条 prompt，模型自行决定帧内容 | 动作节奏不可控，人物动作可能偏离预期 |
| 段间断裂 | 相邻视频片段之间 | previousImageUrl 存在但未自动化 | 需手动选择首尾帧模式，连续性依赖运气 |
| 拼接机械 | 成片合并阶段 | 手动设置转场，不感知镜头语义关系 | 剧情紧张处可能用柔和转场，节奏割裂 |

### 1.2 已有能力盘点

| 能力 | 状态 | 位置 |
|------|------|------|
| lastFrameImageUrl 参数 | ✅ Seedance/Veo/Kling 支持 | generators/ark.ts, google.ts, fal.ts |
| previousImageUrl 字段 | ✅ DB 存在 | NovelPromotionPanel.previousImageUrl |
| firstLastFramePrompt | ✅ DB 存在 | NovelPromotionPanel.firstLastFramePrompt |
| videoGenerationMode | ✅ normal/firstlastframe | NovelPromotionPanel.videoGenerationMode |
| buildContinuityPrompt | ✅ 文本级连续性 | video.worker.ts |
| Remotion 转场 | ✅ dissolve/fade/slide | features/video-editor/remotion/ |
| VideoClip.transition | ✅ type + durationInFrames | editor.types.ts |
| Seedance TimelineSegment | ⏳ 类型已定义，未接入 | seedance-prompt-compiler.ts (设计中) |
| shotRelation → transition | ⏳ 映射表已定义，未接入 | seedance/types.ts |
| TailFrameHint | ⏳ P2 设计 | 未实现 |

---

## 2. 三层增强设计

### 层次一：段内时间轴控制（Timeline Control）

**目标**：让单个视频片段内部的动作有明确的时间编排，而非全部塞进一条 prompt。

**方案**：时间轴式 prompt 编译

```
Seedance panel（带 expected_duration + pace + character_labels）
    ↓
compileSeedanceTimeline()
    ↓
时间轴结构化 prompt:
  "[0-3s] 男主从左侧走入画面，黑发短发男性(tense)
   [3-5s] 男主停下脚步，转头看向窗外
   [5-7s] 窗外暴雨，闪电照亮男主侧脸"
    ↓
拼接为单一 prompt string → 送入模型
```

**实现策略**：

```typescript
// src/lib/seedance/prompt-compiler.ts

interface TimelineSegment {
  startTime: number
  endTime: number
  prompt: string
}

function compileSeedanceTimeline(
  panels: SeedanceStoryboardPanel[],
): TimelineSegment[] {
  let currentTime = 0
  return panels.map(panel => {
    const duration = panel.expected_duration || 4
    const segment: TimelineSegment = {
      startTime: currentTime,
      endTime: currentTime + duration,
      prompt: buildTimelinePromptText(panel),
    }
    currentTime += duration
    return segment
  })
}

/**
 * 将时间轴编译为适配视频模型的 prompt 字符串。
 * 策略：根据模型能力选择格式。
 * - 支持结构化时间轴的模型：用 JSON 格式
 * - 仅支持文本 prompt 的模型：用 "[Xs-Ys] description" 文本格式
 */
function compileTimelineToPrompt(
  segments: TimelineSegment[],
  modelCapabilities: { supportsTimeline?: boolean },
): string {
  if (modelCapabilities.supportsTimeline) {
    return JSON.stringify(segments)
  }
  // 文本格式降级：大多数模型走这个路径
  return segments
    .map(s => `[${s.startTime}s-${s.endTime}s] ${s.prompt}`)
    .join('\n')
}
```

**约束**：
- 时间轴 prompt 只是文本级引导，无法保证模型严格遵守
- 实际效果依赖模型对时间描述的理解能力
- 文本格式作为通用降级，不依赖特定模型 API

**接入点**：
- `video.worker.ts` → `buildContinuityPrompt()` 内部
- 当 `workflowMode === 'seedance'` 时使用时间轴 prompt 替代普通 prompt

---

### 层次二：段间帧桥接（Frame Bridging）

**目标**：相邻镜头之间的视觉连续性，通过首尾帧传递实现。

**方案**：自动帧桥接管道

```
Panel[n] 视频生成完成
    ↓
extractLastFrame(videoUrl) → lastFrameImageUrl
    ↓
存储到 Panel[n].tailFrameUrl
    ↓
生成 Panel[n+1] 时自动注入:
  - imageUrl = Panel[n+1] 分镜图（首帧）
  - lastFrameImageUrl = Panel[n].tailFrameUrl（尾帧参考）
  - generationMode = 'firstlastframe'
```

**数据模型扩展**：

```prisma
model NovelPromotionPanel {
  // 现有字段...
  tailFrameUrl       String?   // 该镜头视频的最后一帧（自动提取）
  tailFrameMediaId   String?   // 对应 MediaObject
}
```

**关键实现**：

```typescript
// 1. 尾帧提取（视频生成完成后）
async function extractAndStoreTailFrame(
  panelId: string,
  videoUrl: string,
): Promise<string | null> {
  // 方案 A：服务端 FFmpeg 提取（需要 FFmpeg 环境）
  // ffmpeg -sseof -1 -i video.mp4 -frames:v 1 -q:v 2 lastframe.jpg

  // 方案 B：视频模型 API 直接返回（部分模型支持）

  // 方案 C：LLM 文本推断（不提取实际帧，用文本描述代替）
  // → 即 TailFrameHint 方案，作为降级

  return tailFrameUrl
}

// 2. 桥接注入（生成下一镜头时）
async function resolveFrameBridging(
  currentPanel: NovelPromotionPanel,
  previousPanel: NovelPromotionPanel | null,
  modelCapabilities: VideoCapabilities,
): Promise<{
  lastFrameImageUrl?: string
  generationMode: 'normal' | 'firstlastframe'
}> {
  // 前置条件检查
  if (!previousPanel?.tailFrameUrl) {
    return { generationMode: 'normal' }
  }
  if (!modelCapabilities.firstlastframe) {
    return { generationMode: 'normal' }
  }

  // shotRelation 决定是否桥接
  const relation = currentPanel.shotRelation
  if (relation === 'jump' || relation === 'contrast') {
    // 空间跳转或情绪对比 → 不桥接，允许视觉断裂
    return { generationMode: 'normal' }
  }

  // continuity/cause → 桥接
  return {
    lastFrameImageUrl: previousPanel.tailFrameUrl,
    generationMode: 'firstlastframe',
  }
}
```

**桥接策略矩阵**：

| shotRelation | 桥接行为 | 理由 |
|-------------|---------|------|
| continuity | ✅ 首尾帧桥接 | 时间连续，视觉必须衔接 |
| cause | ✅ 首尾帧桥接 | 因果关系，场景通常不变 |
| jump | ❌ 不桥接 | 空间跳转，允许视觉变化 |
| contrast | ❌ 不桥接 | 情绪对比，刻意制造差异 |
| null/undefined | ❌ 不桥接 | 无关系信息，保守处理 |

**尾帧提取方案优先级**：

| 方案 | 优先级 | 依赖 | 质量 |
|------|--------|------|------|
| FFmpeg 服务端提取 | P1 推荐 | 需要 FFmpeg binary | 精确像素级 |
| 模型 API 返回 | P2 备选 | 取决于模型支持 | 精确 |
| LLM 文本推断 | P3 降级 | 无额外依赖 | 模糊，仅语义级 |

---

### 层次三：智能合成（Smart Composition）

**目标**：成片合并时根据镜头语义关系自动选择转场效果，而非千篇一律的硬切或溶解。

**方案**：shotRelation → 转场 + 时长自动映射

```typescript
// src/lib/seedance/composition-mapper.ts

interface CompositionTransition {
  type: 'none' | 'dissolve' | 'fade' | 'slide'
  durationInFrames: number
  easing?: 'linear' | 'ease-in' | 'ease-out'
}

const RELATION_TO_COMPOSITION: Record<ShotRelation, CompositionTransition> = {
  continuity: {
    type: 'none',        // 时间连续 → 硬切（最自然）
    durationInFrames: 0,
  },
  jump: {
    type: 'dissolve',    // 空间跳转 → 溶解（缓冲跳跃感）
    durationInFrames: 15, // 0.5秒 @30fps
    easing: 'ease-out',
  },
  contrast: {
    type: 'fade',        // 情绪对比 → 淡黑过渡（强调反差）
    durationInFrames: 24, // 0.8秒
    easing: 'ease-in',
  },
  cause: {
    type: 'none',        // 因果关系 → 硬切（紧凑节奏）
    durationInFrames: 0,
  },
}

/**
 * pace 修正：高节奏场景缩短转场时长
 */
function adjustTransitionByPace(
  base: CompositionTransition,
  pace: Pace | undefined,
): CompositionTransition {
  if (!pace || base.durationInFrames === 0) return base

  const PACE_MULTIPLIER: Record<Pace, number> = {
    slow: 1.5,     // 慢节奏加长转场
    normal: 1.0,
    fast: 0.7,     // 快节奏压缩转场
    intense: 0.4,  // 紧张节奏极短转场
  }

  return {
    ...base,
    durationInFrames: Math.round(base.durationInFrames * PACE_MULTIPLIER[pace]),
  }
}
```

**接入点**：
- `VideoEditorProject` 初始化时
- 从 Seedance panel 数据自动生成 `VideoClip.transition`
- 用户仍可手动覆盖

---

## 3. 数据流全景

```
                    ┌── Seedance P1 (已实现) ──┐
                    │                          │
Novel → Script → Storyboard                    │
                    │                          │
          ┌────────┴────────────┐              │
          ▼                     ▼              │
    Panel Image          Seedance Extensions   │
          │              (duration, pace,       │
          │               shotRelation,         │
          │               character_labels)     │
          │                     │              │
          ▼                     ▼              │
    ┌─────────────────────────────────────┐    │
    │    Layer 1: Timeline Control         │    │
    │    compileSeedanceTimeline()         │◄───┘
    │    → 时间轴式 prompt                 │
    └──────────────┬──────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────────┐
    │    Video Generation (per panel)      │
    │    imageUrl + enriched prompt        │
    │    + lastFrameImageUrl (if bridged)  │
    └──────────────┬──────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────────┐
    │    Layer 2: Frame Bridging           │
    │    extractLastFrame() → tailFrameUrl │
    │    resolveFrameBridging()            │
    │    shotRelation → 桥接/不桥接决策     │
    └──────────────┬──────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────────┐
    │    Layer 3: Smart Composition        │
    │    RELATION_TO_COMPOSITION           │
    │    pace × transition 修正            │
    │    → VideoEditorProject.timeline     │
    └──────────────┬──────────────────────┘
                   │
                   ▼
              Final Video
```

---

## 4. 实施计划

### Phase A（与 Seedance P2 合并，4-5天）

| 序号 | 任务 | 估时 |
|------|------|------|
| A1 | TimelineSegment prompt 编译器 | 1天 |
| A2 | video.worker 接入时间轴 prompt（seedance 模式） | 0.5天 |
| A3 | composition-mapper + 自动转场映射 | 1天 |
| A4 | VideoEditor 初始化时注入 shotRelation 转场 | 0.5天 |
| A5 | 人工对比 seedance 成片 vs default 成片 | 0.5天 |

### Phase B（独立迭代，3-4天）

| 序号 | 任务 | 估时 |
|------|------|------|
| B1 | FFmpeg 尾帧提取能力（容器环境验证） | 1天 |
| B2 | tailFrameUrl 字段 + 提取管道 | 1天 |
| B3 | resolveFrameBridging 自动桥接逻辑 | 0.5天 |
| B4 | 批量生成时的顺序依赖处理 | 0.5天 |
| B5 | 桥接效果人工对比 | 0.5天 |

### Phase C（长期优化）

| 序号 | 任务 |
|------|------|
| C1 | 多模型时间轴 prompt 格式适配 |
| C2 | 基于视频内容分析的尾帧质量评估 |
| C3 | 智能转场参数自动调优（基于人工反馈） |

---

## 5. 风险与决策点

| 决策点 | 选项 | 推荐 | 理由 |
|--------|------|------|------|
| 尾帧提取方式 | FFmpeg / 模型API / LLM推断 | FFmpeg | 精确可靠，大多数部署环境有 FFmpeg |
| 时间轴 prompt 格式 | JSON / 文本标注 | 文本标注 | 兼容所有模型，JSON 格式依赖模型支持 |
| 桥接时机 | 视频生成后立即 / 下一镜头生成前 | 生成后立即 | 减少依赖链长度 |
| 批量生成顺序 | 严格顺序 / 并行+回填 | 严格顺序 | 桥接需要前一镜头完成 |

**批量生成顺序问题**（重要）：
当前批量生成是并行的。引入帧桥接后，同一 storyboard 内的 panel 必须**按序**生成（因为 panel[n+1] 需要 panel[n] 的尾帧）。这会影响批量生成性能。

**缓解方案**：
- 跨 storyboard（不同 clip）仍可并行
- 同 storyboard 内按 panelIndex 串行
- 用户可选择关闭桥接以恢复并行速度

---

## 6. 不做

- 不做实时预览（帧级实时渲染需要 GPU 服务端）
- 不做逐帧关键帧动画编辑器（超出 AI 视频生成工具定位）
- 不做视频内容识别/分析（依赖 CV 模型，复杂度过高）
- 不做音频驱动的帧同步（lipsync 已有独立管道）

---

## 7. 与 Seedance 集成的关系

| Seedance 输出 | 视频帧管理层消费方式 |
|-------------|------------------|
| expected_duration | Layer 1: 时间轴段落时长 |
| pace | Layer 3: 转场时长修正系数 |
| shot_relation | Layer 2: 桥接决策 + Layer 3: 转场类型选择 |
| character_labels | Layer 1: 时间轴 prompt 角色标签注入 |

Seedance 是**数据生产者**，视频帧管理是**数据消费者**。两者松耦合，默认模式下视频帧管理层以保守默认值运行。
