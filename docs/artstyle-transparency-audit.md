# artStyle 透明性审计报告

## 问题概述

用户在前端切换艺术风格后，部分图片生成路径未感知风格变化，导致：
1. 生成的图片不体现所选风格
2. 切换风格后命中旧缓存，任务被去重跳过

> 注：prompt 中风格文本的位置问题（前置 vs 后置）已在 `image-style-injection-fix.md` 中修复。
> 本文档聚焦 artStyle 参数在 API 路由层的传递断链和 dedupeKey 缓存中毒问题。

## artStyle 数据流全景

```
用户选择风格
    |
    v
[项目级] NovelPromotionProject.artStyle (DB)
    |
    +---> getProjectModelConfig() ---> models.artStyle
    |         |
    |         v
    |     character-image-task-handler.ts  (OK - 正确读取)
    |     location-image-task-handler.ts   (OK - 正确读取)
    |
[全局级] Asset Hub（无 project 上下文）
    |
    +---> ai-design-character/route.ts  (BROKEN - 未传 artStyle)
    +---> ai-design-location/route.ts   (BROKEN - 未传 artStyle)
    +---> asset-hub-image-task-handler.ts  (OK - 支持读 payload.artStyle，但上游没传)
```

## 断点详析

### 断点 1：Asset Hub API 路由未传 artStyle（P0）

**文件**：
- `src/app/api/asset-hub/ai-design-character/route.ts`
- `src/app/api/asset-hub/ai-design-location/route.ts`

**现状**：
```typescript
// payload 只有这些字段，缺 artStyle
const payload = {
    userInstruction,
    analysisModel: userConfig.analysisModel,
    displayMode: 'detail' as const
}
```

**下游 handler 其实支持**：
```typescript
// asset-hub-image-task-handler.ts 已经在读 payload.artStyle
const artStyle = getArtStylePrompt(
    typeof payload.artStyle === 'string' ? payload.artStyle : undefined,
    job.data.locale,
)
```

**修复**：从 request body 接收 artStyle，加入 payload。

### 断点 2：dedupeKey 不含 artStyle（P0 - 缓存中毒）

**文件与现状**：

| 文件 | 当前 dedupeKey | 问题 |
|------|---------------|------|
| `ai-design-character/route.ts` | `sha1(userId:character:userInstruction)` | 同一指令换风格 = 同一个 key，任务被去重 |
| `ai-design-location/route.ts` | `sha1(userId:location:userInstruction)` | 同上 |
| `novel-promotion/.../generate-image/route.ts` | `${taskType}:${targetId}` | 同一角色/场景换风格 = 同一个 key |

**后果**：用户在「漫画风」下生成角色图 -> 切换到「真人风格」再次生成 -> 命中旧 dedupeKey -> 任务被跳过 -> 永远显示漫画风图片。

**修复**：所有 dedupeKey 加入 artStyle 维度：
```
asset_hub: sha1(userId:type:userInstruction:artStyle)
novel-promotion: ${taskType}:${targetId}:${artStyle || 'default'}
```

### 断点 3：ART_STYLES 硬编码冗余（P1 - 维护炸弹）

**文件**：`src/app/api/novel-promotion/[projectId]/generate-character-image/route.ts` 第 62-67 行

**现状**：本地硬编码了 4 项 ART_STYLES：
```typescript
const ART_STYLES = [
    { value: 'american-comic', prompt: '美式漫画风格' },
    { value: 'chinese-comic', prompt: '精致国漫风格' },
    { value: 'anime', prompt: '日系动漫风格' },
    { value: 'realistic', prompt: '真人照片写实风格' }
]
```

**问题**：`constants.ts` 中的 ART_STYLES 有完整的中英文 prompt（含详细视觉描述），这里只有简短版本。两处不同步 = 风格映射错误。

**修复**：删除本地数组，改为 `import { getArtStylePrompt } from '@/lib/constants'`。

### 断点 4：artStyle 与 artStylePrompt 不同步（P1）

**文件**：`src/app/api/novel-promotion/[projectId]/generate-character-image/route.ts`

**现状**：接收到 artStyle 后只更新 `artStylePrompt`，不更新 `artStyle` 字段：
```typescript
if (artStyle) {
    // ...
    await prisma.novelPromotionProject.update({
        where: { id: novelData.id },
        data: { artStylePrompt: style.prompt }  // 只更新了 prompt，没更新 artStyle
    })
}
```

**问题**：`NovelPromotionProject` 有两个字段：
- `artStyle: string` - 风格标识符（如 'realistic'）
- `artStylePrompt: string | null` - 风格 prompt 文本

只更新其中一个会导致两字段不一致，后续 `getProjectModelConfig` 读 `artStyle` 拿到的还是旧值。

**修复**：同时更新两个字段。

## 修复方案

### P0：必须立即修（影响用户可见功能）

| 改动 | 文件 | 内容 |
|------|------|------|
| 1 | ai-design-character/route.ts | body 解析 artStyle，加入 payload 和 dedupeKey |
| 2 | ai-design-location/route.ts | 同上 |
| 3 | generate-image/route.ts | dedupeKey 加入 artStyle 维度 |

### P1：本轮一起做（防止维护事故）

| 改动 | 文件 | 内容 |
|------|------|------|
| 4 | generate-character-image/route.ts | 删除本地 ART_STYLES，import from constants |
| 5 | generate-character-image/route.ts | artStyle + artStylePrompt 同步更新 |

## 涉及文件清单

| 文件路径 | 问题 | 优先级 |
|----------|------|--------|
| `src/app/api/asset-hub/ai-design-character/route.ts` | payload/dedupeKey 缺 artStyle | P0 |
| `src/app/api/asset-hub/ai-design-location/route.ts` | payload/dedupeKey 缺 artStyle | P0 |
| `src/app/api/novel-promotion/[projectId]/generate-image/route.ts` | dedupeKey 缺 artStyle | P0 |
| `src/app/api/novel-promotion/[projectId]/generate-character-image/route.ts` | 硬编码 ART_STYLES + 字段不同步 | P1 |
| `src/lib/workers/handlers/asset-hub-image-task-handler.ts` | 无需改（已支持 payload.artStyle） | - |
| `src/lib/workers/handlers/character-image-task-handler.ts` | 无需改（通过 getProjectModels 正确获取） | - |
| `src/lib/workers/handlers/location-image-task-handler.ts` | 无需改（同上） | - |
| `src/lib/constants.ts` | 无需改（ART_STYLES 定义完整） | - |
| `src/lib/config-service.ts` | 无需改（getProjectModelConfig 已返回 artStyle） | - |
