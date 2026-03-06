# 审核问题修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复审核中已确认的 3 个高优先级问题，并用 lint 与单元测试验证结果。

**Architecture:** 采用最小改动策略：先修阻塞测试语法，再补 prompt catalog 合约，最后修复 video worker 的角色外貌解析链路。避免无关重构，确保每一步都有可复现的验证命令。

**Tech Stack:** TypeScript、Next.js、Vitest、ESLint、BullMQ、Prisma

---

### Task 1: 修复测试语法错误

**Files:**
- Modify: `tests/unit/worker/story-to-script-orchestrator.retry.test.ts`
- Test: `tests/unit/worker/story-to-script-orchestrator.retry.test.ts`

**Step 1: 运行目标文件确认解析失败**

Run: `npm exec vitest run tests/unit/worker/story-to-script-orchestrator.retry.test.ts`

**Step 2: 修复错误引号**

- 将错误的双单引号改为合法字符串字面量。

**Step 3: 重新运行目标文件**

Run: `npm exec vitest run tests/unit/worker/story-to-script-orchestrator.retry.test.ts`

### Task 2: 补齐 prompt catalog 变量声明

**Files:**
- Modify: `src/lib/prompt-i18n/catalog.ts`
- Test: `tests/unit/helpers/prompt-i18n-catalog-contract.test.ts`

**Step 1: 运行 prompt 合约测试确认失败**

Run: `npm exec vitest run tests/unit/helpers/prompt-i18n-catalog-contract.test.ts`

**Step 2: 为两个 detail prompt 补齐 `characters_profile_summary`**

**Step 3: 重新运行 prompt 合约测试**

Run: `npm exec vitest run tests/unit/helpers/prompt-i18n-catalog-contract.test.ts`

### Task 3: 修复 video worker 角色外貌匹配

**Files:**
- Modify: `src/lib/workers/video.worker.ts`
- Test: `tests/unit/worker/video-worker.test.ts`

**Step 1: 运行 video worker 相关测试确认失败**

Run: `npm exec vitest run tests/unit/worker/video-worker.test.ts`

**Step 2: 修复 panel 角色与 aliases 解析逻辑**

- 读取 panel 角色的 `appearance`
- 正确解析 `aliases`
- 优先按 `appearance.changeReason` 选择外貌

**Step 3: 重新运行 video worker 相关测试**

Run: `npm exec vitest run tests/unit/worker/video-worker.test.ts`

### Task 4: 总体验证

**Files:**
- Verify only

**Step 1: 运行 lint**

Run: `npm run lint`

**Step 2: 运行全部单元测试**

Run: `npm run test:unit:all`
