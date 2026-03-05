# Story-to-Script Pipeline 审计报告

## 测试用例

末日废土风格小说第一章（约2000字），包含：紧张观察、250字内心独白/回忆、无声潜行、情报对话、突袭枪战逃亡、情感揭示、反派对峙。

## 问题一览

| # | 阶段 | 严重度 | 问题 |
|---|------|--------|------|
| 1 | 角色提取 | P0 | 遗漏有台词有动作的无名角色 |
| 2 | 切片分割 | P0 | 不同叙事模式被强制合并 |
| 3 | 切片分割 | P1 | 场景名拼写与库不匹配 |
| 4 | 切片分割 | P1 | characters 列表含未物理出场角色 |
| 5 | 剧本转换 | P1 | action/voiceover 跨 clip 判定不一致 |
| 6 | 剧本转换 | P2 | int_ext 格式中英文混用 |
| 7 | 级联效应 | - | 1-4-5 形成连锁失败 |

## 问题详析

### 1. 角色提取遗漏（agent_character_profile.zh.txt）

**现象**：LLM 提取 4 个角色（林屿、沈昭、林夏、周承舟），遗漏：
- 「检疫站受伤男人」- 6 句台词、被枪击、被拖进井道
- 「狼头面罩男人」- 踹门、举枪、有台词的反派

**根因**：Prompt 的不提取规则写「无名无特征的纯路人」，LLM 将「无名」理解为「没有正式姓名」，自行决定排除。LLM thinking 中甚至识别了这两人但主动跳过。

**修复**：明确「无名」定义 - 有台词/有动作/有互动的角色即使用描述性称呼（如「男人」「戴面具的人」）也必须提取，使用描述性命名策略。

### 2. 切片分割粒度不足（agent_clip.zh.txt）

**现象**：3 个片段中 Segment 1 混合了：
- 紧张观察（废墟楼顶瞭望）
- 250 字纯内心独白/回忆（周承舟信号、林夏失踪）
- 决策对话（与沈昭的行动讨论）

三种完全不同的影视镜头语言被压入同一片段。

**根因**：Prompt Rule 1 最高优先级 = 「片段数量最小化」（20个元素以下1段，40个以下最多2段），LLM 宁可混合不同叙事模式也要减少片段数。

**修复**：
- Rule 1 最高优先级改为「叙事模式连贯性」- 外部动作 vs 内心独白/回忆、静态观察 vs 物理行动、情绪基调根本性转折处优先分割
- 「片段数量最小化」降为建议性规则

### 3. 切片场景名拼写错误

**现象**：clip 写「废弃楼顶_夜间」，场景库是「废墟楼顶_夜间」。

**根因**：Prompt 要求 100% 匹配库名，但 LLM 未严格遵守。当前 clip-matching.ts 的 Levenshtein 匹配仅用于文本边界，未用于 location 名校验。

**修复**（P2 orchestrator）：Step 2 输出后增加 location 名模糊匹配纠正。

### 4. 切片 characters 列表错误

**现象**：clip_3 列了「林夏」（仅被提及，未物理出场），漏了受伤男人和狼头面罩男人（实际有动作有台词）。

**根因**：双重叠加 - 角色提取遗漏（问题 1）+ Prompt 未区分「被提及」与「物理出场」。

**修复**：Prompt 增加规则 - characters 列表只含在该片段中有物理出场（台词/动作/被描述外观）的角色。

### 5. 剧本 action/voiceover 判定不一致

**现象**：3 个 clip 并行独立生成剧本，同类内容处理方式不同：
- clip_1：250 字回忆当 action
- clip_2：「心里一沉」当 voiceover
- clip_3：「林屿知道...再点燃一次」当 action
- 叙述者背景解说（「灰猎犬是东岸最臭名昭著的...」）被当 action

**根因**：Prompt 缺乏 action vs voiceover 的硬判定标准，且 Step 3 用 Promise.all 并行生成无交叉约束。

**修复**：
- Prompt 增加「摄影机判定法」- 摄影机能拍到则 action，拍不到则 voiceover
- 叙述者解说统一归为 voiceover
- P2：增加跨 clip 后处理一致性校验

### 6. int_ext 格式不统一

**现象**：clip_1 用「外景」（中文），clip_2/3 用「EXT」/「INT」（英文）。

**修复**：Prompt 明确统一为中文格式：内景/外景/内外景。

## 级联效应

```
角色提取遗漏 --> 切片 characters 列表缺人 --> 剧本出现非资产库名称
    |                                              |
    +----------------------------------------------+-> 后续出图找不到角色资产

切片粒度过粗 --> 单个 clip 文本过长 --> 剧本 LLM 处理困难 --> voiceover/action 判定混乱
```

## 改进方案

### 方案 A：只修 Prompt（推荐先行）

| 文件 | 改动 |
|------|------|
| agent_character_profile.zh.txt | 重写「不提取」规则，增加描述性命名策略 |
| agent_clip.zh.txt | 最高优先级改为叙事模式连贯性，增加物理出场规则 |
| screenplay_conversion.zh.txt | 增加摄影机判定法、统一 int_ext、叙述者解说规则 |

改动量：3 个 txt 文件，零代码风险。

### 方案 B：Prompt + Orchestrator（方案 A 验证后）

在方案 A 基础上，orchestrator.ts 增加：
1. Step 2 输出后：location 名模糊匹配纠正 + characters 子集校验
2. Step 3 输出后：跨 clip int_ext/voiceover 一致性后处理
3. clip-matching.ts 增加切片覆盖率完整性检查

改动量：orchestrator.ts + clip-matching.ts，需配套单测。

## Codex 独立评审补充

Codex 额外指出 5 项：
1. 无名角色需要命名策略（已纳入方案 A）
2. clip-matching 缺语义完整性检查（纳入方案 B）
3. Step 3 缺 schema 强约束如 int_ext enum（纳入方案 B）
4. 无全局归一化后处理（纳入方案 B）
5. 缺 evidence spans 原文溯源（归入 P3 长篇支持）

## 涉及文件

| 文件路径 | 用途 |
|----------|------|
| `lib/prompts/novel-promotion/agent_character_profile.zh.txt` | 角色提取 prompt |
| `lib/prompts/novel-promotion/agent_clip.zh.txt` | 切片分割 prompt |
| `lib/prompts/novel-promotion/screenplay_conversion.zh.txt` | 剧本转换 prompt |
| `src/lib/novel-promotion/story-to-script/orchestrator.ts` | Pipeline 编排器 |
| `src/lib/novel-promotion/story-to-script/clip-matching.ts` | 切片边界匹配 |
