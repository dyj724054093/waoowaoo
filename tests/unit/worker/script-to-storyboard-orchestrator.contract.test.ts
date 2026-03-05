import { describe, expect, it, vi } from 'vitest'
import { runScriptToStoryboardOrchestrator } from '@/lib/novel-promotion/script-to-storyboard/orchestrator'

const promptTemplates = {
  phase1PlanTemplate: '{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}',
  phase2CinematographyTemplate: '{panels_json} {panel_count} {locations_description} {characters_info}',
  phase2ActingTemplate: '{panels_json} {panel_count} {characters_info}',
  phase3DetailTemplate: '{panels_json} {characters_age_gender} {characters_profile_summary} {locations_description}',
}

describe('script-to-storyboard orchestrator contract', () => {
  it('rejects phase3 panels when source_text is missing', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              description: 'panel one',
              location: 'Street',
              source_text: 'source text',
              characters: [{ name: 'Hero' }],
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              composition: 'center',
              lighting: 'low key',
              color_palette: 'cool',
              atmosphere: 'tense',
              technical_notes: 'static',
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              characters: [{ name: 'Hero', acting: 'stares ahead' }],
            },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          {
            panel_number: 1,
            description: 'refined panel one',
            location: 'Street',
            characters: [{ name: 'Hero', appearance: 'default' }],
            shot_type: 'medium shot',
            camera_move: 'static',
            video_prompt: 'hero looks around',
          },
        ]),
        reasoning: '',
      }
    })

    await expect(
      runScriptToStoryboardOrchestrator({
        clips: [
          {
            id: 'clip-1',
            content: 'Hero enters street.',
            characters: JSON.stringify([{ name: 'Hero' }]),
            location: 'Street',
            screenplay: null,
          },
        ],
        novelPromotionData: {
          characters: [{ name: 'Hero', appearances: [] }],
          locations: [{ name: 'Street', images: [] }],
        },
        promptTemplates,
        runStep,
      }),
    ).rejects.toThrow()
  })

  it('accepts phase3 panels when source_text is present', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              description: 'panel one',
              location: 'Street',
              source_text: 'source text',
              characters: [{ name: 'Hero' }],
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              composition: 'center',
              lighting: 'low key',
              color_palette: 'cool',
              atmosphere: 'tense',
              technical_notes: 'static',
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              characters: [{ name: 'Hero', acting: 'stares ahead' }],
            },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          {
            panel_number: 1,
            description: 'refined panel one',
            location: 'Street',
            source_text: 'source text',
            characters: [{ name: 'Hero', appearance: 'default' }],
            shot_type: 'medium shot',
            camera_move: 'static',
            video_prompt: 'hero looks around',
          },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Hero enters street.',
          characters: JSON.stringify([{ name: 'Hero' }]),
          location: 'Street',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Hero', appearances: [] }],
        locations: [{ name: 'Street', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.clipCount).toBe(1)
    expect(result.summary.totalPanelCount).toBe(1)
    expect(result.clipPanels[0]?.finalPanels[0]?.source_text).toBe('source text')
  })

  it('accepts phase3 payload when bracketed notes appear before JSON array', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              description: 'panel one',
              location: 'Street',
              source_text: 'source text',
              characters: [{ name: 'Hero' }],
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              composition: 'center',
              lighting: 'low key',
              color_palette: 'cool',
              atmosphere: 'tense',
              technical_notes: 'static',
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              characters: [{ name: 'Hero', acting: 'stares ahead' }],
            },
          ]),
          reasoning: '',
        }
      }

      return {
        text: `[关键道具] detail note\n${JSON.stringify([
          {
            panel_number: 1,
            description: 'refined panel one',
            location: 'Street',
            source_text: 'source text',
            characters: [{ name: 'Hero', appearance: 'default' }],
            shot_type: 'medium shot',
            camera_move: 'static',
            video_prompt: 'hero looks around',
          },
        ])}`,
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Hero enters street.',
          characters: JSON.stringify([{ name: 'Hero' }]),
          location: 'Street',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Hero', appearances: [] }],
        locations: [{ name: 'Street', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.clipCount).toBe(1)
    expect(result.summary.totalPanelCount).toBe(1)
    expect(result.clipPanels[0]?.finalPanels[0]?.source_text).toBe('source text')
  })

  it('dedupes adjacent repetitive panels while keeping core narrative beats', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              description: 'Night ruins establish shot with collapsed overpass.',
              location: 'Dock Quarantine Station',
              source_text: 'Night ruins and station overview.',
              characters: [{ name: 'LinYu' }],
            },
            {
              panel_number: 2,
              description: 'LinYu hides in shadow and observes station entrance.',
              location: 'Dock Quarantine Station',
              source_text: 'LinYu hides in shadow and observes station entrance.',
              characters: [{ name: 'LinYu' }],
            },
            {
              panel_number: 3,
              description: 'Irregular patrol footsteps approach from west fence.',
              location: 'Dock Quarantine Station',
              source_text: 'He hears irregular patrol footsteps and receives radio warning.',
              characters: [{ name: 'LinYu' }],
            },
            {
              panel_number: 4,
              description: 'LinYu reacts to the same irregular patrol footsteps.',
              location: 'Dock Quarantine Station',
              source_text: 'He hears irregular patrol footsteps and receives radio warning.',
              characters: [{ name: 'LinYu' }],
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'wide', lighting: 'low key', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'slow pan' },
            { panel_number: 2, composition: 'medium', lighting: 'moonlight', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'slow push' },
            { panel_number: 3, composition: 'medium', lighting: 'moonlight', color_palette: 'cold', atmosphere: 'suspense', technical_notes: 'handheld' },
            { panel_number: 4, composition: 'medium', lighting: 'moonlight', color_palette: 'cold', atmosphere: 'suspense', technical_notes: 'handheld' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'LinYu', acting: 'observes from shadow' }] },
            { panel_number: 2, characters: [{ name: 'LinYu', acting: 'hides and watches' }] },
            { panel_number: 3, characters: [{ name: 'LinYu', acting: 'turns to listen' }] },
            { panel_number: 4, characters: [{ name: 'LinYu', acting: 'freezes and listens' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          {
            panel_number: 1,
            description: 'Night ruins establish shot with overpass skeleton and quarantine station in distance.',
            location: 'Dock Quarantine Station',
            source_text: 'Night ruins and station overview.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'wide',
            camera_move: 'slow pan',
            video_prompt: 'ruins overview',
          },
          {
            panel_number: 2,
            description: 'LinYu crouches in overpass shadow watching the station gate thirty meters away.',
            location: 'Dock Quarantine Station',
            source_text: 'LinYu hides in shadow and observes station entrance.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'medium',
            camera_move: 'slow push',
            video_prompt: 'hide and observe',
          },
          {
            panel_number: 3,
            description: 'He turns to listen to the irregular three-beat patrol rhythm from west fence.',
            location: 'Dock Quarantine Station',
            source_text: 'He hears irregular patrol footsteps and receives radio warning.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'medium',
            camera_move: 'handheld',
            video_prompt: 'listening reaction',
          },
          {
            panel_number: 4,
            description: 'He freezes and listens to the same irregular patrol rhythm from west fence.',
            location: 'Dock Quarantine Station',
            source_text: 'He hears irregular patrol footsteps and receives radio warning.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'medium',
            camera_move: 'handheld',
            video_prompt: 'same beat repeated',
          },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Night ruins and station overview. LinYu hides in shadow and observes station entrance. He hears irregular patrol footsteps and receives radio warning.',
          characters: JSON.stringify([{ name: 'LinYu' }]),
          location: 'Dock Quarantine Station',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'LinYu', appearances: [] }],
        locations: [{ name: 'Dock Quarantine Station', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    const panelNumbers = result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)
    expect(result.summary.totalPanelCount).toBe(3)
    expect(panelNumbers).toEqual([1, 2, 3])
  })

  it('merges objective and subjective duplicates from the same beat', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              description: 'LinYu crouches behind debris and watches the checkpoint gate.',
              location: 'Dock Quarantine Station',
              source_text: 'LinYu crouches behind debris and watches the checkpoint gate.',
              characters: [{ name: 'LinYu' }],
            },
            {
              panel_number: 2,
              description: 'Same beat from a subjective angle toward the gate.',
              location: 'Dock Quarantine Station',
              source_text: 'LinYu crouches behind debris and watches the checkpoint gate.',
              characters: [{ name: 'LinYu' }],
            },
            {
              panel_number: 3,
              description: 'He hears patrol footsteps and turns his head to listen.',
              location: 'Dock Quarantine Station',
              source_text: 'He hears patrol footsteps and turns his head to listen.',
              characters: [{ name: 'LinYu' }],
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'medium', lighting: 'low key', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'slow push' },
            { panel_number: 2, composition: 'medium', lighting: 'low key', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'handheld' },
            { panel_number: 3, composition: 'close', lighting: 'moonlight', color_palette: 'cold', atmosphere: 'suspense', technical_notes: 'micro shake' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'LinYu', acting: 'crouches and watches' }] },
            { panel_number: 2, characters: [{ name: 'LinYu', acting: 'keeps watching' }] },
            { panel_number: 3, characters: [{ name: 'LinYu', acting: 'turns to listen' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          {
            panel_number: 1,
            description: 'LinYu crouches behind debris, staring at the checkpoint gate thirty meters away.',
            location: 'Dock Quarantine Station',
            source_text: 'LinYu crouches behind debris and watches the checkpoint gate.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'medium shot',
            camera_move: 'slow push',
            video_prompt: 'objective view of LinYu watching gate',
          },
          {
            panel_number: 2,
            description: 'Subjective view of the same gate from LinYu position with no new event.',
            location: 'Dock Quarantine Station',
            source_text: 'LinYu crouches behind debris and watches the checkpoint gate.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'subjective medium shot',
            camera_move: 'handheld',
            video_prompt: 'pov to the same gate',
          },
          {
            panel_number: 3,
            description: 'LinYu hears irregular footsteps and turns to listen in the dark.',
            location: 'Dock Quarantine Station',
            source_text: 'He hears patrol footsteps and turns his head to listen.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'close shot',
            camera_move: 'micro shake',
            video_prompt: 'reaction close-up',
          },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'LinYu crouches behind debris and watches the checkpoint gate. He hears patrol footsteps and turns his head to listen.',
          characters: JSON.stringify([{ name: 'LinYu' }]),
          location: 'Dock Quarantine Station',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'LinYu', appearances: [] }],
        locations: [{ name: 'Dock Quarantine Station', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    const panelNumbers = result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)
    expect(result.summary.totalPanelCount).toBe(2)
    expect(panelNumbers).toEqual([1, 3])
  })




  it('collapses stylized camera variants when source beat is the same', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              description: 'LinYu observes the checkpoint gate from debris cover.',
              location: 'Dock Quarantine Station',
              source_text: 'LinYu observes the checkpoint gate from debris cover.',
              characters: [{ name: 'LinYu' }],
            },
            {
              panel_number: 2,
              description: 'Same beat from a distorted stylized perspective.',
              location: 'Dock Quarantine Station',
              source_text: 'LinYu observes the checkpoint gate from debris cover.',
              characters: [{ name: 'LinYu' }],
            },
            {
              panel_number: 3,
              description: 'Footsteps approach from west fence and LinYu reacts.',
              location: 'Dock Quarantine Station',
              source_text: 'Footsteps approach from west fence and LinYu reacts.',
              characters: [{ name: 'LinYu' }],
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'medium', lighting: 'low key', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 2, composition: 'close', lighting: 'low key', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'handheld' },
            { panel_number: 3, composition: 'close', lighting: 'moonlight', color_palette: 'cold', atmosphere: 'suspense', technical_notes: 'micro shake' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'LinYu', acting: 'observes in silence' }] },
            { panel_number: 2, characters: [{ name: 'LinYu', acting: 'keeps observing' }] },
            { panel_number: 3, characters: [{ name: 'LinYu', acting: 'turns to listen' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          {
            panel_number: 1,
            description: 'LinYu keeps low and watches the checkpoint gate through debris gaps.',
            location: 'Dock Quarantine Station',
            source_text: 'LinYu observes the checkpoint gate from debris cover.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'medium shot',
            camera_move: 'static',
            video_prompt: 'objective gate watch',
          },
          {
            panel_number: 2,
            description: 'A dutch-angle subjective blur frames the exact same gate watch beat.',
            location: 'Dock Quarantine Station',
            source_text: 'LinYu observes the checkpoint gate from debris cover.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'dutch subjective close shot',
            camera_move: 'handheld',
            video_prompt: 'stylized duplicate beat',
          },
          {
            panel_number: 3,
            description: 'Irregular footsteps from west fence make LinYu turn sharply to listen.',
            location: 'Dock Quarantine Station',
            source_text: 'Footsteps approach from west fence and LinYu reacts.',
            characters: [{ name: 'LinYu', appearance: 'default' }],
            shot_type: 'close shot',
            camera_move: 'micro shake',
            video_prompt: 'new beat reaction',
          },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'LinYu observes the checkpoint gate from debris cover. Footsteps approach from west fence and LinYu reacts.',
          characters: JSON.stringify([{ name: 'LinYu' }]),
          location: 'Dock Quarantine Station',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'LinYu', appearances: [] }],
        locations: [{ name: 'Dock Quarantine Station', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    const panelNumbers = result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)
    expect(result.summary.totalPanelCount).toBe(2)
    expect(panelNumbers).toEqual([1, 3])
  })

  it('injects planning and shot-rhythm guardrails into prompts', async () => {
    const promptByAction: Record<string, string> = {}
    const runStep = vi.fn(async (_meta, prompt, action: string) => {
      promptByAction[action] = String(prompt)
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              description: 'Hero walks through corridor.',
              location: 'Corridor',
              source_text: 'Hero walks through corridor.',
              characters: [{ name: 'Hero' }],
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              composition: 'medium',
              lighting: 'low key',
              color_palette: 'cool',
              atmosphere: 'tense',
              technical_notes: 'slow push',
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              characters: [{ name: 'Hero', acting: 'walks forward' }],
            },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          {
            panel_number: 1,
            description: 'Hero walks through corridor with cautious pace.',
            location: 'Corridor',
            source_text: 'Hero walks through corridor.',
            characters: [{ name: 'Hero', appearance: 'default' }],
            shot_type: 'medium shot',
            camera_move: 'slow push',
            video_prompt: 'hero walks in corridor',
          },
        ]),
        reasoning: '',
      }
    })

    const screenplay = JSON.stringify({
      scenes: [
        {
          heading: 'INT. CORRIDOR - NIGHT',
          content: [{ type: 'action', text: 'Hero walks through corridor.' }],
        },
      ],
    })

    await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'fallback text',
          characters: JSON.stringify([{ name: 'Hero' }]),
          location: 'Corridor',
          screenplay,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Hero', appearances: [] }],
        locations: [{ name: 'Corridor', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(promptByAction.storyboard_phase1_plan).toContain('[Global Storyboard Planning Guardrails]')
    expect(promptByAction.storyboard_phase1_plan).toContain('Ignore fixed character-count heuristics')
    expect(promptByAction.storyboard_phase1_plan).toContain('Follow continuity coverage order when possible')
    expect(promptByAction.storyboard_phase1_plan).toContain('[SCREENPLAY_FORMAT]')
    expect(promptByAction.storyboard_phase3_detail).toContain('[Global Shot Rhythm Guardrails]')
    expect(promptByAction.storyboard_phase3_detail).toContain('Dutch angle / POV are accents')
    expect(promptByAction.storyboard_phase3_detail).toContain('30-degree or shot-size differences')
    expect(promptByAction.storyboard_phase3_detail).toContain('re-establishing shots only when geography becomes unclear')
  })

  it('limits oversized panel outputs for short clips', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: 'beat1', location: 'Dock', source_text: 'a', characters: [{ name: 'LinYu' }] },
            { panel_number: 2, description: 'beat2', location: 'Dock', source_text: 'b', characters: [{ name: 'LinYu' }] },
            { panel_number: 3, description: 'beat3', location: 'Dock', source_text: 'c', characters: [{ name: 'LinYu' }] },
            { panel_number: 4, description: 'beat4', location: 'Dock', source_text: 'd', characters: [{ name: 'LinYu' }] },
            { panel_number: 5, description: 'beat5', location: 'Dock', source_text: 'e', characters: [{ name: 'LinYu' }] },
            { panel_number: 6, description: 'beat6', location: 'Dock', source_text: 'f', characters: [{ name: 'LinYu' }] },
            { panel_number: 7, description: 'beat7', location: 'Dock', source_text: 'g', characters: [{ name: 'LinYu' }] },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'wide', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 2, composition: 'wide', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 3, composition: 'wide', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 4, composition: 'wide', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 5, composition: 'wide', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 6, composition: 'wide', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 7, composition: 'wide', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'LinYu', acting: 'beat1' }] },
            { panel_number: 2, characters: [{ name: 'LinYu', acting: 'beat2' }] },
            { panel_number: 3, characters: [{ name: 'LinYu', acting: 'beat3' }] },
            { panel_number: 4, characters: [{ name: 'LinYu', acting: 'beat4' }] },
            { panel_number: 5, characters: [{ name: 'LinYu', acting: 'beat5' }] },
            { panel_number: 6, characters: [{ name: 'LinYu', acting: 'beat6' }] },
            { panel_number: 7, characters: [{ name: 'LinYu', acting: 'beat7' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          { panel_number: 1, description: 'beat1', location: 'Dock', source_text: 'a', characters: [{ name: 'LinYu', appearance: 'default' }], shot_type: 'wide', camera_move: 'static', video_prompt: 'beat1' },
          { panel_number: 2, description: 'beat2', location: 'Dock', source_text: 'b', characters: [{ name: 'LinYu', appearance: 'default' }], shot_type: 'wide', camera_move: 'static', video_prompt: 'beat2' },
          { panel_number: 3, description: 'beat3', location: 'Dock', source_text: 'c', characters: [{ name: 'LinYu', appearance: 'default' }], shot_type: 'wide', camera_move: 'static', video_prompt: 'beat3' },
          { panel_number: 4, description: 'beat4', location: 'Dock', source_text: 'd', characters: [{ name: 'LinYu', appearance: 'default' }], shot_type: 'wide', camera_move: 'static', video_prompt: 'beat4' },
          { panel_number: 5, description: 'beat5', location: 'Dock', source_text: 'e', characters: [{ name: 'LinYu', appearance: 'default' }], shot_type: 'wide', camera_move: 'static', video_prompt: 'beat5' },
          { panel_number: 6, description: 'beat6', location: 'Dock', source_text: 'f', characters: [{ name: 'LinYu', appearance: 'default' }], shot_type: 'wide', camera_move: 'static', video_prompt: 'beat6' },
          { panel_number: 7, description: 'beat7', location: 'Dock', source_text: 'g', characters: [{ name: 'LinYu', appearance: 'default' }], shot_type: 'wide', camera_move: 'static', video_prompt: 'beat7' },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'A. B.',
          characters: JSON.stringify([{ name: 'LinYu' }]),
          location: 'Dock',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'LinYu', appearances: [] }],
        locations: [{ name: 'Dock', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    const panelNumbers = result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)
    expect(result.summary.totalPanelCount).toBe(2)
    expect(panelNumbers).toEqual([1, 7])
  })

  it('does not dedupe near-identical beats across different locations', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            {
              panel_number: 1,
              description: 'Hero checks west gate.',
              location: 'West Gate',
              source_text: 'Hero checks the gate.',
              characters: [{ name: 'Hero' }],
            },
            {
              panel_number: 2,
              description: 'Hero checks west gate again from another side.',
              location: 'Inner Hall',
              source_text: 'Hero checks the gate.',
              characters: [{ name: 'Hero' }],
            },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'medium', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 2, composition: 'medium', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'Hero', acting: 'observes west gate' }] },
            { panel_number: 2, characters: [{ name: 'Hero', acting: 'observes inner hall gate' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          {
            panel_number: 1,
            description: 'Hero checks west gate in darkness.',
            location: 'West Gate',
            source_text: 'Hero checks the gate.',
            characters: [{ name: 'Hero', appearance: 'default' }],
            shot_type: 'medium shot',
            camera_move: 'static',
            video_prompt: 'west gate',
          },
          {
            panel_number: 2,
            description: 'Hero checks gate from inner hall side.',
            location: 'Inner Hall',
            source_text: 'Hero checks the gate.',
            characters: [{ name: 'Hero', appearance: 'default' }],
            shot_type: 'medium shot',
            camera_move: 'static',
            video_prompt: 'inner hall gate',
          },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Hero checks the gate.',
          characters: JSON.stringify([{ name: 'Hero' }]),
          location: 'West Gate',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Hero', appearances: [] }],
        locations: [{ name: 'West Gate', images: [] }, { name: 'Inner Hall', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.totalPanelCount).toBe(2)
    expect(result.clipPanels[0]?.finalPanels.map((panel) => panel.location)).toEqual(['West Gate', 'Inner Hall'])
  })


  it('keeps three narrative beats for medium clips with local repetition', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: 'beat A establish', location: 'Archive Hall', source_text: 'A', characters: [{ name: 'Ming' }] },
            { panel_number: 2, description: 'beat A establish alt', location: 'Archive Hall', source_text: 'A', characters: [{ name: 'Ming' }] },
            { panel_number: 3, description: 'beat B dialogue start', location: 'Archive Hall', source_text: 'B', characters: [{ name: 'Ming' }] },
            { panel_number: 4, description: 'beat B dialogue start alt', location: 'Archive Hall', source_text: 'B', characters: [{ name: 'Ming' }] },
            { panel_number: 5, description: 'beat C reaction', location: 'Archive Hall', source_text: 'C', characters: [{ name: 'Ming' }] },
            { panel_number: 6, description: 'beat C reaction alt', location: 'Archive Hall', source_text: 'C', characters: [{ name: 'Ming' }] },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'wide', lighting: 'dim', color_palette: 'cold', atmosphere: 'still', technical_notes: 'static' },
            { panel_number: 2, composition: 'wide', lighting: 'dim', color_palette: 'cold', atmosphere: 'still', technical_notes: 'slow pan' },
            { panel_number: 3, composition: 'medium', lighting: 'dim', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 4, composition: 'medium', lighting: 'dim', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'slow push' },
            { panel_number: 5, composition: 'close', lighting: 'dim', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'static' },
            { panel_number: 6, composition: 'close', lighting: 'dim', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'micro move' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'Ming', acting: 'enters hall' }] },
            { panel_number: 2, characters: [{ name: 'Ming', acting: 'enters hall again' }] },
            { panel_number: 3, characters: [{ name: 'Ming', acting: 'starts dialogue' }] },
            { panel_number: 4, characters: [{ name: 'Ming', acting: 'continues same line' }] },
            { panel_number: 5, characters: [{ name: 'Ming', acting: 'reacts silently' }] },
            { panel_number: 6, characters: [{ name: 'Ming', acting: 'same reaction' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          { panel_number: 1, description: 'Ming enters Archive Hall and scans old shelves.', location: 'Archive Hall', source_text: 'A', characters: [{ name: 'Ming', appearance: 'default' }], shot_type: 'wide shot', camera_move: 'static', video_prompt: 'beat A main' },
          { panel_number: 2, description: 'Ming enters Archive Hall and scans the same shelf row.', location: 'Archive Hall', source_text: 'A', characters: [{ name: 'Ming', appearance: 'default' }], shot_type: 'wide shot', camera_move: 'slow pan', video_prompt: 'beat A alt' },
          { panel_number: 3, description: 'Ming opens conversation with the guard beside him.', location: 'Archive Hall', source_text: 'B', characters: [{ name: 'Ming', appearance: 'default' }], shot_type: 'medium shot', camera_move: 'static', video_prompt: 'beat B main' },
          { panel_number: 4, description: 'Ming opens the same conversation line from another angle.', location: 'Archive Hall', source_text: 'B', characters: [{ name: 'Ming', appearance: 'default' }], shot_type: 'medium shot', camera_move: 'slow push', video_prompt: 'beat B alt' },
          { panel_number: 5, description: 'Ming pauses after hearing the key phrase and tightens his jaw.', location: 'Archive Hall', source_text: 'C', characters: [{ name: 'Ming', appearance: 'default' }], shot_type: 'close shot', camera_move: 'static', video_prompt: 'beat C main' },
          { panel_number: 6, description: 'Ming pauses after hearing the key phrase, same reaction held.', location: 'Archive Hall', source_text: 'C', characters: [{ name: 'Ming', appearance: 'default' }], shot_type: 'close shot', camera_move: 'micro move', video_prompt: 'beat C alt' },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Ming enters the archive hall. He starts talking to the guard. He reacts after hearing a key phrase.',
          characters: JSON.stringify([{ name: 'Ming' }]),
          location: 'Archive Hall',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Ming', appearances: [] }],
        locations: [{ name: 'Archive Hall', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.totalPanelCount).toBe(3)
    expect(result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)).toEqual([1, 3, 5])
  })

  it('preserves distinct dialogue-turn beats in one location', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: 'A asks a question.', location: 'Clinic Room', source_text: 'Doctor asks: where were you last night?', characters: [{ name: 'Doctor' }, { name: 'Patient' }] },
            { panel_number: 2, description: 'B answers briefly.', location: 'Clinic Room', source_text: 'Patient answers: at the checkpoint.', characters: [{ name: 'Doctor' }, { name: 'Patient' }] },
            { panel_number: 3, description: 'A follows up aggressively.', location: 'Clinic Room', source_text: 'Doctor asks again: who saw you?', characters: [{ name: 'Doctor' }, { name: 'Patient' }] },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'medium', lighting: 'cold', color_palette: 'neutral', atmosphere: 'tense', technical_notes: 'over shoulder' },
            { panel_number: 2, composition: 'medium', lighting: 'cold', color_palette: 'neutral', atmosphere: 'tense', technical_notes: 'reverse over shoulder' },
            { panel_number: 3, composition: 'close', lighting: 'cold', color_palette: 'neutral', atmosphere: 'pressure', technical_notes: 'slow push' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'Doctor', acting: 'questions' }] },
            { panel_number: 2, characters: [{ name: 'Patient', acting: 'answers softly' }] },
            { panel_number: 3, characters: [{ name: 'Doctor', acting: 'leans in' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          { panel_number: 1, description: 'Doctor asks where the patient was last night.', location: 'Clinic Room', source_text: 'Doctor asks: where were you last night?', characters: [{ name: 'Doctor', appearance: 'default' }, { name: 'Patient', appearance: 'default' }], shot_type: 'medium shot', camera_move: 'over shoulder', video_prompt: 'turn 1' },
          { panel_number: 2, description: 'Patient replies that he was at the checkpoint.', location: 'Clinic Room', source_text: 'Patient answers: at the checkpoint.', characters: [{ name: 'Doctor', appearance: 'default' }, { name: 'Patient', appearance: 'default' }], shot_type: 'medium shot', camera_move: 'reverse over shoulder', video_prompt: 'turn 2' },
          { panel_number: 3, description: 'Doctor immediately asks who can verify it.', location: 'Clinic Room', source_text: 'Doctor asks again: who saw you?', characters: [{ name: 'Doctor', appearance: 'default' }, { name: 'Patient', appearance: 'default' }], shot_type: 'close shot', camera_move: 'slow push', video_prompt: 'turn 3' },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Doctor asks first question. Patient replies. Doctor follows up.',
          characters: JSON.stringify([{ name: 'Doctor' }, { name: 'Patient' }]),
          location: 'Clinic Room',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Doctor', appearances: [] }, { name: 'Patient', appearances: [] }],
        locations: [{ name: 'Clinic Room', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.totalPanelCount).toBe(3)
    expect(result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)).toEqual([1, 2, 3])
  })


  it('palace intrigue dialogue keeps distinct turn-based beats', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: 'Empress questions the maid in the hall.', location: 'Palace Hall', source_text: 'Empress asks where the letter came from.', characters: [{ name: 'Empress' }, { name: 'Maid' }] },
            { panel_number: 2, description: 'Maid kneels and answers carefully.', location: 'Palace Hall', source_text: 'Maid says it was delivered at dawn.', characters: [{ name: 'Empress' }, { name: 'Maid' }] },
            { panel_number: 3, description: 'Prince interrupts from the side corridor.', location: 'Palace Hall', source_text: 'Prince says the seal is forged.', characters: [{ name: 'Empress' }, { name: 'Maid' }, { name: 'Prince' }] },
            { panel_number: 4, description: 'Empress turns silent, then gives order.', location: 'Palace Hall', source_text: 'Empress orders guards to lock the archive.', characters: [{ name: 'Empress' }, { name: 'Prince' }] },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'medium', lighting: 'warm low', color_palette: 'amber', atmosphere: 'pressure', technical_notes: 'over shoulder' },
            { panel_number: 2, composition: 'medium', lighting: 'warm low', color_palette: 'amber', atmosphere: 'fear', technical_notes: 'reverse over shoulder' },
            { panel_number: 3, composition: 'wide', lighting: 'warm low', color_palette: 'amber', atmosphere: 'sudden shift', technical_notes: 'slow pan' },
            { panel_number: 4, composition: 'close', lighting: 'warm low', color_palette: 'amber', atmosphere: 'authority', technical_notes: 'slow push' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'Empress', acting: 'stares down the maid' }] },
            { panel_number: 2, characters: [{ name: 'Maid', acting: 'bows and answers' }] },
            { panel_number: 3, characters: [{ name: 'Prince', acting: 'steps in abruptly' }] },
            { panel_number: 4, characters: [{ name: 'Empress', acting: 'turns and issues command' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          { panel_number: 1, description: 'Empress asks where the secret letter came from.', location: 'Palace Hall', source_text: 'Empress asks where the letter came from.', characters: [{ name: 'Empress', appearance: 'default' }, { name: 'Maid', appearance: 'default' }], shot_type: 'medium shot', camera_move: 'over shoulder', video_prompt: 'turn one question' },
          { panel_number: 2, description: 'Maid kneels and says it arrived at dawn.', location: 'Palace Hall', source_text: 'Maid says it was delivered at dawn.', characters: [{ name: 'Empress', appearance: 'default' }, { name: 'Maid', appearance: 'default' }], shot_type: 'medium shot', camera_move: 'reverse over shoulder', video_prompt: 'turn two answer' },
          { panel_number: 3, description: 'Prince enters and states the seal is forged.', location: 'Palace Hall', source_text: 'Prince says the seal is forged.', characters: [{ name: 'Prince', appearance: 'default' }, { name: 'Empress', appearance: 'default' }], shot_type: 'wide shot', camera_move: 'slow pan', video_prompt: 'turn three interruption' },
          { panel_number: 4, description: 'Empress orders guards to lock the archive.', location: 'Palace Hall', source_text: 'Empress orders guards to lock the archive.', characters: [{ name: 'Empress', appearance: 'default' }], shot_type: 'close shot', camera_move: 'slow push', video_prompt: 'turn four order' },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Night court opens. Empress questions maid about letter origin. Maid answers it arrived at dawn. Prince steps from corridor and says seal is forged. Hall falls silent. Empress confirms guard roster. She orders archive lockdown. Guards move immediately.',
          characters: JSON.stringify([{ name: 'Empress' }, { name: 'Maid' }, { name: 'Prince' }]),
          location: 'Palace Hall',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Empress', appearances: [] }, { name: 'Maid', appearances: [] }, { name: 'Prince', appearances: [] }],
        locations: [{ name: 'Palace Hall', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.totalPanelCount).toBe(4)
    expect(result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)).toEqual([1, 2, 3, 4])
  })

  it('xianxia action keeps beats across different locations', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: 'Disciple waits outside celestial gate.', location: 'Celestial Gate Exterior', source_text: 'Disciple waits outside the celestial gate.', characters: [{ name: 'Disciple' }] },
            { panel_number: 2, description: 'He enters inner hall under warning bells.', location: 'Celestial Gate Interior', source_text: 'He enters the inner hall as bells ring.', characters: [{ name: 'Disciple' }] },
            { panel_number: 3, description: 'Sword energy erupts in the inner hall.', location: 'Celestial Gate Interior', source_text: 'Sword energy erupts near the altar.', characters: [{ name: 'Disciple' }, { name: 'Guardian' }] },
            { panel_number: 4, description: 'Guardian counters from upper platform.', location: 'Celestial Gate Interior', source_text: 'Guardian counters from upper platform.', characters: [{ name: 'Guardian' }] },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'wide', lighting: 'moonlit', color_palette: 'cold blue', atmosphere: 'ominous', technical_notes: 'slow pan' },
            { panel_number: 2, composition: 'wide', lighting: 'moonlit', color_palette: 'cold blue', atmosphere: 'ominous', technical_notes: 'push in' },
            { panel_number: 3, composition: 'medium', lighting: 'sparks', color_palette: 'blue white', atmosphere: 'burst', technical_notes: 'handheld' },
            { panel_number: 4, composition: 'close', lighting: 'sparks', color_palette: 'blue white', atmosphere: 'counter', technical_notes: 'fast tilt' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'Disciple', acting: 'waits and listens' }] },
            { panel_number: 2, characters: [{ name: 'Disciple', acting: 'steps through gate' }] },
            { panel_number: 3, characters: [{ name: 'Disciple', acting: 'releases sword energy' }] },
            { panel_number: 4, characters: [{ name: 'Guardian', acting: 'counters from high ground' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          { panel_number: 1, description: 'Disciple stands outside the celestial gate while bells tremble in wind.', location: 'Celestial Gate Exterior', source_text: 'Disciple waits outside the celestial gate.', characters: [{ name: 'Disciple', appearance: 'default' }], shot_type: 'wide shot', camera_move: 'slow pan', video_prompt: 'outer gate setup' },
          { panel_number: 2, description: 'Disciple crosses into inner hall as warning bells continue.', location: 'Celestial Gate Interior', source_text: 'He enters the inner hall as bells ring.', characters: [{ name: 'Disciple', appearance: 'default' }], shot_type: 'wide shot', camera_move: 'push in', video_prompt: 'inner gate entry' },
          { panel_number: 3, description: 'Sword energy bursts near altar and shatters stone dust.', location: 'Celestial Gate Interior', source_text: 'Sword energy erupts near the altar.', characters: [{ name: 'Disciple', appearance: 'default' }, { name: 'Guardian', appearance: 'default' }], shot_type: 'medium shot', camera_move: 'handheld', video_prompt: 'energy burst' },
          { panel_number: 4, description: 'Guardian counters from upper platform with a descending arc.', location: 'Celestial Gate Interior', source_text: 'Guardian counters from upper platform.', characters: [{ name: 'Guardian', appearance: 'default' }], shot_type: 'close shot', camera_move: 'fast tilt', video_prompt: 'counter strike' },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Disciple reaches outer gate at midnight. Wind shakes old bells. He crosses into the inner hall. Energy cracks around the altar. Guardian appears on upper platform. First strike tears the floor. Counter strike descends from above. Dust and sparks fill the chamber.',
          characters: JSON.stringify([{ name: 'Disciple' }, { name: 'Guardian' }]),
          location: 'Celestial Gate Exterior',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Disciple', appearances: [] }, { name: 'Guardian', appearances: [] }],
        locations: [{ name: 'Celestial Gate Exterior', images: [] }, { name: 'Celestial Gate Interior', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.totalPanelCount).toBe(4)
    expect(result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)).toEqual([1, 2, 3, 4])
  })

  it('campus suspense removes repeated pov beat and keeps next action', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: 'Student hides near classroom door at night.', location: 'Campus Corridor', source_text: 'Student hides near classroom door at night.', characters: [{ name: 'Student' }] },
            { panel_number: 2, description: 'Same beat in subjective angle toward the door seam.', location: 'Campus Corridor', source_text: 'Student hides near classroom door at night.', characters: [{ name: 'Student' }] },
            { panel_number: 3, description: 'Footsteps approach and key turns.', location: 'Campus Corridor', source_text: 'Footsteps approach and key turns in lock.', characters: [{ name: 'Student' }] },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'medium', lighting: 'night cold', color_palette: 'blue', atmosphere: 'tense', technical_notes: 'slow push' },
            { panel_number: 2, composition: 'medium', lighting: 'night cold', color_palette: 'blue', atmosphere: 'tense', technical_notes: 'handheld' },
            { panel_number: 3, composition: 'close', lighting: 'night cold', color_palette: 'blue', atmosphere: 'shock', technical_notes: 'micro shake' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [{ name: 'Student', acting: 'holds breath' }] },
            { panel_number: 2, characters: [{ name: 'Student', acting: 'still holding breath' }] },
            { panel_number: 3, characters: [{ name: 'Student', acting: 'flinches at key sound' }] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          { panel_number: 1, description: 'Student hides by classroom door in deep night corridor.', location: 'Campus Corridor', source_text: 'Student hides near classroom door at night.', characters: [{ name: 'Student', appearance: 'default' }], shot_type: 'medium shot', camera_move: 'slow push', video_prompt: 'hide near door' },
          { panel_number: 2, description: 'Subjective view from the same position at door seam without new event.', location: 'Campus Corridor', source_text: 'Student hides near classroom door at night.', characters: [{ name: 'Student', appearance: 'default' }], shot_type: 'subjective medium shot', camera_move: 'handheld', video_prompt: 'same pov beat' },
          { panel_number: 3, description: 'Footsteps approach and key turns in lock, student jolts.', location: 'Campus Corridor', source_text: 'Footsteps approach and key turns in lock.', characters: [{ name: 'Student', appearance: 'default' }], shot_type: 'close shot', camera_move: 'micro shake', video_prompt: 'approach and key turn' },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Night corridor hide, repeated pov beat, then approaching footsteps and key turn.',
          characters: JSON.stringify([{ name: 'Student' }]),
          location: 'Campus Corridor',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Student', appearances: [] }],
        locations: [{ name: 'Campus Corridor', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.totalPanelCount).toBe(2)
    expect(result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)).toEqual([1, 3])
  })


  it('drops repeated stylized accents when they carry no new beat information', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify([
            { panel_number: 1, description: 'Beat one at the checkpoint gate.', location: 'Checkpoint Gate', source_text: 'He hears patrol footsteps and freezes at the checkpoint gate.', characters: [] },
            { panel_number: 2, description: 'Stylized variant of the same listening beat.', location: 'Checkpoint Gate', source_text: 'He listens to patrol and hides near the checkpoint gate shadow.', characters: [] },
            { panel_number: 3, description: 'Radio confirms two guards on west fence.', location: 'Checkpoint Gate', source_text: 'Radio confirms two guards on west fence.', characters: [] },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify([
            { panel_number: 1, composition: 'close', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'handheld' },
            { panel_number: 2, composition: 'close', lighting: 'low', color_palette: 'cold', atmosphere: 'tense', technical_notes: 'handheld' },
            { panel_number: 3, composition: 'medium', lighting: 'low', color_palette: 'cold', atmosphere: 'alert', technical_notes: 'static' },
          ]),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify([
            { panel_number: 1, characters: [] },
            { panel_number: 2, characters: [] },
            { panel_number: 3, characters: [] },
          ]),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify([
          { panel_number: 1, description: 'Dutch close frame while he freezes near gate.', location: 'Checkpoint Gate', source_text: 'He hears patrol footsteps and freezes at the checkpoint gate.', characters: [], shot_type: 'dutch close shot', camera_move: 'handheld', video_prompt: 'first stylized beat' },
          { panel_number: 2, description: 'Subjective close frame on the same gate-listening beat without new event.', location: 'Checkpoint Gate', source_text: 'He listens to patrol and hides near the checkpoint gate shadow.', characters: [], shot_type: 'subjective close shot', camera_move: 'handheld', video_prompt: 'second stylized duplicate' },
          { panel_number: 3, description: 'Radio whisper confirms two guards on west fence.', location: 'Checkpoint Gate', source_text: 'Radio confirms two guards on west fence.', characters: [], shot_type: 'medium shot', camera_move: 'static', video_prompt: 'new beat radio warning' },
        ]),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'He hears patrol footsteps and freezes. He listens and hides near the gate shadow. Radio confirms two guards on west fence.',
          characters: JSON.stringify([]),
          location: 'Checkpoint Gate',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [],
        locations: [{ name: 'Checkpoint Gate', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.totalPanelCount).toBe(2)
    expect(result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number)).toEqual([1, 3])
  })



  it('accepts wrapped object payloads that contain object arrays', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'storyboard_phase1_plan') {
        return {
          text: JSON.stringify({
            panels: [
              {
                panel_number: 1,
                description: 'phase1 panel',
                location: 'Street',
                source_text: 'source text',
                characters: [{ name: 'Hero' }],
              },
            ],
          }),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_cinematography') {
        return {
          text: JSON.stringify({
            result: {
              items: [
                {
                  panel_number: 1,
                  composition: 'center',
                  lighting: 'low key',
                  color_palette: 'cool',
                  atmosphere: 'tense',
                  technical_notes: 'static',
                },
              ],
            },
          }),
          reasoning: '',
        }
      }

      if (action === 'storyboard_phase2_acting') {
        return {
          text: JSON.stringify({
            output: [
              {
                panel_number: 1,
                characters: [{ name: 'Hero', acting: 'watching' }],
              },
            ],
          }),
          reasoning: '',
        }
      }

      return {
        text: JSON.stringify({
          data: [
            {
              panel_number: 1,
              description: 'phase3 panel',
              location: 'Street',
              source_text: 'source text',
              characters: [{ name: 'Hero', appearance: 'default' }],
              shot_type: 'medium shot',
              camera_move: 'static',
              video_prompt: 'hero watches',
            },
          ],
        }),
        reasoning: '',
      }
    })

    const result = await runScriptToStoryboardOrchestrator({
      clips: [
        {
          id: 'clip-1',
          content: 'Hero enters street.',
          characters: JSON.stringify([{ name: 'Hero' }]),
          location: 'Street',
          screenplay: null,
        },
      ],
      novelPromotionData: {
        characters: [{ name: 'Hero', appearances: [] }],
        locations: [{ name: 'Street', images: [] }],
      },
      promptTemplates,
      runStep,
    })

    expect(result.summary.clipCount).toBe(1)
    expect(result.summary.totalPanelCount).toBe(1)
    expect(result.clipPanels[0]?.finalPanels[0]?.source_text).toBe('source text')
  })

})
