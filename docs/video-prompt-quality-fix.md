# 视频提示词质量全链路修复

## 任务背景

waoo 的角色分析系统生成了丰富的角色数据（profileData 含 12 个字段 + introduction + expected_appearances），但下游几乎全部丢弃。视频生成 prompt 沦为"年轻男子+动作+镜头运动"的干瘪描述，丢失角色身份、叙事氛围和跨镜头上下文。

**根因**：不是"没分析"，而是"分析了不用"——数据在多个断裂点被截断。

---

## 问题全景（5 个断裂点）

| # | 断裂点 | 位置 | 现象 |
|---|---|---|---|
| D1 | analyze-novel 丢弃字段 | `analyze-novel.ts` | `introduction`、`expected_appearances`、`updated_characters` 未持久化 |
| D2 | Phase 3 模板去名化 | `agent_storyboard_detail.zh.txt` | video_prompt 强制用"年轻男子/女子"替代角色名，多人场景不可区分 |
| D3 | video.worker 缺上下文 | `video.worker.ts` | 无角色外貌、原文片段、摄影规则、表演指导的注入 |
| D4 | Phase 3 角色信息不足 | `orchestrator.ts` | Phase 3 只收到外貌文本描述，没有 profileData 中的辨识标志/性格标签 |
| D5 | 角色筛选规则过死 | `agent_character_profile.zh.txt` | "未出场不提取"排除了叙事关键但无画面的角色 |

---

## 修复方案（4 层）

### Layer 1: 角色数据持久化修复

**目标**：AI 分析出的角色数据不再丢弃。

**改动内容**：
1. `analyze-novel.ts` 保存 `introduction`（对齐 `story-to-script-helpers.ts` 已有行为）
2. 两个入口都保存 `expected_appearances` 到 `profileData` JSON 中
3. `CharacterProfileData` 类型增加 `expected_appearances?: Array<{id: number, change_reason: string}>`
4. 处理 `updated_characters`：解析 AI 输出的 `updated_characters` 数组，对已有角色执行 update 更新 `introduction` 和 `aliases`，失败静默跳过
5. 支持 `new_characters` / `characters` 两种 AI 输出格式（向后兼容）

### Layer 2: Phase 3 模板改造

**目标**：video_prompt 从"年轻男子+动作"升级为"视觉区分标签+动作+叙事氛围"。

**改动内容**：
1. **模板规则重写**：删除"用年龄段+性别替代"规则，替换为"视觉区分标签"规则
2. **新增变量** `{characters_profile_summary}`：从 profileData 提取身份、辨识标志、性格、视觉关键词
3. **新增函数** `buildCharacterProfileSummary`：在 `storyboard-phases.ts` 中实现
4. **orchestrator 注入**：Phase 3 prompt 构建时注入角色档案摘要
5. **年龄段分类保留为辅助参考**，不再是主要角色标识方式
6. **英文模板同步更新**

### Layer 3: video.worker 上下文增强

**目标**：视频生成 prompt 注入角色外貌、原文片段、摄影规则。

**改动内容**：
1. **新增** `loadCharacterVisualDescriptions`：从角色资产库查询视觉描述
2. **新增** `buildContinuityPrompt`：构建增强 prompt，注入角色外貌锚点、原文叙事锚点、摄影指导
3. **新增** `parsePhotographyRules`：从 panel 的 `photographyRules` JSON 提取光线/色调/氛围
4. **新增** `parsePanelCharacterNames`：解析 panel 的 `characters` JSON 获取角色名
5. **集成**：`generateVideoForPanel` 在非自定义 prompt 时自动注入上下文增强

**设计决策**：
- 上下文增强仅在使用 panel 自带的 videoPrompt/description 时触发，用户自定义 prompt 不受影响
- 增强内容以 `【上下文参考】` 标记附加在原始 prompt 之后，不覆盖原始内容
- 每次查询 < 10ms，角色数通常 < 20，性能可接受

### Layer 4: 角色分析规则优化

**目标**：不遗漏叙事关键角色。

**改动内容**：
- 删除"仅被提及但从未出场不提取"规则
- 新增"叙事关键但未出场角色"的特殊处理规则：驱动主角行动的核心人物、通过通讯间接出现的角色、被反复提及的关键角色

---

## 数据流变更对比

### Before（修复前）
```
角色分析 → profileData(rich) → 丢弃 introduction/expected_appearances
                              → appearances.description(visual only)
                                    ↓
Phase 1 → description(有角色名) → Phase 3 → video_prompt("年轻男子+动作")
                                                ↓
video.worker → basePrompt(去名化) → 视频模型
```

### After（修复后）
```
角色分析 → profileData(rich) → 全部持久化
         → introduction      → 持久化（两个入口统一）
         → updated_characters → 回写已有角色
                                    ↓
Phase 1 → description(有角色名)
Phase 3 ← {characters_age_gender} + {characters_profile_summary}（新增）
       → video_prompt("面带旧伤的短发男子 + 动作 + 原文氛围")
                                    ↓
video.worker → basePrompt(有视觉标签)
            + 角色外貌描述（从 appearances 查询）
            + 原文片段（srtSegment）
            + 摄影指导（photographyRules）
                                    ↓
              视频模型
```

