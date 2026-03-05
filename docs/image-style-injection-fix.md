# 图片生成风格注入修复

## 问题

项目设置了艺术风格（如"漫画风"），但生成的角色图片和场景图片没有体现风格。

### 根因

1. **风格 prompt 位置错误**：风格描述放在 prompt 末尾，被 150+ 字的空间/外貌描述淹没。图片模型对 prompt 开头的权重远高于末尾。
2. **`american-comic` 风格描述过于简陋**：仅 5 个字"日式动漫风格"，其他 3 种风格都有 20-40 字的具体视觉指导。

### 修复前 prompt 结构

```
「检疫站大厅」广角远景视角完整呈现废弃大厅......（150字空间描写），日式动漫风格
                                                                      ↑ 弱信号，容易被忽略
```

### 修复后 prompt 结构

```
日式动漫风格，明快鲜艳的色彩，清晰轮廓线条，平面化光影，高饱和度配色，干净利落的2D画面，「检疫站大厅」广角远景视角......
↑ 强信号，图片模型首先感知风格
```

---

## 改动内容

### 1. 风格 prompt 前置（5 处）

所有图片生成入口的 prompt 构造从 `${content}，${artStyle}` 改为 `${artStyle}，${content}`。

| 文件 | 影响范围 |
|---|---|
| `src/lib/workers/handlers/location-image-task-handler.ts:125` | 场景图片生成 |
| `src/lib/workers/handlers/character-image-task-handler.ts:136` | 角色图片生成 |
| `src/lib/workers/handlers/asset-hub-image-task-handler.ts:91` | 资产库角色图片 |
| `src/lib/workers/handlers/asset-hub-image-task-handler.ts:136` | 资产库场景图片 |
| `src/lib/workers/handlers/reference-to-character.ts:201` | 参考图转角色 |

### 2. `american-comic` 风格描述增强

`src/lib/constants.ts` 中 `ART_STYLES[0]` 的 `promptZh`/`promptEn`：

| 字段 | 修复前 | 修复后 |
|---|---|---|
| promptZh | `日式动漫风格` | `日式动漫风格，明快鲜艳的色彩，清晰轮廓线条，平面化光影，高饱和度配色，干净利落的2D画面` |
| promptEn | `Japanese anime style` | `Japanese anime style, vibrant colors, clean outlines, flat shading, high saturation, crisp 2D visual` |

---

## 风格系统架构参考

### ART_STYLES 常量（`src/lib/constants.ts`）

| value | label | promptZh 概要 |
|---|---|---|
| `american-comic` | 漫画风 | 日式动漫 + 明快色彩 + 清晰线条 + 平面光影 |
| `chinese-comic` | 精致国漫 | 现代高质量漫画 + 细节精致 + 线条锐利 + 2D |
| `japanese-anime` | 日系动漫风 | 赛璐璐上色 + 干净线条 + 视觉小说CG感 |
| `realistic` | 真人风格 | 电影级质感 + 真实场景 + 色彩饱满 |

### 风格注入链路

```
用户选择风格 → project.artStyle（DB）
     ↓
getProjectModels() → models.artStyle
     ↓
getArtStylePrompt(artStyle, locale) → promptZh/promptEn 字符串
     ↓
图片 handler 构造 prompt：`${artStyle}，${content}`
     ↓
generateImage() → 图片模型
```

### 使用 getArtStylePrompt 的位置

- `location-image-task-handler.ts` — 场景图
- `character-image-task-handler.ts` — 角色图
- `asset-hub-image-task-handler.ts` — 资产库（角色 + 场景）
- `reference-to-character.ts` — 参考图转角色
- `image-task-handlers.ts` — 面板图（storyboard panel）

---

## 后续优化方向（P1）

如果 P0 修复后风格遵循度仍不够理想，可考虑：

- **场景描述生成阶段注入风格**：在 `select_location.zh.txt` / `location_create.zh.txt` 模板中传入项目风格，让 AI 在生成空间描述时就适配风格（如漫画风下用简洁线条化描述，而非写实词汇）
- **风格 prompt 分场景特化**：场景图和角色图可以用不同的风格描述词（场景侧重环境光影，角色侧重线条和上色方式）
