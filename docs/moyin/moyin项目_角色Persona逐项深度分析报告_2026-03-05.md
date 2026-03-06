# moyin项目 角色Persona逐项深度分析报告（2026-03-05）

## 1. 分析范围与方法

本报告只分析 moyin-creator 项目中的 Persona（你是... / You are... 系统角色）设计，不做与 waoowaoo 的优劣对比。

分析方法：
- 逐个定位 Persona 的代码入口与调用链路。
- 对每个 Persona 拆解 5 个维度：角色定位、输入上下文、输出契约、硬约束机制、可学习价值与风险。
- 额外抽取视频提示词模式与角色设计模式的共性机制。

---

## 2. Persona全量清单（按链路）

2.1 剧本与结构层
- P01 剧本分析师：/root/moyin-creator/src/lib/script/script-parser.ts:56
- P02 分镜师/摄影指导：/root/moyin-creator/src/lib/script/script-parser.ts:136
- P03 影视编剧+分镜师（创意脚本生成）：/root/moyin-creator/src/lib/script/script-parser.ts:829
- P19 好莱坞资深编剧（集标题校准）：/root/moyin-creator/src/lib/script/full-script-service.ts:909
- P20 Script Doctor（集大纲与关键事件）：/root/moyin-creator/src/lib/script/full-script-service.ts:2054

2.2 角色层
- P04 顶级角色设计大师（多阶段角色形象）：/root/moyin-creator/src/lib/character/character-prompt-service.ts:194
- P06 影视角色设计师（缺失角色补全）：/root/moyin-creator/src/lib/script/ai-character-finder.ts:325
- P16 角色校准分析师（角色清洗/保留）：/root/moyin-creator/src/lib/script/character-calibrator.ts:339
- P17 顶级角色设计大师（6层身份锚点）：/root/moyin-creator/src/lib/script/character-calibrator.ts:876
- P18 角色阶段分析顾问：/root/moyin-creator/src/lib/script/character-stage-analyzer.ts:71

2.3 场景与视角层
- P05 影视场景设计师：/root/moyin-creator/src/lib/script/ai-scene-finder.ts:178
- P07 影视美术指导（视角/机位分析）：/root/moyin-creator/src/lib/script/viewpoint-analyzer.ts:104
- P14 场景校准美术指导（补齐场景设计）：/root/moyin-creator/src/lib/script/scene-calibrator.ts:301
- P15 顶级美术指导（关键场景视觉提示）：/root/moyin-creator/src/lib/script/scene-calibrator.ts:555

2.4 分镜校准与视频生成层
- P08 电影叙事分析师（五阶段-1）：/root/moyin-creator/src/lib/script/shot-calibration-stages.ts:176
- P09 视觉描述师（五阶段-2）：/root/moyin-creator/src/lib/script/shot-calibration-stages.ts:225
- P10 摄影指导DP（五阶段-3）：/root/moyin-creator/src/lib/script/shot-calibration-stages.ts:254
- P11 AI图像生成专家（五阶段-4）：/root/moyin-creator/src/lib/script/shot-calibration-stages.ts:314
- P12 AI视频生成专家（五阶段-5）：/root/moyin-creator/src/lib/script/shot-calibration-stages.ts:374
- P21 世界级摄影大师（全集分镜+三层提示词）：/root/moyin-creator/src/lib/script/full-script-service.ts:1617
- P22 资深导演兼剪辑师（组级校准）：/root/moyin-creator/src/components/panels/sclass/sclass-calibrator.ts:94
- P23 世界级摄影师（故事板多帧三层提示词）：/root/moyin-creator/src/lib/storyboard/scene-prompt-generator.ts:318

2.5 发行包装层
- P13 电影预告片剪辑师：/root/moyin-creator/src/lib/script/trailer-service.ts:89
- P24 通用脚本创作模板角色（模板级，不是主链路运行时）：/root/moyin-creator/src/packages/ai-core/services/prompt-compiler.ts:23

---

## 3. 逐Persona深度分析

3.1 P01 剧本分析师（script-parser）
- 角色定位：把自由文本剧本解析成结构化 JSON（角色/集/场景/段落）。
- 输入上下文：用户原始文本。
- 输出契约：字段很细，覆盖角色背景、性格、技能、关系、场景视觉描述等固定 schema。
- 硬约束：强调角色与场景信息不能简化、ID规则、时间枚举和英文字段要求。
- 可学习价值：上游结构越稳，后续链路越稳。
- 风险：长文本混杂时，JSON 可能超长并出现噪声。

