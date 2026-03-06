# 综合分析报告：waoowaoo 与 moyin-creator 链路节点级对比

- 日期：2026-03-05
- 目标：沉淀“别人优点 + wao 优点 + 综合策略”，并细化到链路节点
- 约束：仅分析，不改代码

## 1. 证据范围

### 1.1 waoowaoo 侧

- src/lib/novel-promotion/story-to-script/orchestrator.ts
- src/lib/workers/handlers/story-to-script.ts
- src/lib/workers/handlers/script-to-storyboard.ts
- src/lib/novel-promotion/script-to-storyboard/orchestrator.ts
- lib/prompts/novel-promotion/agent_character_profile.zh.txt
- lib/prompts/novel-promotion/select_location.zh.txt
- lib/prompts/novel-promotion/agent_clip.zh.txt
- lib/prompts/novel-promotion/screenplay_conversion.zh.txt

### 1.2 moyin-creator 侧

- src/lib/ai/feature-router.ts
- src/lib/script/script-parser.ts
- src/lib/ai/model-registry.ts
- src/lib/api-key-manager.ts
- src/lib/utils/retry.ts
- src/lib/ai/batch-processor.ts
- src/lib/utils/concurrency.ts
- src/lib/script/full-script-service.ts
- src/lib/script/viewpoint-analyzer.ts
- src/lib/script/shot-calibration-stages.ts
- src/lib/ai/worker-bridge.ts
- src/workers/ai-worker.ts
- src/packages/ai-core/protocol/index.ts
- src/packages/ai-core/api/task-poller.ts
- src/packages/ai-core/api/task-queue.ts

## 2. 结论先行

你对“角色与场景效果目前看起来别人更好”的判断，有较强技术依据。

关键原因不是某一条 prompt，而是链路治理能力：

1. 阶段化拆分更彻底。
2. 预算治理更显式。
3. 失败回收闭环更完整。
4. 批处理与并发节奏控制更系统。

但同时要强调：waoowaoo 的核心优势很强。

1. 主链路清晰，任务状态可追踪。
2. 输出约束严格，结构化结果更可控。
3. 边界匹配与 JSON 修复能力实用。

## 3. 角色生成链路：节点级可学点

### 节点 A：输入组织与任务分发

- wao 优点：角色与场景并行分析，吞吐高。
- moyin 优点：按功能路由模型，支持多模型轮询。
- 可迁移策略：给 wao 增加任务画像字段（长度、人物密度、复杂度），用于模型与预算分档。

### 节点 B：角色候选提取

- wao 优点：角色提示词规则密度高，输出规整。
- moyin 优点：更强调“抽取后校准”的链路意识。
- 可迁移策略：保留 wao 强约束 prompt，增加轻量二阶段校准（别名归并、关系补全）。

### 节点 C：别名与关系一致性

- wao 现状：有角色介绍与称呼映射基础。
- 机会点：冲突修复可更显式。
- 可迁移策略：拆分三类冲突处理：同名异人、异名同人、关系互斥。

### 节点 D：失败回收

- wao 现状：有步骤级重试。
- moyin 优点：重试 + key 轮换 + 预算治理联动。
- 可迁移策略：按错误类型分流重试，避免统一重试策略导致成本失控。

## 4. 场景生成链路：节点级可学点

### 节点 A：场景提取

- wao 优点：粒度规则明确，强调独立叙事动作。
- moyin 优点：跨集上下文与后置校准更完整。
- 可迁移策略：增加场景粒度一致性检查（过粗/过细自动标注）。

### 节点 B：场景描述生成

- wao 优点：强调空间层次、光线方向、叙事用途。
- moyin 优点：场景属性补全（风格、道具、光影）更系统。
- 可迁移策略：加入描述完整性校验器，避免只美观不实用。

### 节点 C：资产映射与召回

- wao 优点：已有召回补偿与库名复用意识。
- moyin 优点：批处理 + 并发控制适合规模化映射。
- 可迁移策略：映射结果分置信度，高风险映射进入补召回或人工确认。

### 节点 D：空间层补偿

