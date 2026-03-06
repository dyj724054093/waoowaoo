# 审核发现问题修复设计

**目标：** 修复首轮审核中已经确认的 3 类高优先级问题：测试语法错误、Prompt 变量声明缺失、视频 worker 角色外貌匹配缺陷。

**范围：**
- 修复 `tests/unit/worker/story-to-script-orchestrator.retry.test.ts` 的语法错误。
- 修复 `src/lib/prompt-i18n/catalog.ts` 中 `characters_profile_summary` 的缺失声明。
- 修复 `src/lib/workers/video.worker.ts` 中 panel 角色 `appearance` 与角色 `aliases` 的解析逻辑。

**不在本次范围：**
- 不顺手清理其他 lint warning。
- 不做无关重构。
- 不修改终端显示乱码问题；当前证据表明这属于显示链路，不是仓库文件编码损坏。

**方案对比：**

1. **最小修复方案（采用）**
   - 只修已确认根因。
   - 优点是风险低、可验证性强。
   - 缺点是保留部分非阻塞 warning。

2. **顺带清理方案（不采用）**
   - 在最小修复基础上继续清理 `any`、未使用变量、Hook 依赖告警。
   - 优点是表面更干净。
   - 缺点是范围膨胀，容易引入额外回归。

**设计细节：**

## 1. 测试语法错误

- 问题位于 `tests/unit/worker/story-to-script-orchestrator.retry.test.ts`。
- 文件中存在成对双单引号，导致解析失败。
- 本次仅修正引号，使测试恢复为原始意图，不改变行为断言。

## 2. Prompt 变量声明缺失

- `buildPrompt` 会校验模板占位符与 catalog 声明完全一致。
- 业务代码与测试已经使用 `characters_profile_summary`，但 catalog 未声明。
- 本次只在以下条目补齐变量声明：
  - `NP_AGENT_STORYBOARD_DETAIL`
  - `NP_SEEDANCE_DETAIL`

## 3. Video worker 角色外貌匹配

- 当前问题有两层：
  - panel 角色 JSON 中的 `appearance` 信息被丢弃；
  - 角色匹配错误地把 `name` 以 `/` 分割当作别名，而不是解析 `aliases` 字段。
- 修复方案：
  - 将 panel 角色解析为包含 `name` 和可选 `appearance` 的结构；
  - 增加 `aliases` JSON 解析；
  - 匹配角色时同时支持主名和别名；
  - 选择外貌时优先使用与 `appearance` 对应的 `changeReason`，否则回退到第一条可用外貌。

**验证策略：**
- 先运行受影响测试，确认失败或复现问题。
- 实现最小修复后，运行定向测试。
- 最后运行 `npm run lint` 与 `npm run test:unit:all` 作为最终证据。
