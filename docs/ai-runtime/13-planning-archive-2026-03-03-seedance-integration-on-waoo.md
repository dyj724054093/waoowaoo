# 13 规划归档（2026-03-03）- Seedance 方案整合到 waoo

## 文档目的

本文用于评审：在 waoo 现有架构上，整合 Seedance 提示词方法论，形成可落地的 AI 视频创作方案。

时间：2026-03-03  
时区：Asia/Shanghai

---

## 结论先行

1. 采用 waoo 为主干继续演进，不另起新项目。
2. 整合重点是提示词编排、分镜一致性策略、成片策略，不替换任务系统与存储系统。
3. 按 P1/P2/P3 三阶段推进，保证可回滚、可验证。

---

## 为什么在 waoo 基础上改更优

waoo 已具备完整链路：

1. 文本到分镜编排。
2. 分镜到图像/视频生成。
3. 多模型提供商路由与任务追踪。
4. 成片渲染与状态轮询。

如果重做新项目，将重复建设：

1. 任务队列与重试语义。
2. 模型配置与提供商兼容层。
3. 媒体落盘与 URL 管理。
4. 前端阶段运行时状态恢复。

因此应复用 waoo 基础设施，只增强“上层创作智能”。

---

## 当前要解决的核心问题

1. 同场景多分镜（近景/中景）一致性不足。
2. 角色手动选择与最终生成绑定不够强。
3. 最终合并在部分场景下像“硬拼接”。
4. 上游模型不兼容时，错误提示可读性不足。

---

## 整合架构设计（waoo-native）

### A. 工作流档位层

在现有 workflowMode 基础上新增 seedance 档位：

1. 旧档位默认行为不变。
2. seedance 档位启用专用提示词编排策略。
3. 与现有任务协议保持兼容。

### B. Prompt Profile 层

引入 Seedance 风格的结构化模板能力：

1. 时间轴表达（0-3s / 3-6s / ...）。
2. 模板化镜头目标（开场、发展、高潮、收束）。
3. 多模态参考绑定语义（图片/视频/音频槽位）。
4. 严格 JSON 输出约束，降低解析失败。

### C. 分镜编排层

在 script_to_storyboard phase1 注入规则：

1. 新场景优先 SC1 空镜建场。
2. SC2 及之后引入角色与动作。
3. 为下一镜头保存连贯性提示（尾帧摘要）。

### D. 视频适配层

把分镜结构化结果编译为当前视频生成器可消费输入：

1. 不改 provider 抽象。
2. 新增 seedance 提示词组装器。
3. 继承现有比例/时长/分辨率约束。

### E. 成片策略层

最终渲染按“时间轴 + 链接关系”合并：

1. 尊重 linked panels 覆盖关系。
2. 避免 first-last-frame 链路导致的重复拼接。
3. 转场策略可配置、可诊断。

---

## 分阶段实施计划（待评审）

## P1（2-3天）最小可跑闭环

目标：

1. seedance 工作流开关可用。
2. seedance 分镜模板接入。
3. SC1 空镜、SC2 出角规则上线。

交付：

1. Prompt 模板注册与调用链路。
2. 分镜 phase1 稳定输出字段：shot_type、camera_move、duration、video_prompt。
3. 前端显示当前工作流与关键提示词预览。

验收：

1. 单个剧集可完整跑通脚本到分镜。
2. 分镜 JSON 可稳定解析，无新增大规模解析失败。

## P2（3-5天）一致性与可控性

目标：

1. 场景/角色连续性增强。
2. 角色手动选择强绑定。
3. 成片合并体验升级。

交付：

1. 每分镜落盘 tail frame hint。
2. 角色选择到生成参数的校验与追踪。
3. 时间轴合并 + 链接去重策略。

验收：

1. 同场景近景/中景不再明显漂移。
2. 手动选角可在日志与结果中核验。
3. 成片无明显重复片段拼接痕迹。

## P3（3-4天）质量自动化

目标：

1. 加入漂移检测与自动重试。
2. 扩展模板族（叙事/产品/TVC/口播）。

交付：

1. 角色漂移、场景漂移、动作偏移检测。
2. 有上限的自动重试与失败分类。
3. 模板组与文档化示例。

验收：

1. 漂移失败能分类可观测。
2. 失败提示对用户可行动。

---

## 风险与应对

1. Prompt 复杂度上升导致解析失败增加。  
应对：严格 JSON 契约 + 编排层限次重试。

2. 提供商模型能力差异导致不稳定。  
应对：模型白名单 + 预检 models 列表。

3. 连贯性策略过强，压制创意。  
应对：提供连贯强度档位与回退模式。

4. 合并策略变化引发用户预期偏差。  
应对：提供合并策略选项与可视化诊断。

---

## 本轮不做

1. 不重写 waoo 的任务/存储架构。
2. 不重写 provider 适配器底层协议。
3. 不迁移历史项目数据结构。
4. 不涉及 YAML 与容器编排重构。

---

## 审核清单

1. 是否保持向后兼容，默认路径不受影响。
2. Prompt 与解析契约是否有版本和测试。
3. 连贯与选角控制是否可观测。
4. 成片逻辑是否可解释、可回放。
5. 模型不支持错误是否能明确提示用户下一步操作。

---

## 参考文献与证据清单（完整）

以下为本次规划使用的全部参考来源。

### 一、外部仓库参考

1. 仓库：liangdabiao/make-prompt-seedance2  
URL：https://github.com/liangdabiao/make-prompt-seedance2  
本地镜像：/root/work/make-prompt-seedance2

关键参考文件：

1. README.md
2. structured-prompt.md
3. ads-prompt/structured-prompt.md
4. CLAUDE.md

提取到的关键方法：

1. 时间轴式提示词组织。
2. 镜头模板化拆解（场景、动作、运镜、声音）。
3. 多模态参考语法思想。
4. 分镜稳定性与低复杂度动作约束思想。

2. 补充仓库：liangdabiao/Seedance2-Storyboard-Generator  
URL：https://github.com/liangdabiao/Seedance2-Storyboard-Generator  
用途：定位其为方法论与模板资料，而非完整后端工程。

### 二、waoo 内部代码参考

1. src/lib/workers/handlers/script-to-storyboard.ts
2. src/lib/novel-promotion/script-to-storyboard/orchestrator.ts
3. src/lib/prompt-i18n/prompt-ids.ts
4. src/lib/prompt-i18n/catalog.ts
5. src/lib/prompt-i18n/template-store.ts
6. lib/prompts/novel-promotion/agent_storyboard_plan.en.txt
7. src/lib/workers/handlers/panel-image-task-handler.ts
8. src/lib/generators/video/openai-compatible.ts
9. prisma/schema.prisma
10. src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceExecution.ts
11. src/types/project.ts

### 三、运行与日志证据参考

1. docs/ai-runtime/12-incident-archive-2026-03-03-grok-video-recovery-verified.md
2. docs/ai-runtime/patches/2026-03-03-grok-video-recovery-verified.txt
3. 本地运行日志（2026-03-03）：上游 404 模型不支持被包装为 LLM_EMPTY_RESPONSE。

---

## 评审后实施建议

若评审通过，先执行 P1，采用小步提交策略：

1. 先加工作流开关与模板注册。
2. 再改编排 phase1 规则。
3. 最后补 UI 可见与最小验收用例。

并继续遵守当前规则：不提交 YAML 配置文件，只提交核心代码与必要文档。