- wao 亮点：已实现空间线索检测并补充外圈/内核/出入口等层级场景，并可回写 clip location。
- 可迁移策略：保留该优势，补充命中率与误命中率统计。

## 5. 分镜与剧本转换链路：节点级可学点

### 节点 A：切片与边界锚定

- wao 强项：切片后做边界匹配校验，并支持失败重试。
- 可迁移策略：增加切片质量评分，识别跨段断裂风险。

### 节点 B：screenplay 转换

- wao 强项：强调忠实原文与结构化输出。
- moyin 优点：调用治理层成熟。
- 可迁移策略：优先补治理层，而不是先大改 prompt。

### 节点 C：JSON 合法性与修复

- wao 强项：已有 code fence 清理、平衡 JSON 提取、修复解析。
- moyin 优点：从 400 错误学习模型上限，减少截断风险。
- 可迁移策略：将 repair 与预算联动，避免反复无效重试。

## 6. 模型调用治理：节点级可学点

### 节点 A：统一入口

- moyin 优点：callFeatureAPI 统一入口，减少重复拼接 provider/model。
- 可迁移策略：wao 保持现有主链路，补 feature -> model policy 层。

### 节点 B：预算与 clamp

- moyin 优点：getModelLimits + estimateTokens + max_tokens clamp。
- wao 机会点：步骤预算参数需要更完整透传与观测。
- 可迁移策略：记录请求值与生效值，形成可追踪日志。

### 节点 C：错误驱动学习

- moyin 优点：可从错误中学习模型限制并缓存。
- 可迁移策略：先在高频节点试点，验证收益后扩展。

### 节点 D：并发与错峰

- moyin 优点：runStaggered 控制并发峰值。
- 可迁移策略：wao 在多 clip 并行时引入错峰，降低瞬时失败率。

## 7. 需要客观看待的事实（moyin 侧）

1. ai-worker.ts 中已实例化 TaskPoller，但主流程仍有手写 pollTaskCompletion。
2. TaskQueue 定义完整，但主链路使用痕迹弱。
3. worker 侧依赖多条 /api/ai 路由，链路可见性与实现分布并不完全一致。

结论：值得学习其“治理思想”，不建议照搬其当前接口组织形态。

## 8. 为什么会有“别人效果更好”的体感

高概率原因：

1. 多阶段校准降低了单步复杂度。
2. token 预算治理减少了长文本临界失败。
3. 失败回收机制使坏样本回正率更高。
4. 并发策略减少限流与抖动。

但也存在样本偏差风险：

- 如果观察样本集中在对方擅长题材，体感会被放大。
- 未做同条件 A/B 前，结论应视为“高可信判断”，不是终局结论。

## 9. 公平评估框架

1. 固定输入集：至少 30 篇，覆盖短中长文本与多题材。
2. 固定模型参数：同档模型、同温度、同 token 上限、同重试上限。
3. 角色指标：召回率、别名归一正确率、关系一致性。
4. 场景指标：场景命中率、映射准确率、漏场景率、重复率。
5. 分镜指标：JSON 合法率、结构完整率、跨段连贯性。
6. 治理指标：重试率、超限率、失败回收率、平均耗时。
7. 人评指标：可拍性、节奏、角色可信度。

## 10. 综合改造路线（仅方案）

### 阶段一：先补稳定性底座

1. 打通预算参数透传并可观测。
2. 错误分流重试（限流/解析/内容缺失）。
3. 输出失败类型分布。

### 阶段二：补节点级校准

1. 角色链路补别名与关系校准。
2. 场景链路补粒度与描述完整性校验。
3. 低置信映射进入补召回通道。

### 阶段三：补规模化调度

1. 高负载节点引入双约束分批。
2. 并行任务引入并发上限与错峰。
3. 用统一评估框架做 A/B，确认收益再扩大改造。

## 11. 决策结论

1. waoowaoo 强在可控性与主链路质量。
2. moyin 强在调度治理与失败回收。
3. 最优路径是“保留 wao 强约束底盘 + 引入 moyin 治理能力”，而不是重写全链路。
