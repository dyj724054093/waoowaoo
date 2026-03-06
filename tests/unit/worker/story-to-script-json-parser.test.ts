import { describe, expect, it, vi } from 'vitest'
import { runStoryToScriptOrchestrator } from '@/lib/novel-promotion/story-to-script/orchestrator'

describe('story-to-script json parser resilience', () => {
  it('handles split_clips response with trailing second JSON object', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'analyze_characters') {
        return { text: JSON.stringify({ characters: [{ name: '主角', introduction: '叙述者' }] }), reasoning: '' }
      }
      if (action === 'analyze_locations') {
        return { text: JSON.stringify({ locations: [{ name: '防疫站' }] }), reasoning: '' }
      }
      if (action === 'split_clips') {
        return {
          text: '{"clips":[{"start":"主角走进防疫站","end":"他看见月亮","summary":"夜间进入","location":"防疫站","characters":["主角"]}]}{"trace":[1,2]}',
          reasoning: '',
        }
      }
      return {
        text: JSON.stringify({ scenes: [{ id: 1, visual: '夜景', dialogue: '继续前进' }] }),
        reasoning: '',
      }
    })

    const result = await runStoryToScriptOrchestrator({
      content: '主角走进防疫站，四周很安静。过了一会儿，他看见月亮。',
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '{input}',
        locationPromptTemplate: '{input}',
        clipPromptTemplate: '{input}',
        screenplayPromptTemplate: '{clip_content}',
      },
      runStep,
    })

    expect(result.summary.clipCount).toBe(1)
    expect(result.clipList[0]?.startText).toBe('主角走进防疫站')
    expect(result.clipList[0]?.endText).toBe('他看见月亮')
  })
})