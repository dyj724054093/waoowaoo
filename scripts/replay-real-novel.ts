import fs from "node:fs"
import path from "node:path"
import { runScriptToStoryboardOrchestrator } from "@/lib/novel-promotion/script-to-storyboard/orchestrator"

type LocationDraft = Record<string, unknown>

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  const lowered = text.toLowerCase()
  return keywords.some((keyword) => lowered.includes(keyword.toLowerCase()))
}

function hasChineseText(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value)
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function hasLayerName(locations: LocationDraft[], keywords: string[]): boolean {
  return locations.some((location) => hasAnyKeyword(readText(location.name), keywords))
}

function buildLayerDescriptions(name: string, baseName: string, layerSummary: string): string[] {
  return [
    `[${name}] wide view of ${baseName} ${layerSummary}, with clear foreground-midground-background layers.`,
    `[${name}] low-light full-scene composition that shows boundaries and entry direction.`,
    `[${name}] environment board focused on spatial depth and path readability for compositing.`,
  ]
}

function buildSpatialLayerSupplements(content: string, locations: LocationDraft[]): LocationDraft[] {
  if (!content.trim() || locations.length === 0) return []

  const text = normalizeSpace(content)
  const hasOuterCue = hasAnyKeyword(text, [
    "\u5916\u56f4",
    "\u5916\u4fa7",
    "\u7ad9\u5916",
    "\u5916\u573a",
    "outside",
    "outer",
    "perimeter",
  ])
  const hasInnerCue = hasAnyKeyword(text, [
    "\u7ad9\u5185",
    "\u5185\u90e8",
    "\u5185\u573a",
    "\u5927\u5385",
    "\u5185\u5385",
    "inside",
    "interior",
    "hall",
  ])
  const hasGateCue = hasAnyKeyword(text, [
    "\u5165\u53e3",
    "\u95e8\u53e3",
    "\u94c1\u95e8",
    "\u540e\u95e8",
    "\u4fa7\u95e8",
    "entrance",
    "gate",
    "back door",
  ])
  const hasFenceCue = hasAnyKeyword(text, [
    "\u56f4\u680f",
    "\u897f\u4fa7",
    "\u4e1c\u4fa7",
    "fence",
    "west side",
    "east side",
  ])

  if (!hasOuterCue && !hasInnerCue && !hasGateCue && !hasFenceCue) return []

  const hub = locations.find((location) =>
    hasAnyKeyword(readText(location.name), [
      "\u7ad9",
      "station",
      "checkpoint",
      "quarantine",
      "terminal",
      "dock",
    ]),
  )
  if (!hub) return []

  const baseName = normalizeSpace(readText(hub.name).split("/")[0] || "")
  if (!baseName) return []

  const isZh = hasChineseText(baseName)
  const supplements: LocationDraft[] = []
  const mergedForChecking: LocationDraft[] = [...locations]

  const tryAddLayer = (params: {
    cue: boolean
    nameZh: string
    nameEn: string
    summaryZh: string
    summaryEn: string
    keywords: string[]
  }) => {
    const { cue, nameZh, nameEn, summaryZh, summaryEn, keywords } = params
    if (!cue) return
    if (hasLayerName(mergedForChecking, keywords)) return

    const name = isZh ? `${baseName}_${nameZh}` : `${baseName}_${nameEn}`
    const summary = isZh
      ? `${baseName}${summaryZh}`
      : `${summaryEn} layer of ${baseName} with independent actions.`

    const location: LocationDraft = {
      name,
      summary,
      has_crowd: false,
      crowd_description: "",
      descriptions: buildLayerDescriptions(name, baseName, isZh ? summaryZh : summaryEn),
    }

    supplements.push(location)
    mergedForChecking.push(location)
  }

  tryAddLayer({
    cue: hasOuterCue,
    nameZh: "\u5916\u56f4",
    nameEn: "outer_perimeter",
    summaryZh: "\u5916\u56f4\u7f13\u51b2\u533a",
    summaryEn: "outer perimeter",
    keywords: ["\u5916\u56f4", "\u5916\u4fa7", "\u7ad9\u5916", "outer", "outside", "perimeter"],
  })

  tryAddLayer({
    cue: hasInnerCue,
    nameZh: "\u5185\u90e8",
    nameEn: "inner_core",
    summaryZh: "\u5185\u90e8\u6838\u5fc3\u533a",
    summaryEn: "inner core",
    keywords: ["\u5185\u90e8", "\u7ad9\u5185", "\u5927\u5385", "\u5185\u5385", "inner", "inside", "interior", "hall"],
  })

  tryAddLayer({
    cue: hasGateCue,
    nameZh: "\u51fa\u5165\u53e3",
    nameEn: "gate_zone",
    summaryZh: "\u51fa\u5165\u53e3\u533a",
    summaryEn: "gate zone",
    keywords: ["\u5165\u53e3", "\u95e8\u53e3", "\u540e\u95e8", "\u4fa7\u95e8", "gate", "entrance", "back door"],
  })

  tryAddLayer({
    cue: hasFenceCue,
    nameZh: "\u56f4\u680f\u7ebf",
    nameEn: "fence_line",
    summaryZh: "\u56f4\u680f\u7ebf\u533a\u57df",
    summaryEn: "fence line",
    keywords: ["\u56f4\u680f", "fence", "west side", "east side"],
  })

  return supplements
}