3.2 P02 分镜师/摄影指导（script-parser）
- 角色定位：针对单场景生成 camera blocking 级别镜头列表。
- 输入上下文：单场景结构化数据。
- 输出契约：时长、景别、机动、对白、音效、关键帧提示词等。
- 硬约束：镜头数量上限、术语枚举、visualPrompt 模板和长度限制。
- 可学习价值：把可拍摄语义参数化。
- 风险：术语列表偏硬，非典型镜头表达受限。

3.3 P03 影视编剧+分镜师（创意生成）
- 角色定位：把一句话创意/MV/广告输入扩展为可导入标准剧本。
- 输入上下文：自由创意文本 + 时长/场景数等要求。
- 输出契约：强制标题、大纲、人物小传、场景格式。
- 硬约束：若检测到已有分镜结构，禁止合并镜头并强制一一对应。
- 可学习价值：输入类型分流，避免一套 Prompt 处理所有场景。
- 风险：规则密集，偏离后后处理成本高。

3.4 P04 顶级角色设计大师（多阶段角色形象）
- 角色定位：生成角色基础形象 + 多阶段形象 + 一致性元素。
- 输入上下文：剧名、类型、时代、大纲、角色传记、跨集出场统计。
- 输出契约：baseVisualPromptEn/Zh、stages、consistencyElements。
- 硬约束：阶段数按成长幅度动态（1 或 2-4），并限制提示词长度。
- 可学习价值：把角色成长显式建模，而非单一静态提示词。
- 风险：高度依赖上游剧情质量与出场统计质量。

3.5 P05 影视场景设计师（AI补场景）
- 角色定位：从上下文补齐场景卡片（地点、时间、氛围、视觉提示）。
- 输入上下文：命中场景片段、动作样本、角色列表、世界观。
- 输出契约：固定 JSON，包含中英视觉字段。
- 硬约束：要求场景名和剧情作用同时给出。
- 可学习价值：场景可资产化，可进入后续生成链路。
- 风险：上下文不足时推断比例增大。

3.6 P06 影视角色设计师（缺失角色补全）
- 角色定位：根据自然语言补齐未入库角色。
- 输入上下文：时代信息、角色上下文、对白样本。
- 输出契约：角色属性 + 中英视觉提示词 + 重要性。
- 硬约束：服装必须符合时代。
- 可学习价值：支持边做边补角色的生产流程。
- 风险：关系字段准确度受上下文采样影响。

3.7 P07 影视美术指导（视角/机位分析）
- 角色定位：为场景生成背景视角清单（4-6 个）。
- 输入上下文：场景信息 + 分镜摘要 + 本集大纲/关键事件。
- 输出契约：每个视角含中英描述、关键道具、关联镜头索引。
- 硬约束：视角必须匹配场景类型（车内/室内/户外/古代）。
- 可学习价值：提前把镜头需求转成背景资产需求。
- 风险：输入摘要弱时容易退化为通用视角。

3.8 P08 电影叙事分析师（五阶段-1）
- 角色定位：先做叙事骨架，确定每镜头叙事功能和冲突阶段。
- 输入上下文：本集大纲、关键事件、镜头原文、对白、当前镜头参数。
- 输出契约：narrativeFunction、shotPurpose、storyAlignment 等。
- 硬约束：要求回答如何推动冲突、是否违背世界观。
- 可学习价值：先叙事后视觉，控制方向正确性。
- 风险：离散标签可能压平复杂情绪。

3.9 P09 视觉描述师（五阶段-2）
- 角色定位：在叙事骨架上补视觉描述和音频设计。
- 输入上下文：Stage1 输出 + 原始镜头文本。
- 输出契约：visualDescription、characterNames、emotionTags、音频字段。
- 硬约束：主场景固定、角色不可增减、强时代一致性。
- 可学习价值：提前约束场景归属，减少后期返工。
- 风险：闪回/叠画场景对模型执行力要求高。

3.10 P10 摄影指导DP（五阶段-3）
- 角色定位：生成灯光/景深/焦点/机位/焦段等拍摄控制参数。
- 输入上下文：视觉描述 + 美术信息 + 摄影档案 guidance。
- 输出契约：高度枚举化字段，可直接映射 UI/参数。
- 硬约束：大量字段通过 preset token 降歧义。
- 可学习价值：摄影语言参数化，便于跨模型迁移。
- 风险：字段多时易出现填满但不精彩的默认输出。

3.11 P11 AI图像生成专家（五阶段-4）
- 角色定位：生成首帧提示词并判断是否需要尾帧。
- 输入上下文：Stage1-3 结果 + 风格说明 + 媒介约束。
- 输出契约：按语言模式输出 imagePrompt 字段 + needsEndFrame。
- 硬约束：首帧描述拆成 a-f 六大元素，且中英纯度强约束。
- 可学习价值：把首帧做成结构化静态画面规范。
- 风险：文本过长时易丢细节。

