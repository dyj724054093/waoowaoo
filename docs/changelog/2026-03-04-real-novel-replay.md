# 2026-03-04 真实小说回放归档（场景层级 + 分镜压缩）

## 背景

用户反馈两类问题：

1. 图生图/分镜提示词里存在重复节拍，镜头语言堆叠但叙事推进不足。
2. 场景识别只落到单一“大厅”层级，缺少外围/出入口/围栏线等空间分层，导致上下文不连贯。

本次归档记录 2026-03-04 的修复验证结果，重点是“真实输入回放 + 目标单测”。

## 涉及改动（本轮关注）

- `src/lib/novel-promotion/script-to-storyboard/orchestrator.ts`
  - 增强相邻分镜去重。
  - 增加同叙事节拍压缩（同地点 + source_text 高相似 + 角色一致）。
  - 增加镜头节奏 guardrails（避免 POV/Dutch 连续滥用）。

- `src/lib/workers/handlers/analyze-novel.ts`
  - 增加站点类场景的空间层级补全：
    - `outer_perimeter`
    - `inner_core`
    - `gate_zone`
    - `fence_line`

- `tests/unit/worker/script-to-storyboard-orchestrator.contract.test.ts`
  - 新增多题材分镜压缩与节拍保持测试。

- `tests/unit/worker/analyze-novel.test.ts`
  - 新增英文/中文站点分层、dock hub 分层、非站点不误补等测试。

- `scripts/replay-real-novel.ts`
  - 修复回放脚本中的中文关键词转义：从 `\\uXXXX` 修正为 `\uXXXX`，确保中文线索可匹配。

## 真实输入回放

### 输入

- 路径：`/mnt/d/work/xiaoshuo/*.md`（当前目录下 1 篇）
- 回放脚本：`scripts/replay-real-novel.ts`

### 执行命令

```bash
npx tsx scripts/replay-real-novel.ts
```

### 关键输出

- 输入文本规模：`chars=2240`, `lines=72`
- 场景层级补全：`0 -> 4`（修复后）
  - `第七码头旧检疫站_外围`
  - `第七码头旧检疫站_内部`
  - `第七码头旧检疫站_出入口`
  - `第七码头旧检疫站_围栏线`
- 分镜压缩：`inputPanelCount=5 -> finalPanelCount=4`
  - 重复反应节拍被合并，核心推进节拍保留。

## 目标单测验证

执行命令：

```bash
npx vitest run tests/unit/worker/script-to-storyboard-orchestrator.contract.test.ts tests/unit/worker/analyze-novel.test.ts --reporter=dot
```

结果：

- `Test Files: 2 passed (2)`
- `Tests: 22 passed (22)`

## 编码修复补充（2026-03-04）

1. 已移除 `scripts/replay-real-novel.ts` 文件头 BOM，避免部分终端/工具链把首行识别异常。
2. 代码文件 BOM 体检：`git ls-files` 下 995 个代码文件（ts/tsx/js/json）检测结果为 0 个 BOM。
3. 复验命令已通过：
   - `npx tsx scripts/replay-real-novel.ts`
   - `npx vitest run tests/unit/worker/script-to-storyboard-orchestrator.contract.test.ts tests/unit/worker/analyze-novel.test.ts --reporter=dot`

## 已知限制

1. 全量测试在当前环境仍可能受外部依赖影响（如本地 billing DB `127.0.0.1:3307`）。
2. PowerShell/WSL 混合终端会出现中文日志乱码显示，不影响本次逻辑判断与测试结论。

## 结论

本轮“场景层级补全 + 分镜节拍压缩”在真实小说输入和目标单测上均验证通过，修复方向有效，且对站点类场景的上下文连贯性有明显提升。
