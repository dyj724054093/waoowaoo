import { describe, expect, it } from 'vitest'
import { buildPrompt } from '@/lib/prompt-i18n/build-prompt'
import { PROMPT_CATALOG } from '@/lib/prompt-i18n/catalog'
import { PROMPT_IDS } from '@/lib/prompt-i18n/prompt-ids'

describe('prompt i18n catalog contract', () => {
  it('NP_AGENT_STORYBOARD_DETAIL declares characters_profile_summary', () => {
    const entry = PROMPT_CATALOG[PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL]
    expect(entry.variableKeys).toContain('characters_profile_summary')
  })

  it('NP_SEEDANCE_DETAIL declares characters_profile_summary', () => {
    const entry = PROMPT_CATALOG[PROMPT_IDS.NP_SEEDANCE_DETAIL]
    expect(entry.variableKeys).toContain('characters_profile_summary')
  })

  it('buildPrompt accepts characters_profile_summary for storyboard detail', () => {
    const prompt = buildPrompt({
      promptId: PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL,
      locale: 'en',
      variables: {
        panels_json: '[]',
        characters_age_gender: 'hero,male',
        characters_profile_summary: 'hero | scar | calm',
        locations_description: 'street at night',
      },
    })

    expect(prompt).toContain('hero | scar | calm')
    expect(prompt).toContain('street at night')
  })

  it('buildPrompt accepts characters_profile_summary for seedance detail zh template', () => {
    const prompt = buildPrompt({
      promptId: PROMPT_IDS.NP_SEEDANCE_DETAIL,
      locale: 'zh',
      variables: {
        panels_json: '[]',
        characters_age_gender: 'lead,male',
        characters_profile_summary: 'lead | scar | calm',
        locations_description: 'rainy night street',
      },
    })

    expect(prompt).toContain('lead | scar | calm')
    expect(prompt).toContain('rainy night street')
  })
})