function splitSentences(text: string): string[] {
  return text
    .split(/[\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

async function run() {
  const novelDir = "/mnt/d/work/xiaoshuo"
  const mdFiles = fs.readdirSync(novelDir).filter((name) => name.endsWith(".md"))
  if (mdFiles.length === 0) {
    throw new Error("No markdown files found in /mnt/d/work/xiaoshuo")
  }

  const target = path.join(novelDir, mdFiles[0]!)
  const content = fs.readFileSync(target, "utf-8").replace(/^\uFEFF/, "")
  const lines = splitSentences(content)

  const firstRoundLocations: LocationDraft[] = [
    {
      name: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
      summary: "\u4e3b\u4f53\u68c0\u75ab\u5efa\u7b51",
      descriptions: ["base"],
    },
  ]

  const layerSupplements = buildSpatialLayerSupplements(content, firstRoundLocations)

  console.log("=== REAL NOVEL REPLAY: INPUT ===")
  console.log(JSON.stringify({ file: target, chars: content.length, lines: lines.length }, null, 2))

  console.log("=== REAL NOVEL REPLAY: LOCATION LAYERS ===")
  console.log(JSON.stringify(layerSupplements.map((x) => ({ name: x.name, summary: x.summary })), null, 2))

  const clipContent = lines.slice(0, 16).join(" ")
  const runStep = async (_meta: unknown, _prompt: string, action: string) => {
    if (action === "storyboard_phase1_plan") {
      return {
        text: JSON.stringify([
          {
            panel_number: 1,
            description: "Night ruins establish the city skeleton and distant checkpoint.",
            location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
            source_text: "\u591c\u91cc\u5341\u4e00\u70b9\u56db\u5341\u4e03\u5206\uff0c\u98ce\u4ece\u5e9f\u589f\u95f4\u5439\u8fc7\u3002",
            characters: [{ name: "\u6797\u5c7f" }],
          },
          {
            panel_number: 2,
            description: "LinYu crouches in overpass shadow and watches station gate.",
            location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
            source_text: "\u6797\u5c7f\u8e72\u5728\u574d\u584c\u7684\u9ad8\u67b6\u9634\u5f71\u91cc\u3002",
            characters: [{ name: "\u6797\u5c7f" }],
          },
          {
            panel_number: 3,
            description: "Subjective view to the half-open iron gate without new beat.",
            location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
            source_text: "\u524d\u65b9\u4e09\u5341\u7c73\uff0c\u662f\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9\u3002",
            characters: [{ name: "\u6797\u5c7f" }],
          },
          {
            panel_number: 4,
            description: "Irregular footsteps and radio warning trigger reaction.",
            location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
            source_text: "\u4ed6\u542c\u89c1\u4e86\u811a\u6b65\u58f0\u3002\u201c\u5b83\u4eec\u5728\u56de\u5de1\u3002\u201d",
            characters: [{ name: "\u6797\u5c7f" }, { name: "\u6c88\u662d" }],
          },
          {
            panel_number: 5,
            description: "Same reaction beat in another stylized angle.",
            location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
            source_text: "\u4ed6\u542c\u89c1\u4e86\u811a\u6b65\u58f0\u3002\u201c\u5b83\u4eec\u5728\u56de\u5de1\u3002\u201d",
            characters: [{ name: "\u6797\u5c7f" }, { name: "\u6c88\u662d" }],
          },
        ]),
        reasoning: "",
      }
    }

    if (action === "storyboard_phase2_cinematography") {
      return {
        text: JSON.stringify([
          { panel_number: 1, composition: "wide", lighting: "low key", color_palette: "cold", atmosphere: "tense", technical_notes: "slow pan" },
          { panel_number: 2, composition: "medium", lighting: "moonlight", color_palette: "cold", atmosphere: "tense", technical_notes: "slow push" },
          { panel_number: 3, composition: "medium", lighting: "moonlight", color_palette: "cold", atmosphere: "tense", technical_notes: "handheld" },
          { panel_number: 4, composition: "close", lighting: "moonlight", color_palette: "cold", atmosphere: "suspense", technical_notes: "micro shake" },
          { panel_number: 5, composition: "close", lighting: "moonlight", color_palette: "cold", atmosphere: "suspense", technical_notes: "dutch" },
        ]),
        reasoning: "",
      }
    }

    if (action === "storyboard_phase2_acting") {
      return {
        text: JSON.stringify([
          { panel_number: 1, characters: [{ name: "\u6797\u5c7f", acting: "hidden observation" }] },
          { panel_number: 2, characters: [{ name: "\u6797\u5c7f", acting: "holds watch" }] },
          { panel_number: 3, characters: [{ name: "\u6797\u5c7f", acting: "maintains observation" }] },
          { panel_number: 4, characters: [{ name: "\u6797\u5c7f", acting: "reacts to sound" }] },
          { panel_number: 5, characters: [{ name: "\u6797\u5c7f", acting: "same reaction" }] },
        ]),
        reasoning: "",
      }
    }

    return {
      text: JSON.stringify([
        {
          panel_number: 1,
          description: "Night ruins and collapsed overpass frame the old checkpoint in distance.",
          location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
          source_text: "\u591c\u91cc\u5341\u4e00\u70b9\u56db\u5341\u4e03\u5206\uff0c\u98ce\u4ece\u5e9f\u589f\u95f4\u5439\u8fc7\u3002",
          characters: [{ name: "\u6797\u5c7f", appearance: "default" }],
          shot_type: "wide shot",
          camera_move: "slow pan",
          video_prompt: "night ruins establish",
        },
        {
          panel_number: 2,
          description: "LinYu crouches in shadow, keeping watch on the half-open gate.",
          location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
          source_text: "\u6797\u5c7f\u8e72\u5728\u574d\u584c\u7684\u9ad8\u67b6\u9634\u5f71\u91cc\u3002",
          characters: [{ name: "\u6797\u5c7f", appearance: "default" }],
          shot_type: "medium shot",
          camera_move: "slow push",
          video_prompt: "crouch and observe",
        },
        {
          panel_number: 3,
          description: "POV from same position to the half-open gate with burned sign.",
          location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
          source_text: "\u524d\u65b9\u4e09\u5341\u7c73\uff0c\u662f\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9\u3002",
          characters: [{ name: "\u6797\u5c7f", appearance: "default" }],
          shot_type: "subjective medium shot",
          camera_move: "handheld",
          video_prompt: "same beat subjective",
        },
        {
          panel_number: 4,
          description: "Irregular footsteps and radio warning trigger immediate tension.",
          location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
          source_text: "\u4ed6\u542c\u89c1\u4e86\u811a\u6b65\u58f0\u3002\u201c\u5b83\u4eec\u5728\u56de\u5de1\u3002\u201d",
          characters: [{ name: "\u6797\u5c7f", appearance: "default" }, { name: "\u6c88\u662d", appearance: "default" }],
          shot_type: "close shot",
          camera_move: "micro shake",
          video_prompt: "reaction to patrol rhythm",
        },
        {
          panel_number: 5,
          description: "Same reaction beat in dutch close shot without new event.",
          location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
          source_text: "\u4ed6\u542c\u89c1\u4e86\u811a\u6b65\u58f0\u3002\u201c\u5b83\u4eec\u5728\u56de\u5de1\u3002\u201d",
          characters: [{ name: "\u6797\u5c7f", appearance: "default" }, { name: "\u6c88\u662d", appearance: "default" }],
          shot_type: "dutch close shot",
          camera_move: "handheld",
          video_prompt: "same reaction repeated",
        },
      ]),
      reasoning: "",
    }
  }

  const result = await runScriptToStoryboardOrchestrator({
    clips: [
      {
        id: "clip-real-1",
        content: clipContent,
        characters: JSON.stringify([{ name: "\u6797\u5c7f" }, { name: "\u6c88\u662d" }]),
        location: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9",
        screenplay: null,
      },
    ],
    novelPromotionData: {
      characters: [
        { name: "\u6797\u5c7f", appearances: [] },
        { name: "\u6c88\u662d", appearances: [] },
      ] as any,
      locations: [
        { name: "\u7b2c\u4e03\u7801\u5934\u65e7\u68c0\u75ab\u7ad9", images: [] },
      ] as any,
    },
    promptTemplates: {
      phase1PlanTemplate:
        "{clip_content} {clip_json} {characters_lib_name} {locations_lib_name} {characters_introduction} {characters_appearance_list} {characters_full_description}",
      phase2CinematographyTemplate:
        "{panels_json} {panel_count} {locations_description} {characters_info}",
      phase2ActingTemplate: "{panels_json} {panel_count} {characters_info}",
      phase3DetailTemplate:
        "{panels_json} {characters_age_gender} {characters_profile_summary} {locations_description}",
    },
    runStep,
  })

  console.log("=== REAL NOVEL REPLAY: STORYBOARD OPTIMIZATION ===")
  console.log(
    JSON.stringify(
      {
        inputPanelCount: 5,
        finalPanelCount: result.summary.totalPanelCount,
        finalPanelNumbers: result.clipPanels[0]?.finalPanels.map((panel) => panel.panel_number) || [],
        finalSourceTexts: result.clipPanels[0]?.finalPanels.map((panel) => panel.source_text) || [],
      },
      null,
      2,
    ),
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