3.12 P12 AI视频生成专家（五阶段-5）
- 角色定位：基于首帧生成动态视频描述和尾帧描述。
- 输入上下文：首帧提示、动作摘要、对白、时长、needsEndFrame。
- 输出契约：videoPrompt 字段 + endFramePrompt 字段（条件生成）。
- 硬约束：强调动作过程描述，尾帧仅在需要时产出。
- 可学习价值：把动态过程从静态描述中分离出来。
- 风险：对白密集镜头容易模板化。

3.13 P13 预告片剪辑师
- 角色定位：从大量镜头中选出预告片最优镜头序列。
- 输入上下文：镜头摘要、叙事功能、情绪标签、角色信息。
- 输出契约：只返回选中序号数组。
- 硬约束：明确预告片结构（开场-冲突升级-高潮悬念）与防剧透。
- 可学习价值：把内容生成与内容编排拆成独立智能体。
- 风险：上游镜头标注不准时，选片质量会被放大影响。

3.14 P14 场景校准美术指导
- 角色定位：不改场景集合，只补齐美术设计字段。
- 输入上下文：已有场景 + 出场统计 + 动作/对白样本 + 故事背景。
- 输出契约：architectureStyle、lightingDesign、keyProps、eraDetails 等。
- 硬约束：禁止新增/删除/合并场景，保留原 sceneId。
- 可学习价值：适合存量项目提质，改造成本低。
- 风险：原场景粒度过粗时，补齐后仍可能不够可拍。

3.15 P15 顶级美术指导（关键场景）
- 角色定位：给主/次要场景生成高质量中英视觉提示词。
- 输入上下文：已校准场景属性（建筑、灯光、色彩、道具、时代）。
- 输出契约：场景级 visualPromptZh/En。
- 硬约束：要求词数区间和电影化表达。
- 可学习价值：场景资产可直接进入图生图/概念图阶段。
- 风险：命名匹配失败时可能回填失败。

3.16 P16 角色校准分析师（角色清洗）
- 角色定位：角色去噪与保留策略执行者。
- 输入上下文：候选角色、出场场次、对白样本、全局剧情。
- 输出契约：保留/过滤/合并建议，并给重要性分级。
- 硬约束：宽松保留有名角色，严格过滤纯群演词。
- 可学习价值：从源头降低角色库污染，提高后续角色设计准确度。
- 风险：中文别名复杂，误并名风险始终存在。

3.17 P17 顶级角色设计大师（6层身份锚点）
- 角色定位：为核心角色输出可长期复用的身份锚点与负面提示词。
- 输入上下文：时代背景、时间线、角色基础信息。
- 输出契约：identityAnchors（骨相/五官/标记/颜色/皮肤/发型）+ negativePrompt。
- 硬约束：要求 uniqueMarks 数量与位置精度，强调 Hex 色值锚点。
- 可学习价值：这是一致性核心资产，不是普通文案。
- 风险：字段复杂，解析容错要求高。

3.18 P18 角色阶段分析顾问
- 角色定位：决定角色是否需要多阶段形象，并给阶段划分建议。
- 输入上下文：总集数、角色信息、剧情大纲。
- 输出契约：needsMultiStage、分阶段信息、一致性元素。
- 硬约束：给出明确判断标准（时间跨度、身份变化、集数阈值等）。
- 可学习价值：是 P04/P17 的决策前置层，减少无意义阶段设计。
- 风险：边界角色可能误判。

3.19 P19 好莱坞资深编剧（集标题）
- 角色定位：批量补全集标题。
- 输入上下文：全剧大纲、人物、每集内容摘要。
- 输出契约：titles 映射。
- 硬约束：标题长度、风格一致性、跨集连贯性。
- 可学习价值：中后期包装能力，提升可读性和发行友好度。
- 风险：摘要质量弱时标题会空泛。

3.20 P20 Script Doctor（集大纲）
- 角色定位：为每集提炼 synopsis 和 key events。
- 输入上下文：全剧信息 + 每集内容摘要。
- 输出契约：synopsis + keyEvents。
- 硬约束：字数区间、事件数量、强调冲突转折与连贯。
- 可学习价值：形成叙事索引层，支撑后续分镜与预告片任务。
- 风险：摘要化有压缩损失。

3.21 P21 世界级摄影大师（全集分镜总引擎）
- 角色定位：在全局上下文下，批量生成镜头级三层提示词和完整摄影参数。
- 输入上下文：剧本全局、单集信息、原始镜头文本、风格档案。
- 输出契约：超全字段镜头 JSON（叙事+摄影+首尾帧+视频prompt）。
- 硬约束：主场景固定、角色完整识别、中英字段严格分离、needsEndFrame 规则化。
- 可学习价值：把导演意图转成可执行镜头资产。
- 风险：Prompt 很长，对 token 和解析容错压力大。

