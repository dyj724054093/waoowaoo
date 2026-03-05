export type ImageEditPromptScope = 'character' | 'location' | 'storyboard'

const WATERMARK_GUARD = '最终画面不得出现任何文字、水印、logo、签名、二维码、边框或UI元素。'

const BASE_PROMPTS: Record<ImageEditPromptScope, string> = {
  character: '请基于参考图进行高保真重绘，保持人物身份一致：五官、发型、体型、年龄感、服装主元素与构图关系保持稳定。',
  location: '请基于参考图进行高保真重绘，保持场景主体结构、透视关系与整体风格一致。',
  storyboard: '请基于参考图进行高保真重绘，保持镜头主体、构图与叙事意图一致。',
}

export function buildImageEditPrompt(
  scope: ImageEditPromptScope,
  userInstruction: string | undefined | null,
): string {
  const cleaned = typeof userInstruction === 'string' ? userInstruction.trim() : ''
  if (cleaned.length > 0) {
    return BASE_PROMPTS[scope] + '\n额外修改要求：' + cleaned + '\n' + WATERMARK_GUARD
  }
  return BASE_PROMPTS[scope] + '\n未提供额外修改要求，请仅做高保真重绘与细节优化。\n' + WATERMARK_GUARD
}
