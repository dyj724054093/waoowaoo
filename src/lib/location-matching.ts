interface NamedLocationLike {
  name: string
}

const ALIAS_SPLIT_RE = /[\/|,\uFF0C\u3001]+/
const BRACKET_CONTENT_RE = /[\uFF08(\u3010\[].*?[\u3011)\]\uFF09]/g
const EN_CAMERA_SUFFIX_RE =
  /\b(front|frontal|side|rear|back|left side|right side|aerial|top view|birds?[- ]eye(?: view)?|wide shot|medium shot|close[- ]up|long shot|night view|day view|at night|in daytime)\b$/i
const ZH_CAMERA_SUFFIX_RE = /(\u6b63\u9762\u770b|\u4fa7\u9762\u770b|\u80cc\u9762\u770b|\u6b63\u9762|\u4fa7\u9762|\u80cc\u9762|\u524d\u65b9|\u540e\u65b9|\u524d\u9762|\u540e\u9762|\u591c\u666f|\u767d\u5929|\u591c\u665a|\u65e5\u666f|\u8fdc\u666f|\u8fd1\u666f|\u4fef\u89c6|\u4ef0\u89c6|\u822a\u62cd|\u5168\u666f|\u7279\u5199|\u4e2d\u666f|\u5de6\u4fa7|\u53f3\u4fa7|\u524d\u4fa7|\u540e\u4fa7|\u673a\u4f4d|\u89c6\u89d2|\u955c\u5934)$/

function splitAliases(name: string): string[] {
  return name
    .split(ALIAS_SPLIT_RE)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeLocationAnchorName(rawName: string): string {
  let current = normalizeSpaces(rawName.toLowerCase().replace(BRACKET_CONTENT_RE, ' '))
  if (!current) return ''

  let previous = ''
  while (previous !== current) {
    previous = current
    current = normalizeSpaces(current.replace(EN_CAMERA_SUFFIX_RE, ''))
    current = normalizeSpaces(current.replace(ZH_CAMERA_SUFFIX_RE, ''))
    current = normalizeSpaces(current.replace(/[-_:/]+$/, ''))
  }
  return current
}

export function findLocationByReferenceName<T extends NamedLocationLike>(
  locations: T[],
  referenceName: string | null | undefined,
): T | undefined {
  const ref = typeof referenceName === 'string' ? referenceName.trim() : ''
  if (!ref) return undefined
  const refLower = ref.toLowerCase()

  const exact = locations.find((location) => location.name.toLowerCase().trim() === refLower)
  if (exact) return exact

  const refAliases = splitAliases(refLower)
  for (const location of locations) {
    const locationAliases = splitAliases(location.name.toLowerCase())
    const hasAliasOverlap = refAliases.some((alias) => locationAliases.includes(alias))
    if (hasAliasOverlap) return location
  }

  const normalizedRef = normalizeLocationAnchorName(ref)
  if (!normalizedRef) return undefined
  return locations.find((location) => {
    const normalizedLocation = normalizeLocationAnchorName(location.name)
    return normalizedLocation.length > 0 && normalizedLocation === normalizedRef
  })
}