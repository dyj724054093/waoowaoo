# 2026-03-06 审核修复与重新部署归档

## 背景

本轮根据审核结果，继续处理了两类问题：

1. 修复首轮审核中已确认的测试与业务缺陷。
2. 清理 `scripts/replay-real-novel.ts` 中阻塞 `lint` 的两处 `any`，并完成重新部署。

## 本次修改

- `tests/unit/worker/story-to-script-orchestrator.retry.test.ts`
  - 修复 recall fallback 测试块语法错误。
  - 修正 `existing_locations_json` 相关断言，使其与当前实现的 `[]` 输入契约一致。

- `src/lib/prompt-i18n/catalog.ts`
  - 为 `NP_AGENT_STORYBOARD_DETAIL` 补齐 `characters_profile_summary`。
  - 为 `NP_SEEDANCE_DETAIL` 补齐 `characters_profile_summary`。

- `src/lib/workers/video.worker.ts`
  - 增加 panel 角色 `appearance` 解析。
  - 正确解析角色 `aliases`。
  - 优先按 `appearance.changeReason` 选择角色外貌，否则回退默认外貌。

- `scripts/replay-real-novel.ts`
  - 移除两处 `as any`。
  - 改为使用 `CharacterAsset[]` / `LocationAsset[]` 现有类型，保持脚本行为不变。

## 验证结果

### 定向验证

```bash
npm exec vitest run tests/unit/helpers/prompt-i18n-catalog-contract.test.ts
npm exec vitest run tests/unit/worker/video-worker.test.ts
npm exec vitest run tests/unit/worker/story-to-script-orchestrator.retry.test.ts
npx eslint scripts/replay-real-novel.ts
npx tsx scripts/replay-real-novel.ts
```

结果：通过。

### 全量验证

```bash
npm run lint
npm run test:unit:all
```

结果：

- `npm run lint`：0 error，剩余 11 个 warning。
- `npm run test:unit:all`：通过。

## 说明

1. 终端中仍可能出现中文乱码显示，这是当前 PowerShell / WSL 输出链路问题，不是仓库文件 UTF-8 编码损坏。
2. 本次只处理了阻塞问题，没有顺手清理无关 warning。
3. 仓库当前存在其他未归属于本次任务的工作区改动，已保持不动。

## 部署

本归档写入后，已按仓库 `docker-compose.yml` 执行重新部署，并单独检查容器状态。