3.22 P22 资深导演兼剪辑师（组级校准）
- 角色定位：对镜头组做叙事弧线和过渡优化，不改核心内容。
- 输入上下文：镜头组摘要、时长、角色映射。
- 输出契约：narrativeArc、transitions、groupAudioDesign、calibratedPrompt。
- 硬约束：过渡条数必须等于镜头数减 1；禁止凭空加角色/场景。
- 可学习价值：把单镜头正确提升到组节奏正确。
- 风险：镜头底层质量差时，组级修复能力有限。

3.23 P23 世界级摄影师（故事板多帧三层提示词）
- 角色定位：基于 storyboards 图片批量产出首帧/尾帧/视频三层提示词。
- 输入上下文：contact sheet 图像 + 故事上下文 + 分帧列表。
- 输出契约：每帧双语三层提示词 + needsEndFrame 判断。
- 硬约束：明确必须尾帧和可省尾帧的条件。
- 可学习价值：非常适合先画格子图再补动态提示词的流程。
- 风险：依赖视觉识别精度，复杂画格子图会误判动作关系。

3.24 P24 通用脚本创作模板角色（模板级）
- 角色定位：作为可复用模板生成短视频脚本 JSON（非主链路核心）。
- 输入上下文：prompt、场景数量。
- 输出契约：sceneId、旁白、visualContent、action、camera、characterDescription。
- 硬约束：中英字段职责分离。
- 可学习价值：给多产品线快速起步的轻量模板层。
- 风险：模板通用性强，但深度不如主链路 Persona 体系。

---

## 4. 视频提示词的模式总结（对方项目）

4.1 模式A：分层拼装（运行时）
- 入口：/root/moyin-creator/src/lib/generation/prompt-builder.ts:112
- 结构：Camera、Lighting、Subject、Mood 四层拼接。
- 重点：不是写一大段文案，而是结构化要素拼接。

4.2 模式B：三层提示词（生成链路）
- 入口：
  - /root/moyin-creator/src/lib/script/shot-calibration-stages.ts:314
  - /root/moyin-creator/src/lib/script/shot-calibration-stages.ts:374
  - /root/moyin-creator/src/lib/script/full-script-service.ts:1720
- 三层定义：首帧提示词（静态起点）+ 视频提示词（动态过程）+ 尾帧提示词（完成态）。

4.3 模式C：Provider参数内联
- 入口：/root/moyin-creator/src/components/panels/director/use-video-generation.ts:608
- 文本参数：--rs 分辨率、--rt 比例、--dur 时长、--cf 固定机位。
- 含义：不仅优化提示词文案，也治理平台协议层参数。

4.4 模式D：首尾帧引用与条件化
- 入口：/root/moyin-creator/src/components/panels/director/split-scenes.tsx:1210
- 规则：needsEndFrame=true 才传尾帧。
- 工程点：首尾帧统一转 HTTP URL，I2V 模式避免与角色参考图混用。

---

## 5. 角色设计体系的关键模式

5.1 多层角色链路
- 判定是否阶段化：P18。
- 生成多阶段角色：P04。
- 角色清洗和保留：P16。
- 核心角色身份锚点与负面词：P17。

结论：不是一个角色 Prompt，而是一条角色治理流水线。

5.2 角色一致性机制
- 一致性元素（脸型/体型/独特标记）。
- 6层身份锚点（identityAnchors）。
- negativePrompt 反向约束。
- 时代服装强约束。

这套机制可以解释角色跨镜头稳定性更好的原因。

---

## 6. 只看对方项目的结论（不做对比）

- 强项不在某一句提示词，而在 Persona 分工细、链路阶段化、输出契约化。
- 角色和场景效果好的根因，是前置分析 + 中间层约束 + 后端参数治理的组合。
- 视频生成质量来自四层联动：
  1. 镜头语义先结构化。
  2. 三层提示词拆分（首帧/动态/尾帧）。
  3. needsEndFrame 条件化。
  4. provider 参数与素材引用协议一体化。

---

## 7. 后续观察建议（分析阶段）

为了避免只凭体感，建议后续按以下维度观察：
- 角色一致性：同角色跨 10 镜头的人脸与服装稳定率。
- 场景一致性：主场景是否被错误漂移（特别是闪回镜头）。
- 动态质量：视频提示词是否描述动作过程，而不是静态画面。
- 尾帧收益：needsEndFrame true/false 两组质量差异。
- 重跑稳定性：同镜头重跑 3 次的方差。
