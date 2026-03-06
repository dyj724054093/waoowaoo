# moyin-creator 链路深度拆解与可迁移建议

- 分析日期：2026-03-05
- 分析目标：聚焦执行链路，提炼可迁移到 waoowaoo 的工程实践
- 范围：只做分析，不改业务代码

## 1. 结论先行

moyin-creator 在链路层最值得学习的不是某个单点函数，而是以下五项组合能力：

1. 功能入口统一到 callFeatureAPI，减少 UI 层重复拼接 provider/model 配置。
2. feature-router 负责 功能 -> provider/model 的映射，并支持多模型轮询。
3. callChatAPI 内置 token 预算、max_tokens clamp、错误驱动自学习、key 轮换与重试。
4. 大任务使用 processBatched + runStaggered，控制上下文和并发节奏。
5. 复杂分镜任务采用多阶段拆分，降低单次调用 token 压力。

同时需要明确：该项目存在链路并存与部分漂移，不能照搬。

## 2. 我看到的真实链路

### 2.1 文本 AI 主链路（脚本/校准）

Script 面板入口 -> full-script-service / scene-calibrator / viewpoint-analyzer -> callFeatureAPI -> callChatAPI -> provider API。

关键文件：

- src/components/panels/script/index.tsx
- src/lib/script/full-script-service.ts
- src/lib/script/viewpoint-analyzer.ts
- src/lib/ai/feature-router.ts
- src/lib/script/script-parser.ts

### 2.2 媒体生成链路（worker）

AIWorkerBridge（主线程） <-> ai-worker.ts（Worker） -> /api/ai/image|video|task 轮询 -> 进度事件回传 -> UI store 更新。

关键文件：

- src/packages/ai-core/protocol/index.ts
- src/lib/ai/worker-bridge.ts
- src/workers/ai-worker.ts

### 2.3 实际观察到的链路漂移

这是非常关键的事实：

1. TaskPoller 被导入并实例化，但 worker 主流程里仍有手写轮询逻辑。
2. TaskQueue 定义完整，但在主链路里几乎没有真实消费。
3. 仓库内对 /api/ai/image|video|task 有调用点，但 route 实现可见性不足。

说明它的设计能力与当前运行链路不完全一致。

## 3. 逐层可学习点（链路视角）

### 3.1 功能路由层（Feature Router）

可学点：

1. 功能绑定解耦。
2. 多模型轮询策略。
3. 统一入口增强可观测性与调度一致性。

对应实现：

- getAllFeatureConfigs
- getFeatureConfig
- resetFeatureRoundRobin
- callFeatureAPI

对 waoowaoo 的启发：

waoowaoo 已有 run-runtime 与 ai-runtime，可补 feature 级 model policy，避免每个 handler 自行定策略。

### 3.2 调用执行层（callChatAPI）

可学点：

1. 调用前预算检查：input token、output token。
2. max_tokens 自动 clamp。
3. 从错误消息中学习模型上限（error-driven discovery）。
4. 多 key 轮换 + 429 重试。

对应实现：

- src/lib/script/script-parser.ts
- src/lib/ai/model-registry.ts
- src/lib/api-key-manager.ts
- src/lib/utils/retry.ts

对 waoowaoo 的启发：

当前最缺的是步骤预算参数打通，其次是统一 provider 预算策略。可以直接借鉴这套治理思想。

### 3.3 大任务编排层（Batch + Concurrency）

可学点：

1. processBatched 采用输入/输出双约束分批。
2. 批次失败容错，允许部分成功结果返回。
3. runStaggered 控制并发和错峰启动，降低 API 峰值。

对应实现：

- src/lib/ai/batch-processor.ts
- src/lib/utils/concurrency.ts

对 waoowaoo 的启发：

orchestrator 节点可引入批处理子节点，替代一次性喂超长 prompt。

### 3.4 多阶段拆分层（Shot Calibration）

可学点：

1. 大 schema 拆成多个阶段，每次调用更稳定。
2. 每阶段可独立重试和部分回收。
3. 阶段间累积结果，提升整体完整度。

对应实现：

- src/lib/script/shot-calibration-stages.ts

对 waoowaoo 的启发：

story-to-script 与 script-to-storyboard 可借鉴阶段化生成，尤其适合长文本结构化输出。

### 3.5 Worker 协议层（Command/Event）

可学点：

1. 协议类型先行，命令与事件边界清晰。
2. Bridge 做中心化事件分发，UI 只消费业务事件。

对应实现：

- src/packages/ai-core/protocol/index.ts
- src/lib/ai/worker-bridge.ts

对 waoowaoo 的启发：

waoowaoo 已有 run event 协议，可进一步加强事件 schema 严格化与统一映射层。

## 4. 不建议直接照搬的部分

### 4.1 API 路由可见性不足

仓库中调用了多个 /api/ai 端点，但对应 route 实现在当前目录不可见或不完整。该模式不建议直接迁移。

### 4.2 轮询实现双轨并存

TaskPoller 和手写轮询并存，说明组件化未完全落地，容易产生行为分叉。

### 4.3 任务队列定义与消费脱节

TaskQueue 定义完整，但主流程使用痕迹弱，属于能力存在但未成为主路径。

## 5. 对 waoowaoo 的链路级改造建议

### 5.1 第一优先级（立即可做）

1. 打通 maxOutputTokens：handler -> ai-runtime -> llm options -> provider 映射。
2. provider 层统一计算 effectiveMaxTokens，并记录日志。
3. 把预算、模型、attempt 写入 run event 元数据。

### 5.2 第二优先级（短期）

1. 引入批处理节点模板：双约束分批 + 部分成功合并。
2. 将高风险长输出步骤拆分为阶段节点。
3. 把 retry / repair 策略抽成共用组件，避免两条主链路分叉。

### 5.3 第三优先级（中期）

1. 引入 feature-model policy（按功能绑定模型与预算档位）。
2. 增加运行指标：token 超限率、repair 命中率、重试率。
3. 收口 legacy 路径，避免协议双轨并存。

## 6. 可执行学习清单

1. 先落地 maxOutputTokens 端到端透传。
2. 再落地 effectiveMaxTokens 与 provider 映射函数。
3. 对 story-to-script 增加 json repair 子步骤，和 script-to-storyboard 对齐。
4. 选一个高风险步骤试点 batchStep。
5. 通过 run event 验证失败率、重试率、平均耗时、平均 token。

## 7. 最终判断

如果只看链路可学习价值，moyin-creator 对 waoowaoo 最大贡献在两点：

1. 调用治理：预算 + clamp + 轮换 + 自学习。
2. 大任务拆解：分批 + 多阶段。

不是照搬其 worker 端接口组织方式。

一句话总结：学它的调度思想和稳定性策略，不照搬它当前接口形态。