---

## 实施记录

### 改动文件清单

| 文件 | 改动类型 | 状态 |
|---|---|---|
| `src/types/character-profile.ts` | 类型：CharacterProfileData 增加 expected_appearances | 已完成 |
| `src/lib/workers/handlers/analyze-novel.ts` | 代码：保存 introduction + expected_appearances + updated_characters | 已完成 |
| `src/lib/workers/handlers/story-to-script-helpers.ts` | 代码：保存 expected_appearances | 已完成 |
| `lib/prompts/novel-promotion/agent_character_profile.zh.txt` | 模板：筛选规则放宽 | 已完成 |
| `lib/prompts/novel-promotion/agent_storyboard_detail.zh.txt` | 模板：video_prompt 规则重写 + 新增变量 | 已完成 |
| `lib/prompts/novel-promotion/agent_storyboard_detail.en.txt` | 模板：同步新增变量 + 更新规则 | 已完成 |
| `lib/prompts/novel-promotion/seedance_storyboard_detail.zh.txt` | 模板：同步视觉区分标签规则 + 新增变量 | 已完成 |
| `src/lib/storyboard-phases.ts` | 代码：CharacterAsset 扩展 + buildCharacterProfileSummary + executePhase3 注入 | 已完成 |
| `src/lib/novel-promotion/script-to-storyboard/orchestrator.ts` | 代码：Phase 3 新增 characters_profile_summary 变量 | 已完成 |
| `src/lib/workers/video.worker.ts` | 代码：4 个新函数 + generateVideoForPanel 上下文增强 | 已完成 |

### 审核修复

- **P0 修复**：`parsePhotographyRules` 中 `rules.color_palette`（snake_case）改为 `rules.colorPalette`（camelCase），与 `mergePanelsWithRules` 存入 DB 的格式对齐
- **P1 修复**：英文模板 `agent_storyboard_detail.en.txt` 同步新增 `{characters_profile_summary}` 占位符和视觉标签规则

### 约束

- 无 DB schema 变更（利用现有 nullable 字段和 JSON 字段）
- 不改 Phase 2 和 Phase 3 的并行执行顺序
- 不改图片生成管线、语音分析管线
- 不增加 LLM 调用次数

---

## 验证方案

1. **单元验证**：用末日逃亡小说第一章作为测试素材
   - 角色分析：确认叙事关键角色（含未出场角色）全部提取
   - Phase 3 输出：video_prompt 含视觉区分标签（非"年轻男子"）
   - video.worker 日志：确认 prompt 包含角色外貌 + 原文 + 摄影指导

2. **回归验证**：
   - 默认模式不受影响
   - 现有项目的已生成数据可正常读取（所有新行为基于 nullable 字段）

3. **人工对比**：
   - 同一小说，修复前后的 video_prompt 对比
   - 重点关注：角色可区分性、氛围丰富度、跨镜头叙事连贯性

---

## 已知限制

| 项目 | 说明 |
|---|---|
| video.worker 每次查询角色 | 单次查询 <10ms，可接受；后续可加缓存 |
| Phase 3 prompt token 增加 | 预估 +300 token/clip，总量在预算内 |
| 子形象匹配取第一个 | `loadCharacterVisualDescriptions` 取 `appearances[0]`，暂不匹配面板指定的子形象 |
| profileData 构建逻辑重复 | `analyze-novel.ts` 和 `story-to-script-helpers.ts` 有相似代码，后续可提取公共函数 |

---

## 追加修复：景别-运镜一致性 + 光线时段映射

### 问题

实测发现两个新问题：

1. **景别与运镜矛盾**：shot_type 标记为"远景"，但 video_prompt 写了"推近" — 远景推近后变成中近景，与标注矛盾
2. **夜景太亮**：原文写"夜里十一点四十七分"，但生成画面月亮大亮如白天 — video_prompt 缺少光线强度指引

### 改动内容

三个模板统一新增两组规则：

| 规则 | 内容 |
|---|---|
| 景别与运镜一致性 | 固定景别禁止改变景别的运镜（远景禁止推近）；如需景别转换，shot_type 必须标注起止（如"远景→中景推近"） |
| 光线与时段映射 | 清晨→微弱暖光、正午→明亮、黄昏→暖橙、夜晚→暗、深夜→极暗。严禁深夜场景出现明亮画面 |

### 改动文件

| 文件 | 状态 |
|---|---|
| `lib/prompts/novel-promotion/agent_storyboard_detail.zh.txt` | 已完成 |
| `lib/prompts/novel-promotion/agent_storyboard_detail.en.txt` | 已完成 |
| `lib/prompts/novel-promotion/seedance_storyboard_detail.zh.txt` | 已完成 |
